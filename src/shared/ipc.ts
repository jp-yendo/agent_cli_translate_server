import type {
    AgentCliAvailability,
    ApiConnectionTestResult,
    AppInfo,
    AppLanguage,
    AppSettings,
    AppTheme,
    EngineId,
    LogEntry,
    ServerStatus,
    UpdateState,
} from './types';
import type { AgentCliId } from './agent-catalog';
import type { ApiProviderId } from './api-provider-catalog';
import type { AgentCliConfig } from './models/agent-cli-config';
import type { ApiProviderConfig } from './models/api-provider-config';
import type { CommonSettings } from './models/common-settings';
import type { TranslationHint } from './models/translation-hint';

// IPC APIの型定義
export type IpcApi = {
    // アプリ情報・設定
    getAppInfo(): Promise<AppInfo>;
    setTheme(theme: AppTheme): Promise<{ theme: AppTheme }>;
    setLanguage(language: AppLanguage): Promise<{ language: AppLanguage }>;
    // 設定
    settings: {
        getAll(): Promise<AppSettings>;
        saveCommon(common: CommonSettings): Promise<AppSettings>;
        saveAgent(agentId: AgentCliId, config: AgentCliConfig): Promise<AppSettings>;
        saveApiProvider(providerId: ApiProviderId, config: ApiProviderConfig): Promise<AppSettings>;
    };
    // 翻訳ヒント管理
    hints: {
        create(input: { name: string; summary: string }): Promise<AppSettings>;
        update(hint: TranslationHint): Promise<AppSettings>;
        remove(hintId: string): Promise<AppSettings>;
    };
    // Agent CLI 検出
    detectAgents(): Promise<AgentCliAvailability[]>;
    // API プロバイダーの接続テスト・モデル一覧取得
    apiProbe: {
        testConnection(providerId: ApiProviderId, config: ApiProviderConfig): Promise<ApiConnectionTestResult>;
        listModels(providerId: ApiProviderId, config: ApiProviderConfig): Promise<string[]>;
    };
    // 翻訳サーバー制御
    server: {
        start(engineId: EngineId): Promise<ServerStatus>;
        stop(): Promise<ServerStatus>;
        getStatus(): Promise<ServerStatus>;
        onStatusChanged(listener: (status: ServerStatus) => void): () => void;
    };
    // 動作状況ログ
    log: {
        getRecent(): Promise<LogEntry[]>;
        onAdded(listener: (entry: LogEntry) => void): () => void;
    };
    // ウィンドウ制御
    minimize(): Promise<void>;
    maximizeOrRestore(): Promise<boolean>;
    isMaximized(): Promise<boolean>;
    close(): Promise<void>;
    // 自動アップデート (electron-updater)
    updater: {
        // 起動時の状態を取得 (UI 初期化に利用)
        getState(): Promise<UpdateState>;
        // GitHub Releases に新しいバージョンがあるかチェック (ダウンロードはしない)
        check(): Promise<UpdateState>;
        // 利用可能なアップデートのダウンロードを開始
        download(): Promise<UpdateState>;
        // ダウンロード済みのアップデートを適用してアプリを再起動
        quitAndInstall(): Promise<void>;
        // アップデート状態の変化を購読 (戻り値は購読解除関数)
        onStateChanged(listener: (state: UpdateState) => void): () => void;
    };
};

declare global {
    interface Window {
        agentCliTranslateServer: IpcApi;
    }
}
