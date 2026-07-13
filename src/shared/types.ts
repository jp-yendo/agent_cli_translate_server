// プラットフォーム識別子
export type PlatformId = 'win32' | 'darwin' | 'linux';

// アプリのテーマ設定
export type AppTheme = 'light' | 'dark' | 'system';

// アプリの言語設定
export type AppLanguage = 'ja' | 'en';

// アプリ情報
export type AppInfo = {
    name: string;
    version: string;
    language: AppLanguage;
    theme: AppTheme;
    os: PlatformId;
};

import type { AgentCliId } from './agent-catalog';
import type { AgentCliConfig } from './models/agent-cli-config';
import type { CommonSettings } from './models/common-settings';
import type { TranslationHint } from './models/translation-hint';
import type { UiSettings } from './models/ui-settings';

// Agent CLI の検出結果
export type AgentCliAvailability = {
    id: AgentCliId;
    displayName: string;
    command: string;
    packageName: string;
    // コマンドが実行可能として検出されたか
    available: boolean;
    // 検出されたコマンドのフルパス
    resolvedPath?: string;
};

// 設定ファイル全体 (~/.agent_cli_translate_server/settings.json)
export type AppSettings = {
    common: CommonSettings;
    agents: Record<AgentCliId, AgentCliConfig>;
    hints: TranslationHint[];
    ui: UiSettings;
};

// 翻訳サーバーの稼働状態
export type ServerStatus = {
    running: boolean;
    // 稼働中の Agent CLI
    agentId?: AgentCliId;
    host?: string;
    port?: number;
    // 起動済みエージェント数
    activeWorkers: number;
    // 翻訳処理中のエージェント数
    busyWorkers: number;
    // 待ち状態の翻訳リクエスト数
    queueLength: number;
};

// 動作状況ログの種別
export type LogLevel = 'info' | 'request' | 'success' | 'warn' | 'error';

// 動作状況ログの1件分
// メインプロセスは i18n を持たないため、メッセージはキーとパラメータで表現し
// レンダラー側で翻訳して表示する
export type LogEntry = {
    id: number;
    // エポックミリ秒
    timestamp: number;
    level: LogLevel;
    // レンダラーの i18n リソース log.* に対応するキー
    key: string;
    // メッセージへ埋め込むパラメータ
    params?: Record<string, string | number>;
};

// 自動アップデートの状態
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

// 自動アップデートの状態ペイロード
export type UpdateState = {
    status: UpdateStatus;
    // リモート上で公開されている最新バージョン (取得済みの場合)
    version?: string;
    // ダウンロード進捗 (0-100)
    progress?: number;
    // 直近のエラーメッセージ (status='error' 時のみ)
    error?: string;
};
