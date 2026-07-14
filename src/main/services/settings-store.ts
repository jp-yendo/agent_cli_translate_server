import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAppRootDir, SETTINGS_FILE_NAME } from '../../shared/constants';
import { AGENT_CLI_IDS, type AgentCliId } from '../../shared/agent-catalog';
import { API_PROVIDER_IDS, type ApiProviderId } from '../../shared/api-provider-catalog';
import { createDefaultAgentCliConfig, type AgentCliConfig } from '../../shared/models/agent-cli-config';
import { createDefaultApiProviderConfig, type ApiProviderConfig } from '../../shared/models/api-provider-config';
import { DEFAULT_COMMON_SETTINGS, type CommonSettings } from '../../shared/models/common-settings';
import type { TranslationHint } from '../../shared/models/translation-hint';
import { DEFAULT_UI_SETTINGS, type UiSettings } from '../../shared/models/ui-settings';
import type { AppSettings } from '../../shared/types';

// 設定ファイル (~/.agent_cli_translate_server/settings.json) の読み書き

let cached: AppSettings | null = null;

function getSettingsFilePath(): string {
    return path.join(getAppRootDir(), SETTINGS_FILE_NAME);
}

function createDefaultSettings(): AppSettings {
    const agents = {} as Record<AgentCliId, AgentCliConfig>;
    for (const id of AGENT_CLI_IDS) {
        agents[id] = createDefaultAgentCliConfig(id);
    }
    const apiProviders = {} as Record<ApiProviderId, ApiProviderConfig>;
    for (const id of API_PROVIDER_IDS) {
        apiProviders[id] = createDefaultApiProviderConfig();
    }
    return {
        common: { ...DEFAULT_COMMON_SETTINGS },
        agents,
        apiProviders,
        hints: [],
        ui: { ...DEFAULT_UI_SETTINGS },
    };
}

function toPositiveInt(value: unknown, fallback: number): number {
    const num = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(num)) return fallback;
    const int = Math.floor(num);
    return int > 0 ? int : fallback;
}

// 設定ファイルの内容を検証しつつデフォルト値とマージする
function normalizeSettings(raw: unknown): AppSettings {
    const settings = createDefaultSettings();
    if (!raw || typeof raw !== 'object') return settings;
    const obj = raw as Record<string, unknown>;

    const common = obj.common as Partial<CommonSettings> | undefined;
    if (common && typeof common === 'object') {
        if (typeof common.host === 'string' && common.host.trim()) settings.common.host = common.host.trim();
        settings.common.port = Math.min(65535, toPositiveInt(common.port, settings.common.port));
        if (typeof common.fallbackFrom === 'string' && common.fallbackFrom.trim()) {
            settings.common.fallbackFrom = common.fallbackFrom.trim();
        }
        if (typeof common.fallbackTo === 'string' && common.fallbackTo.trim()) {
            settings.common.fallbackTo = common.fallbackTo.trim();
        }
        settings.common.agentRetentionSec = toPositiveInt(common.agentRetentionSec, settings.common.agentRetentionSec);
        if (typeof common.hintId === 'string' && common.hintId) settings.common.hintId = common.hintId;
    }

    const agents = obj.agents as Record<string, Partial<AgentCliConfig>> | undefined;
    if (agents && typeof agents === 'object') {
        for (const id of AGENT_CLI_IDS) {
            const agent = agents[id];
            if (agent && typeof agent === 'object') {
                settings.agents[id].maxConcurrency = toPositiveInt(
                    agent.maxConcurrency,
                    settings.agents[id].maxConcurrency
                );
                settings.agents[id].maxUses = toPositiveInt(agent.maxUses, settings.agents[id].maxUses);
                if (typeof agent.modelName === 'string' && agent.modelName.trim()) {
                    settings.agents[id].modelName = agent.modelName.trim();
                }
            }
        }
    }

    const apiProviders = obj.apiProviders as Record<string, Partial<ApiProviderConfig>> | undefined;
    if (apiProviders && typeof apiProviders === 'object') {
        for (const id of API_PROVIDER_IDS) {
            const provider = apiProviders[id];
            if (provider && typeof provider === 'object') {
                if (typeof provider.baseUrl === 'string') settings.apiProviders[id].baseUrl = provider.baseUrl.trim();
                if (typeof provider.apiKey === 'string') settings.apiProviders[id].apiKey = provider.apiKey;
                if (typeof provider.model === 'string') settings.apiProviders[id].model = provider.model.trim();
                settings.apiProviders[id].maxConcurrency = toPositiveInt(
                    provider.maxConcurrency,
                    settings.apiProviders[id].maxConcurrency
                );
            }
        }
    }

    const hints = obj.hints as unknown[] | undefined;
    if (Array.isArray(hints)) {
        for (const item of hints) {
            const hint = item as Partial<TranslationHint>;
            if (hint && typeof hint.id === 'string' && typeof hint.name === 'string') {
                settings.hints.push({
                    id: hint.id,
                    name: hint.name,
                    summary: typeof hint.summary === 'string' ? hint.summary : '',
                });
            }
        }
    }

    const ui = obj.ui as Partial<UiSettings> | undefined;
    if (ui && typeof ui === 'object') {
        if (ui.theme === 'light' || ui.theme === 'dark' || ui.theme === 'system') {
            settings.ui.theme = ui.theme;
        }
        if (ui.language === 'ja' || ui.language === 'en') {
            settings.ui.language = ui.language;
        }
    }

    // 存在しないヒントIDへの参照を除去
    const hintIds = new Set(settings.hints.map(h => h.id));
    if (settings.common.hintId && !hintIds.has(settings.common.hintId)) {
        settings.common.hintId = null;
    }

    return settings;
}

