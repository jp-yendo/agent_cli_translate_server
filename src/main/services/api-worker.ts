import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Ollama } from 'ollama';
import { AGENT_EXECUTION_TIMEOUT_MS } from '../../shared/constants';
import { getApiProviderDefinition, type ApiProviderId } from '../../shared/api-provider-catalog';
import type { ApiProviderConfig } from '../../shared/models/api-provider-config';
import type { TranslationWorker } from './agent-worker';
import { runTranslationAttempts, type ChatMessages, type TranslationRequest } from './prompt-builder';

// API 接続で翻訳を行うワーカー
//
// Agent CLI ワーカーと異なりローカルプロセスを保持しない。公式ライブラリ
// (openai / @anthropic-ai/sdk / ollama) を用いてリクエストごとに API を呼び出す。
// プールとの互換性のため TranslationWorker を実装するが、プロセス起動が無いため
// warmUp は設定の検証とクライアント生成のみ、最大稼働時間・最大利用回数による
// プロセス再作成は行わない (isReusable は破棄されるまで常に true)。

// Anthropic API は max_tokens が必須のため、翻訳結果に十分な上限を設定する
const ANTHROPIC_MAX_TOKENS = 4096;

class ApiTranslationWorker implements TranslationWorker {
    private disposed = false;
    private readonly controllers = new Set<AbortController>();
    private openai: OpenAI | null = null;
    private anthropic: Anthropic | null = null;
    private ollama: Ollama | null = null;
    readonly processStartedAt = Date.now();

    constructor(
        readonly index: number,
        private readonly providerId: ApiProviderId,
        private readonly config: ApiProviderConfig
    ) {}

    get alive(): boolean {
        return !this.disposed;
    }

    isReusable(): boolean {
        return !this.disposed;
    }

    // 設定を検証し、公式ライブラリのクライアントを生成する (ネットワーク接続は行わない)
    async warmUp(): Promise<void> {
        if (this.disposed) {
            throw new Error('Worker is already disposed');
        }
        const def = getApiProviderDefinition(this.providerId);
        const model = this.config.model.trim();
        if (!model) {
            throw new Error(`A model name is required for ${def.displayName}`);
        }
        const baseUrl = this.config.baseUrl.trim() || def.defaultBaseUrl;
        const apiKey = this.config.apiKey.trim();

        if (this.providerId === 'ollama') {
            this.ollama ??= new Ollama({ host: baseUrl });
        } else if (this.providerId === 'openai-compatible') {
            // OpenAI SDK は空の API Key を許容しないため、未設定時はプレースホルダーを渡す
            // (認証不要なローカルサーバー等で利用できるようにする)
            this.openai ??= new OpenAI({ apiKey: apiKey || 'not-needed', baseURL: baseUrl });
        } else {
            this.anthropic ??= new Anthropic({ apiKey: apiKey || 'not-needed', baseURL: baseUrl });
        }
    }

    async run(request: TranslationRequest): Promise<string> {
        if (this.disposed) {
            throw new Error('Worker is already disposed');
        }
        await this.warmUp();
        const model = this.config.model.trim();
        return runTranslationAttempts(request, model, messages => this.execute(model, messages));
    }

    // 1 回の API 呼び出し (タイムアウト・中断を管理し、生の応答テキストを返す)
    private async execute(model: string, messages: ChatMessages): Promise<string> {
        const controller = new AbortController();
        this.controllers.add(controller);
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            // Ollama SDK はリクエスト単位の signal を受け取らないため client 側で中断する
            if (this.providerId === 'ollama') this.ollama?.abort();
        }, AGENT_EXECUTION_TIMEOUT_MS);

        try {
            if (this.providerId === 'ollama') {
                return await this.runOllama(model, messages);
            }
            if (this.providerId === 'openai-compatible') {
                return await this.runOpenAI(model, messages, controller.signal);
            }
            return await this.runAnthropic(model, messages, controller.signal);
        } catch (error) {
            if (timedOut) {
                throw new Error(`API request timed out after ${AGENT_EXECUTION_TIMEOUT_MS / 1000}s`);
            }
            throw error instanceof Error ? error : new Error(String(error));
        } finally {
            clearTimeout(timer);
            this.controllers.delete(controller);
        }
    }

    private async runOpenAI(model: string, messages: ChatMessages, signal: AbortSignal): Promise<string> {
        if (!this.openai) throw new Error('OpenAI client is not initialized');
        const chatMessages: OpenAI.ChatCompletionMessageParam[] = [];
        if (messages.system) chatMessages.push({ role: 'system', content: messages.system });
        chatMessages.push({ role: 'user', content: messages.user });
        const completion = await this.openai.chat.completions.create({ model, messages: chatMessages }, { signal });
        return completion.choices?.[0]?.message?.content ?? '';
    }

    private async runAnthropic(model: string, messages: ChatMessages, signal: AbortSignal): Promise<string> {
        if (!this.anthropic) throw new Error('Anthropic client is not initialized');
        const message = await this.anthropic.messages.create(
            {
                model,
                max_tokens: ANTHROPIC_MAX_TOKENS,
                ...(messages.system ? { system: messages.system } : {}),
                messages: [{ role: 'user', content: messages.user }],
            },
            { signal }
        );
        return message.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('');
    }

    // Ollama はストリーミングで受信し、タイムアウト時の client.abort() で中断可能にする
    private async runOllama(model: string, messages: ChatMessages): Promise<string> {
        if (!this.ollama) throw new Error('Ollama client is not initialized');
        const chatMessages = [];
        if (messages.system) chatMessages.push({ role: 'system', content: messages.system });
        chatMessages.push({ role: 'user', content: messages.user });
        const stream = await this.ollama.chat({ model, messages: chatMessages, stream: true });
        let text = '';
        for await (const part of stream) {
            text += part.message?.content ?? '';
        }
        return text;
    }

    dispose(): void {
        this.disposed = true;
        for (const controller of this.controllers) {
            controller.abort();
        }
        this.controllers.clear();
        this.ollama?.abort();
    }
}

export function createApiWorker(providerId: ApiProviderId, config: ApiProviderConfig, index: number): TranslationWorker {
    return new ApiTranslationWorker(index, providerId, config);
}
