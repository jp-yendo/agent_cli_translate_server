import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAppRootDir, SETTINGS_FILE_NAME } from '../../shared/constants';
import { AGENT_CLI_IDS, type AgentCliId } from '../../shared/agent-catalog';
import { createDefaultAgentCliConfig, type AgentCliConfig } from '../../shared/models/agent-cli-config';
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
    return {
        common: { ...DEFAULT_COMMON_SETTINGS },
        agents,
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
                if (typeof agent.hintId === 'string' && agent.hintId) settings.agents[id].hintId = agent.hintId;
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
    for (const id of AGENT_CLI_IDS) {
        if (settings.agents[id].hintId && !hintIds.has(settings.agents[id].hintId as string)) {
            settings.agents[id].hintId = null;
        }
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
    const next: AppSettings = { ...settings, common: normalizeSettings({ common }).common };
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
        hintId: typeof config.hintId === 'string' && config.hintId ? config.hintId : null,
    };
    if (normalized.hintId && !settings.hints.some(h => h.id === normalized.hintId)) {
        normalized.hintId = null;
    }
    const next: AppSettings = {
        ...settings,
        agents: { ...settings.agents, [agentId]: normalized },
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
    // 削除したヒントを参照している Agent CLI 設定を解除
    const agents = { ...settings.agents };
    for (const id of AGENT_CLI_IDS) {
        if (agents[id].hintId === hintId) {
            agents[id] = { ...agents[id], hintId: null };
        }
    }
    const next: AppSettings = { ...settings, hints, agents };
    persist(next);
    return next;
}
