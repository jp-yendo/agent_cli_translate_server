// Agent CLI 共通のサーバー設定 (common テーブル相当)
export type CommonSettings = {
    // 待ち受けアドレス
    host: string;
    // 待ち受けポート
    port: number;
    // from パラメータ省略時のフォールバック言語コード
    fallbackFrom: string;
    // to パラメータ省略時のフォールバック言語コード
    fallbackTo: string;
    // 未使用エージェントの保持期間 (秒)
    agentRetentionSec: number;
};

export const DEFAULT_COMMON_SETTINGS: CommonSettings = {
    host: '127.0.0.1',
    port: 4660,
    fallbackFrom: 'en',
    fallbackTo: 'ja',
    agentRetentionSec: 300,
};
