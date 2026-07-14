import http from 'http';
import { isSupportedLanguage } from '../../shared/languages';
import { DEFAULT_COMMON_SETTINGS } from '../../shared/models/common-settings';
import type { LogLevel } from '../../shared/types';
import { isDynamicValue, shouldSkipTranslation } from './text-filter';
import type { AgentPool } from './agent-pool';

// XUnity.AutoTranslator の CustomTranslate 仕様に準拠した HTTP サーバー
//
// GET /translate?from={src}&to={dst}&text={text}
//   -> 200 + 翻訳結果 (text/plain)
//   -> 400 (text 未指定 / 動的な値 / 非対応言語コード。キャッシュさせないため本文は空)
//   -> 500 (翻訳失敗。キャッシュさせないため本文は空)
// GET /health -> 200 "ok"

export type TranslationServerOptions = {
    host: string;
    port: number;
    fallbackFrom: string;
    fallbackTo: string;
    hintSummary?: string;
    pool: AgentPool;
    log: (level: LogLevel, key: string, params?: Record<string, string | number>) => void;
};

const TEXT_PLAIN = { 'Content-Type': 'text/plain; charset=utf-8' };

// ログ表示用にテキストを1行・最大長へ丸める
function summarizeText(text: string, maxLength = 80): string {
    const singleLine = text.replace(/\r?\n/g, '\\n');
    return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine;
}

export class TranslationServer {
    private server: http.Server | null = null;

    constructor(private readonly opts: TranslationServerOptions) {}

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                void this.handleRequest(req, res);
            });
            const onStartupError = (error: Error) => {
                this.server = null;
                reject(error);
            };
            server.once('error', onStartupError);
            server.listen(this.opts.port, this.opts.host, () => {
                // Listen 成功後のエラーは起動失敗ではないため、ログ出力のみに切り替える
                server.removeListener('error', onStartupError);
                server.on('error', error => {
                    this.opts.log('error', 'translationError', { error: error.message });
                });
                this.server = server;
                resolve();
            });
        });
    }

    stop(): Promise<void> {
        return new Promise(resolve => {
            const server = this.server;
            this.server = null;
            if (!server) {
                resolve();
                return;
            }
            server.close(() => resolve());
            // 処理中の接続を強制切断して close を完了させる
            server.closeAllConnections();
        });
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

            if (req.method !== 'GET') {
                res.writeHead(405, TEXT_PLAIN);
                res.end('');
                return;
            }

            if (url.pathname === '/health') {
                res.writeHead(200, TEXT_PLAIN);
                res.end('ok');
                return;
            }

            if (url.pathname === '/translate') {
                await this.handleTranslate(url, res);
                return;
            }

            res.writeHead(404, TEXT_PLAIN);
            res.end('');
        } catch (error) {
            this.opts.log('error', 'translationError', {
                error: error instanceof Error ? error.message : String(error),
            });
            if (!res.headersSent) {
                res.writeHead(500, TEXT_PLAIN);
            }
            res.end('');
        }
    }

    private async handleTranslate(url: URL, res: http.ServerResponse): Promise<void> {
        const text = url.searchParams.get('text');
        let srcLang = url.searchParams.get('from');
        let dstLang = url.searchParams.get('to');

        if (!text) {
            // text 未指定はエラー (キャッシュさせない)
            res.writeHead(400, TEXT_PLAIN);
            res.end('');
            return;
        }

        // 動的な値 (FPS表示など) は 400 を返して翻訳をキャッシュさせない
        if (isDynamicValue(text)) {
            res.writeHead(400, TEXT_PLAIN);
            res.end('');
            return;
        }

        // 翻訳不要なテキスト (数字・空白・記号のみ) はそのまま返す (200 でキャッシュさせる)
        if (shouldSkipTranslation(text)) {
            res.writeHead(200, TEXT_PLAIN);
            res.end(text);
            return;
        }

        // 言語コード未指定時はフォールバック設定を利用する
        if (!srcLang) {
            srcLang = this.opts.fallbackFrom || DEFAULT_COMMON_SETTINGS.fallbackFrom;
        }
        if (!dstLang) {
            dstLang = this.opts.fallbackTo || DEFAULT_COMMON_SETTINGS.fallbackTo;
        }

        if (!isSupportedLanguage(srcLang) || !isSupportedLanguage(dstLang)) {
            const invalid = !isSupportedLanguage(srcLang) ? srcLang : dstLang;
            this.opts.log('warn', 'invalidLanguage', { lang: invalid });
            res.writeHead(400, TEXT_PLAIN);
            res.end('');
            return;
        }

        this.opts.log('request', 'requestReceived', {
            from: srcLang,
            to: dstLang,
            text: summarizeText(text),
        });

        const startedAt = Date.now();
        try {
            const translation = await this.opts.pool.run({
                text,
                srcLang,
                dstLang,
                appSummary: this.opts.hintSummary,
            });
            const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);

            this.opts.log('success', 'translationDone', {
                text: summarizeText(translation),
                elapsed: elapsedSec,
            });
            res.writeHead(200, TEXT_PLAIN);
            res.end(translation);
        } catch (error) {
            const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
            this.opts.log('error', 'translationError', {
                error: error instanceof Error ? error.message : String(error),
                elapsed: elapsedSec,
            });
            // 失敗時はキャッシュさせないため本文なしの 500 を返す
            res.writeHead(500, TEXT_PLAIN);
            res.end('');
        }
    }
}
