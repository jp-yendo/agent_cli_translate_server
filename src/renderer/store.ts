import { create } from 'zustand';
import { LOG_MAX_ENTRIES } from '@shared/app-constants';
import type { AgentCliId } from '@shared/agent-catalog';
import type { AgentCliConfig } from '@shared/models/agent-cli-config';
import type { CommonSettings } from '@shared/models/common-settings';
import type { TranslationHint } from '@shared/models/translation-hint';
import type { AgentCliAvailability, AppInfo, AppLanguage, AppSettings, LogEntry, ServerStatus } from '@shared/types';
import i18n from './i18n/config';

// アプリ全体の状態管理

const api = () => window.agentCliTranslateServer;

// IPC 例外のメッセージから Electron のプレフィックスを取り除く
function toErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const marker = "': ";
    const index = message.indexOf(marker);
    return index >= 0 ? message.slice(index + marker.length) : message;
}

type AppState = {
    initialized: boolean;
    settings: AppSettings | null;
    agents: AgentCliAvailability[];
    status: ServerStatus;
    logs: LogEntry[];
    autoScroll: boolean;
    // 直近の操作エラー (Snackbar 表示用)
    lastError: string | null;
    // 現在のテーマと表示言語
    themeMode: 'light' | 'dark';
    language: AppLanguage;

    initialize(): Promise<void>;
    // 起動時に取得したアプリ情報からテーマ・言語を反映する
    applyAppInfo(info: AppInfo): void;
    setThemeMode(mode: 'light' | 'dark'): Promise<void>;
    setLanguage(language: AppLanguage): Promise<void>;
    refreshAgents(): Promise<void>;
    saveCommonSettings(common: CommonSettings): Promise<void>;
    saveAgentConfig(agentId: AgentCliId, config: AgentCliConfig): Promise<void>;
    createHint(input: { name: string; summary: string }): Promise<void>;
    updateHint(hint: TranslationHint): Promise<void>;
    deleteHint(hintId: string): Promise<void>;
    startServer(agentId: AgentCliId): Promise<void>;
    stopServer(): Promise<void>;
    setAutoScroll(value: boolean): void;
    clearError(): void;
};

export const useAppStore = create<AppState>((set, get) => ({
    initialized: false,
    settings: null,
    agents: [],
    status: { running: false, activeWorkers: 0, busyWorkers: 0, queueLength: 0 },
    logs: [],
    autoScroll: true,
    lastError: null,
    themeMode: 'light',
    language: 'en',

    applyAppInfo(info) {
        set({
            themeMode: info.theme === 'dark' ? 'dark' : 'light',
            language: info.language,
        });
        void i18n.changeLanguage(info.language);
    },

    async setThemeMode(mode) {
        set({ themeMode: mode });
        await api().setTheme(mode);
    },

    async setLanguage(language) {
        set({ language });
        void i18n.changeLanguage(language);
        await api().setLanguage(language);
    },

    async initialize() {
        if (get().initialized) return;
        set({ initialized: true });

        // 取りこぼしを防ぐためイベント購読を先に登録する
        api().log.onAdded(entry => {
            set(state => ({ logs: [...state.logs, entry].slice(-LOG_MAX_ENTRIES) }));
        });
        api().server.onStatusChanged(status => {
            set({ status });
        });

        const [settings, agents, status, logs] = await Promise.all([
            api().settings.getAll(),
            api().detectAgents(),
            api().server.getStatus(),
            api().log.getRecent(),
        ]);
        set(state => ({
            settings,
            agents,
            status,
            // 購読済みイベントで受信したログと重複しないようマージする
            logs: [...logs, ...state.logs.filter(l => !logs.some(existing => existing.id === l.id))].slice(
                -LOG_MAX_ENTRIES
            ),
        }));
    },

    async refreshAgents() {
        const agents = await api().detectAgents();
        set({ agents });
    },

    async saveCommonSettings(common) {
        try {
            const settings = await api().settings.saveCommon(common);
            set({ settings });
        } catch (error) {
            set({ lastError: toErrorMessage(error) });
            throw error;
        }
    },

    async saveAgentConfig(agentId, config) {
        try {
            const settings = await api().settings.saveAgent(agentId, config);
            set({ settings });
        } catch (error) {
            set({ lastError: toErrorMessage(error) });
            throw error;
        }
    },

    async createHint(input) {
        try {
            const settings = await api().hints.create(input);
            set({ settings });
        } catch (error) {
            set({ lastError: toErrorMessage(error) });
            throw error;
        }
    },

    async updateHint(hint) {
        try {
            const settings = await api().hints.update(hint);
            set({ settings });
        } catch (error) {
            set({ lastError: toErrorMessage(error) });
            throw error;
        }
    },

    async deleteHint(hintId) {
        try {
            const settings = await api().hints.remove(hintId);
            set({ settings });
        } catch (error) {
            set({ lastError: toErrorMessage(error) });
            throw error;
        }
    },

    async startServer(agentId) {
        try {
            const status = await api().server.start(agentId);
            set({ status });
        } catch (error) {
            set({ lastError: toErrorMessage(error) });
        }
    },

    async stopServer() {
        try {
            const status = await api().server.stop();
            set({ status });
        } catch (error) {
            set({ lastError: toErrorMessage(error) });
        }
    },

    setAutoScroll(value) {
        set({ autoScroll: value });
    },

    clearError() {
        set({ lastError: null });
    },
}));
