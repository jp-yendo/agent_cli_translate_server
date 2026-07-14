import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Ollama } from 'ollama';
import { getApiProviderDefinition, type ApiProviderId } from '../../shared/api-provider-catalog';
import type { ApiProviderConfig } from '../../shared/models/api-provider-config';
import type { ApiConnectionTestResult } from '../../shared/types';

// API プロバイダーのモデル一覧取得・接続テスト
// 設定画面から未保存の設定で呼ばれるため、都度クライアントを生成する

const REQUEST_TIMEOUT_MS = 15_000;

function resolveBaseUrl(providerId: ApiProviderId, config: ApiProviderConfig): string {
    return config.baseUrl.trim() || getApiProviderDefinition(providerId).defaultBaseUrl;
}

function withDeadline<T>(promise: PromiseLike<T>, onTimeout: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onTimeout();
            reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
        }, REQUEST_TIMEOUT_MS);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        );
    });
}

function normalize(names: string[]): string[] {
    return [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function listApiModels(providerId: ApiProviderId, config: ApiProviderConfig): Promise<string[]> {
    const baseUrl = resolveBaseUrl(providerId, config);
    const apiKey = config.apiKey.trim();

    if (providerId === 'ollama') {
        const client = new Ollama({ host: baseUrl });
        const res = await withDeadline(client.list(), () => client.abort());
        return normalize(res.models.map(model => model.name));
    }
    if (providerId === 'openai-compatible') {
        const client = new OpenAI({ apiKey: apiKey || 'not-needed', baseURL: baseUrl });
        const res = await withDeadline(client.models.list(), () => {});
        return normalize(res.data.map(model => model.id));
    }
    const client = new Anthropic({ apiKey: apiKey || 'not-needed', baseURL: baseUrl });
    const res = await withDeadline(client.models.list(), () => {});
    return normalize(res.data.map(model => model.id));
}

export async function testApiConnection(
    providerId: ApiProviderId,
    config: ApiProviderConfig
): Promise<ApiConnectionTestResult> {
    try {
        // モデル一覧取得の成否を疎通確認として用いる (件数は問わない)
        await listApiModels(providerId, config);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
