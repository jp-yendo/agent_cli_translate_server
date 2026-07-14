import os from 'os';
import path from 'path';

// アプリケーションのディレクトリ名
export const APP_DIR_NAME = '.agent_cli_translate_server';

// ホームディレクトリを取得
export function getHomeDir(): string {
    return os.homedir();
}

// アプリルートディレクトリを取得
export function getAppRootDir(): string {
    return path.join(getHomeDir(), APP_DIR_NAME);
}

// Node.js に依存しない共通定数を再公開する
export * from './app-constants';

// IPCチャンネル定義
export const IPC_CHANNELS = {
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
