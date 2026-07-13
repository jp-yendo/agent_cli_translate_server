// メイン・レンダラー双方から参照する定数
// (このファイルは Node.js モジュールに依存してはならない)

// 設定ファイル名
export const SETTINGS_FILE_NAME = 'settings.json';

// エージェント実行の内部タイムアウト (ミリ秒)
// 待ちキュー自体は無制限だが、実行中エージェントのハングを検出するための保険
export const AGENT_EXECUTION_TIMEOUT_MS = 120_000;

// 画面に保持する動作状況ログの最大件数
export const LOG_MAX_ENTRIES = 200;
