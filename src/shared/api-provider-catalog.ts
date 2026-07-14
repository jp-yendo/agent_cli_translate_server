// API 接続で翻訳を行うプロバイダーのカタログ定義 (静的メタデータ)
//
// Agent CLI (ローカルプロセス起動) とは異なり、公式ライブラリ経由で
// リモート/ローカルの API エンドポイントへ直接リクエストする。

export type ApiProviderId = 'ollama' | 'openai-compatible' | 'anthropic-compatible';

export type ApiProviderDefinition = {
    id: ApiProviderId;
    // 画面表示名
    displayName: string;
    // Base URL 未設定時に利用する既定のエンドポイント
    defaultBaseUrl: string;
};

export const API_PROVIDER_DEFINITIONS: ApiProviderDefinition[] = [
    {
        id: 'ollama',
        displayName: 'Ollama',
        defaultBaseUrl: 'http://localhost:11434',
    },
    {
        id: 'openai-compatible',
        displayName: 'OpenAI Compatible API',
        defaultBaseUrl: 'https://api.openai.com/v1',
    },
    {
        id: 'anthropic-compatible',
        displayName: 'Anthropic Compatible API',
        defaultBaseUrl: 'https://api.anthropic.com',
    },
];

export const API_PROVIDER_IDS: ApiProviderId[] = API_PROVIDER_DEFINITIONS.map(def => def.id);

export function getApiProviderDefinition(id: ApiProviderId): ApiProviderDefinition {
    const def = API_PROVIDER_DEFINITIONS.find(d => d.id === id);
    if (!def) {
        throw new Error(`Unknown API provider id: ${id}`);
    }
    return def;
}

export function isApiProviderId(id: string): id is ApiProviderId {
    return API_PROVIDER_IDS.includes(id as ApiProviderId);
}
