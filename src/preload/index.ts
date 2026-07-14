import { contextBridge, ipcRenderer } from 'electron';
import type { IpcApi } from '../shared/ipc';
import type { EngineId, LogEntry, ServerStatus, UpdateState } from '../shared/types';
import type { AgentCliId } from '../shared/agent-catalog';
import type { ApiProviderId } from '../shared/api-provider-catalog';
import type { AgentCliConfig } from '../shared/models/agent-cli-config';
import type { ApiProviderConfig } from '../shared/models/api-provider-config';
import type { CommonSettings } from '../shared/models/common-settings';
import type { TranslationHint } from '../shared/models/translation-hint';

// IPCチャンネル定義（ランタイムでsharedからインポートを避けるためローカルコピー）
const IPC_CHANNELS = {
    APP_GET_INFO: 'app:getInfo',
    APP_SET_THEME: 'app:setTheme',
    APP_SET_LANGUAGE: 'app:setLanguage',
    WINDOW_MINIMIZE: 'window:minimize',
    WINDOW_MAXIMIZE_OR_RESTORE: 'window:maximizeOrRestore',
    WINDOW_CLOSE: 'window:close',
    WINDOW_IS_MAXIMIZED: 'window:isMaximized',
    MAIN_CONSOLE: 'main:console',
    UPDATER_CHECK: 'updater:check',
    UPDATER_DOWNLOAD: 'updater:download',
    UPDATER_QUIT_AND_INSTALL: 'updater:quitAndInstall',
    UPDATER_GET_STATE: 'updater:getState',
    UPDATER_STATE_CHANGED: 'updater:stateChanged',
    SETTINGS_GET_ALL: 'settings:getAll',
    SETTINGS_SAVE_COMMON: 'settings:saveCommon',
    SETTINGS_SAVE_AGENT: 'settings:saveAgent',
    SETTINGS_SAVE_API_PROVIDER: 'settings:saveApiProvider',
    API_TEST_CONNECTION: 'api:testConnection',
    API_LIST_MODELS: 'api:listModels',
    HINTS_CREATE: 'hints:create',
    HINTS_UPDATE: 'hints:update',
    HINTS_DELETE: 'hints:delete',
    AGENTS_DETECT: 'agents:detect',
    SERVER_START: 'server:start',
    SERVER_STOP: 'server:stop',
    SERVER_GET_STATUS: 'server:getStatus',
    SERVER_STATUS_CHANGED: 'server:statusChanged',
    LOG_GET_RECENT: 'log:getRecent',
    LOG_ADDED: 'log:added',
} as const;

const api: IpcApi = {
    async getAppInfo() {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO);
    },
    async setTheme(theme) {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_SET_THEME, theme);
    },
    async setLanguage(language) {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_SET_LANGUAGE, language);
    },
    async minimize() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE);
    },
    async maximizeOrRestore() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE_OR_RESTORE);
    },
    async isMaximized() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED);
    },
    async close() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE);
    },
    settings: {
        async getAll() {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL);
        },
        async saveCommon(common: CommonSettings) {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE_COMMON, common);
        },
        async saveAgent(agentId: AgentCliId, config: AgentCliConfig) {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE_AGENT, agentId, config);
        },
        async saveApiProvider(providerId: ApiProviderId, config: ApiProviderConfig) {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE_API_PROVIDER, providerId, config);
        },
    },
    hints: {
        async create(input: { name: string; summary: string }) {
            return ipcRenderer.invoke(IPC_CHANNELS.HINTS_CREATE, input);
        },
        async update(hint: TranslationHint) {
            return ipcRenderer.invoke(IPC_CHANNELS.HINTS_UPDATE, hint);
        },
        async remove(hintId: string) {
            return ipcRenderer.invoke(IPC_CHANNELS.HINTS_DELETE, hintId);
        },
    },
    async detectAgents() {
        return ipcRenderer.invoke(IPC_CHANNELS.AGENTS_DETECT);
    },
    apiProbe: {
        async testConnection(providerId: ApiProviderId, config: ApiProviderConfig) {
            return ipcRenderer.invoke(IPC_CHANNELS.API_TEST_CONNECTION, providerId, config);
        },
        async listModels(providerId: ApiProviderId, config: ApiProviderConfig) {
            return ipcRenderer.invoke(IPC_CHANNELS.API_LIST_MODELS, providerId, config);
        },
    },
    server: {
        async start(engineId: EngineId) {
            return ipcRenderer.invoke(IPC_CHANNELS.SERVER_START, engineId);
        },
        async stop() {
            return ipcRenderer.invoke(IPC_CHANNELS.SERVER_STOP);
        },
        async getStatus() {
            return ipcRenderer.invoke(IPC_CHANNELS.SERVER_GET_STATUS);
        },
        onStatusChanged(listener: (status: ServerStatus) => void) {
            const handler = (_event: Electron.IpcRendererEvent, status: ServerStatus) => listener(status);
            ipcRenderer.on(IPC_CHANNELS.SERVER_STATUS_CHANGED, handler);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.SERVER_STATUS_CHANGED, handler);
            };
        },
    },
    log: {
        async getRecent() {
            return ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_RECENT);
        },
        onAdded(listener: (entry: LogEntry) => void) {
            const handler = (_event: Electron.IpcRendererEvent, entry: LogEntry) => listener(entry);
            ipcRenderer.on(IPC_CHANNELS.LOG_ADDED, handler);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.LOG_ADDED, handler);
            };
        },
    },
    updater: {
        async getState() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_GET_STATE);
        },
        async check() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK);
        },
        async download() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD);
        },
        async quitAndInstall() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL);
        },
        onStateChanged(listener: (state: UpdateState) => void) {
            const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
            ipcRenderer.on(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
            };
        },
    },
};

contextBridge.exposeInMainWorld('agentCliTranslateServer', api);

// メインプロセスのコンソールメッセージを受信してDevToolsに転送
ipcRenderer.on(
    IPC_CHANNELS.MAIN_CONSOLE,
    (
        _event,
        data: {
            level: string;
            args: Array<{ type: string; value?: string; message?: string; stack?: string; name?: string }>;
        }
    ) => {
        const { level, args } = data;
        // DevTools出力用に引数をデシリアライズ
        const deserializedArgs = args.map(arg => {
            if (arg.type === 'error') {
                const error = new Error(arg.message || 'Unknown error');
                if (arg.stack) error.stack = arg.stack;
                if (arg.name) error.name = arg.name;
                return error;
            } else if (arg.type === 'object') {
                try {
                    return JSON.parse(arg.value || '{}');
                } catch {
                    return arg.value;
                }
            } else {
                return arg.value;
            }
        });

        // レンダラーコンソールに転送（DevToolsに表示される）
        switch (level) {
            case 'log':
                console.log('[Main]', ...deserializedArgs);
                break;
            case 'error':
                console.error('[Main]', ...deserializedArgs);
                break;
            case 'warn':
                console.warn('[Main]', ...deserializedArgs);
                break;
            case 'info':
                console.info('[Main]', ...deserializedArgs);
                break;
            case 'debug':
                console.debug('[Main]', ...deserializedArgs);
                break;
            default:
                console.log('[Main]', ...deserializedArgs);
        }
    }
);