export function loadSettings(): AppSettings {
    if (cached) return cached;
    let raw: unknown = null;
    try {
        const filePath = getSettingsFilePath();
        if (fs.existsSync(filePath)) {
            raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (error) {
        console.error('Failed to load settings, falling back to defaults:', error);
    }
    cached = normalizeSettings(raw);
    return cached;
}

function persist(settings: AppSettings): void {
    const dir = getAppRootDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = getSettingsFilePath();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    cached = settings;
}

export function saveCommonSettings(common: CommonSettings): AppSettings {
    const settings = loadSettings();
    // hintId の有効性検証は既存ヒントに対して行うため、hints も渡して正規化する
    const normalizedCommon = normalizeSettings({ common, hints: settings.hints }).common;
    const next: AppSettings = { ...settings, common: normalizedCommon };
    persist(next);
    return next;
}

export function saveAgentConfig(agentId: AgentCliId, config: AgentCliConfig): AppSettings {
    const settings = loadSettings();
    if (!AGENT_CLI_IDS.includes(agentId)) {
        throw new Error(`Unknown agent CLI id: ${agentId}`);
    }
    const normalized: AgentCliConfig = {
        maxConcurrency: toPositiveInt(config.maxConcurrency, settings.agents[agentId].maxConcurrency),
        maxUses: toPositiveInt(config.maxUses, settings.agents[agentId].maxUses),
        modelName: typeof config.modelName === 'string' && config.modelName.trim() ? config.modelName.trim() : null,
    };
    const next: AppSettings = {
        ...settings,
        agents: { ...settings.agents, [agentId]: normalized },
    };
    persist(next);
    return next;
}

export function saveApiProviderConfig(providerId: ApiProviderId, config: ApiProviderConfig): AppSettings {
    const settings = loadSettings();
    if (!API_PROVIDER_IDS.includes(providerId)) {
        throw new Error(`Unknown API provider id: ${providerId}`);
    }
    const normalized: ApiProviderConfig = {
        baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '',
        apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
        model: typeof config.model === 'string' ? config.model.trim() : '',
        maxConcurrency: toPositiveInt(config.maxConcurrency, settings.apiProviders[providerId].maxConcurrency),
    };
    const next: AppSettings = {
        ...settings,
        apiProviders: { ...settings.apiProviders, [providerId]: normalized },
    };
    persist(next);
    return next;
}

export function saveUiSettings(ui: Partial<UiSettings>): AppSettings {
    const settings = loadSettings();
    const next: AppSettings = { ...settings, ui: normalizeSettings({ ui: { ...settings.ui, ...ui } }).ui };
    persist(next);
    return next;
}

export function createHint(input: { name: string; summary: string }): AppSettings {
    const settings = loadSettings();
    const hint: TranslationHint = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        summary: input.summary,
    };
    if (!hint.name) {
        throw new Error('Hint name must not be empty');
    }
    const next: AppSettings = { ...settings, hints: [...settings.hints, hint] };
    persist(next);
    return next;
}

export function updateHint(hint: TranslationHint): AppSettings {
    const settings = loadSettings();
    const index = settings.hints.findIndex(h => h.id === hint.id);
    if (index < 0) {
        throw new Error(`Hint not found: ${hint.id}`);
    }
    const name = hint.name.trim();
    if (!name) {
        throw new Error('Hint name must not be empty');
    }
    const hints = [...settings.hints];
    hints[index] = { id: hint.id, name, summary: hint.summary };
    const next: AppSettings = { ...settings, hints };
    persist(next);
    return next;
}

export function deleteHint(hintId: string): AppSettings {
    const settings = loadSettings();
    const hints = settings.hints.filter(h => h.id !== hintId);
    // 削除したヒントを参照している共通設定を解除
    const common =
        settings.common.hintId === hintId ? { ...settings.common, hintId: null } : settings.common;
    const next: AppSettings = { ...settings, hints, common };
    persist(next);
    return next;
}
