// API プロバイダーごとの設定 (apiProviders テーブル相当)
export type ApiProviderConfig = {
    // エンドポイントの Base URL。空文字の場合はプロバイダー既定値を使用する
    baseUrl: string;
    // API Key。ローカルサーバー等で不要な場合は空文字
    apiKey: string;
    // 利用するモデル名 (必須)
    model: string;
    // 同時接続数 (並行して呼び出せる API リクエスト数の上限)
    // ローカル LLM 等では端末性能に依存するため必須。デフォルト 1
    maxConcurrency: number;
};

export function createDefaultApiProviderConfig(): ApiProviderConfig {
    return {
        baseUrl: '',
        apiKey: '',
        model: '',
        maxConcurrency: 1,
    };
}
