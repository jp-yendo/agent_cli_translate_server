// 共通のサーバー設定 (common テーブル相当)
export type CommonSettings = {
    // 待ち受けアドレス
    host: string;
    // 待ち受けポート
    port: number;
    // from パラメータ省略時のフォールバック言語コード
    fallbackFrom: string;
    // to パラメータ省略時のフォールバック言語コード
    fallbackTo: string;
    // エージェントプロセスの最大稼働時間 (秒)
    agentRetentionSec: number;
    // 全エンジン共通で利用する翻訳ヒントのID (未使用時は null)
    hintId: string | null;
};

export const DEFAULT_COMMON_SETTINGS: CommonSettings = {
    host: '127.0.0.1',
    port: 4660,
    fallbackFrom: 'en',
    fallbackTo: 'ja',
    agentRetentionSec: 300,
    hintId: null,
};
