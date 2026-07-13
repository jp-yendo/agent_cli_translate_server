import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { AGENT_EXECUTION_TIMEOUT_MS, getAppRootDir } from '../../shared/constants';
import type { AgentCliId } from '../../shared/agent-catalog';
import { buildCliLaunchPlan } from '../utils/cli-spawn';

// 翻訳を実行するエージェントワーカー
//
// 起動オーバーヘッドを最小化するため、全ワーカーがプロセスを保持する:
// - claude-code: stream-json モードの常駐プロセスを維持し、複数の翻訳依頼で再利用する
// - grok: ACP (grok agent stdio, JSON-RPC) の常駐プロセスを維持する
// - codex / opencode: stdin 待ちのウォームプロセスを事前起動して保持し、
//   依頼を処理して終了したら直ちに次のウォームプロセスを起動する
//
// ワーカー (スロット) の終了は保持期間の経過・サーバー停止・アプリ終了時のみ

export interface TranslationWorker {
    readonly index: number;
    readonly alive: boolean;
    lastUsedAt: number;
    // プロンプトを実行し、CLI の生の応答テキストを返す
    run(prompt: string): Promise<string>;
    isReusable(): boolean;
    // プロセスを事前起動して待機状態にする
    warmUp(): void;
    dispose(): void;
}

// 常駐プロセスのコンテキスト肥大を防ぐための最大利用回数
// (超過時はスロットを維持したままプロセスのみ作り直す)
const PERSISTENT_WORKER_MAX_USES = 50;

function getWorkerCwd(): string {
    const dir = getAppRootDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// 子プロセスをプロセスツリーごと終了させる
// Windows では kill() が直接の子 (node ランチャー等) しか終了させないため、
// taskkill /T で孫プロセス (実体の CLI) まで確実に終了させる
function killProcessTree(child: ChildProcess): void {
    if (child.killed || child.exitCode !== null || !child.pid) {
        return;
    }
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            return;
        } catch {
            // taskkill が使えない場合は通常の kill にフォールバックする
        }
    }
    child.kill();
}

function withTimeout<T>(promise: Promise<T>, onTimeout: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onTimeout();
            reject(new Error(`Agent execution timed out after ${AGENT_EXECUTION_TIMEOUT_MS / 1000}s`));
        }, AGENT_EXECUTION_TIMEOUT_MS);
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

function spawnCli(resolvedPath: string, args: string[]): ChildProcess {
    const plan = buildCliLaunchPlan(resolvedPath, args);
    const child = spawn(plan.file, plan.args, {
        cwd: getWorkerCwd(),
        env: plan.env,
        shell: plan.useShell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    // EPIPE 等の stdin エラーでメインプロセスが落ちないようにする
    // (失敗自体は close / error イベント経由で報告される)
    child.stdin?.on('error', () => {});
    return child;
}

// codex / opencode 用のウォーム待機型ワーカー
// プロンプトを標準入力から受け取る一発実行 CLI を事前起動しておき、
// 依頼が来たら stdin へ書き込んで応答を得る。プロセスは応答後に終了するため、
// すぐに次のウォームプロセスを起動して待機状態を保つ。
class WarmStdinWorker implements TranslationWorker {
    lastUsedAt = Date.now();
    private disposed = false;
    private warm: { child: ChildProcess; stdout: string; stderr: string } | null = null;
    private pending: { resolve(value: string): void; reject(error: Error): void } | null = null;

    constructor(
        readonly index: number,
        private readonly agentId: AgentCliId,
        private readonly resolvedPath: string
    ) {}

    get alive(): boolean {
        return !this.disposed;
    }

    isReusable(): boolean {
        return !this.disposed;
    }

    private buildArgs(): string[] {
        switch (this.agentId) {
            case 'codex':
                // "-" で標準入力からプロンプトを読み込む
                return ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'];
            case 'opencode':
                // 引数なしの run は標準入力からプロンプトを読み込む
                return ['run'];
            default:
                throw new Error(`WarmStdinWorker does not support agent: ${this.agentId}`);
        }
    }

    warmUp(): void {
        if (this.disposed || this.warm) return;
        const child = spawnCli(this.resolvedPath, this.buildArgs());
        const state = { child, stdout: '', stderr: '' };
        child.stdout?.on('data', (chunk: string) => {
            state.stdout += chunk;
        });
        child.stderr?.on('data', (chunk: string) => {
            state.stderr += chunk;
        });
        child.on('error', error => this.handleClose(state, error));
        child.on('close', code => this.handleClose(state, null, code));
        this.warm = state;
    }

    private handleClose(
        state: { child: ChildProcess; stdout: string; stderr: string },
        error: Error | null,
        code?: number | null
    ): void {
        if (this.warm?.child === state.child) {
            this.warm = null;
        }
        const pending = this.pending;
        if (!pending) {
            // 待機中のウォームプロセスが死んだ場合は次の依頼時に起動し直す
            return;
        }
        this.pending = null;
        if (error) {
            pending.reject(error);
        } else if (code === 0) {
            pending.resolve(state.stdout);
        } else {
            const detail = (state.stderr || state.stdout).slice(0, 500);
            pending.reject(new Error(`${this.agentId} exited with code ${String(code)}: ${detail}`));
        }
        // 次の依頼に備えてウォームプロセスを起動しておく
        if (!this.disposed) {
            this.warmUp();
        }
    }

    run(prompt: string): Promise<string> {
        if (this.disposed) {
            return Promise.reject(new Error('Worker is already disposed'));
        }
        if (this.pending) {
            return Promise.reject(new Error('Worker is busy'));
        }
        this.warmUp();
        const state = this.warm;
        if (!state) {
            return Promise.reject(new Error(`Failed to start ${this.agentId} process`));
        }

        const execution = new Promise<string>((resolve, reject) => {
            this.pending = { resolve, reject };
            state.child.stdin?.write(prompt);
            state.child.stdin?.end();
        });

        return withTimeout(execution, () => killProcessTree(state.child));
    }

    dispose(): void {
        this.disposed = true;
        if (this.pending) {
            const pending = this.pending;
            this.pending = null;
            pending.reject(new Error('Worker disposed'));
        }
        if (this.warm) {
            killProcessTree(this.warm.child);
            this.warm = null;
        }
    }
}

// claude-code 用の常駐ワーカー
// stream-json の入出力で1プロセスに複数の翻訳依頼を処理させる
class PersistentClaudeWorker implements TranslationWorker {
    lastUsedAt = Date.now();
    private disposed = false;
    private child: ChildProcess | null = null;
    private stdoutBuffer = '';
    private stderrTail = '';
    private useCount = 0;
    private pending: { resolve(value: string): void; reject(error: Error): void } | null = null;

    constructor(
        readonly index: number,
        private readonly resolvedPath: string
    ) {}

    get alive(): boolean {
        return !this.disposed;
    }

    isReusable(): boolean {
        return !this.disposed;
    }

    warmUp(): void {
        if (!this.disposed && !this.child) {
            this.ensureProcess();
        }
    }

    private ensureProcess(): ChildProcess {
        if (this.child) return this.child;

        const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
        const child = spawnCli(this.resolvedPath, args);
        this.stdoutBuffer = '';
        this.stderrTail = '';
        this.useCount = 0;
        child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));
        // stderr を消費しないとパイプバッファが詰まりプロセスがブロックするため、
        // 常に読み捨てつつ診断用に末尾のみ保持する
        child.stderr?.on('data', (chunk: string) => {
            this.stderrTail = (this.stderrTail + chunk).slice(-2000);
        });
        child.on('error', error => this.handleExit(child, error));
        child.on('close', code =>
            this.handleExit(
                child,
                new Error(`claude process exited with code ${String(code)}: ${this.stderrTail.slice(-300)}`)
            )
        );
        this.child = child;
        return child;
    }

    private handleStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        let newlineIndex = this.stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
            if (line) {
                this.handleLine(line);
            }
            newlineIndex = this.stdoutBuffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        let message: { type?: string; subtype?: string; is_error?: boolean; result?: unknown };
        try {
            message = JSON.parse(line) as typeof message;
        } catch {
            return;
        }
        if (message.type !== 'result' || !this.pending) {
            return;
        }
        const pending = this.pending;
        this.pending = null;
        if (message.is_error || message.subtype !== 'success' || typeof message.result !== 'string') {
            pending.reject(new Error(`claude returned an error result: ${line.slice(0, 300)}`));
            return;
        }
        pending.resolve(message.result);
    }

    // プロセス終了時の処理。スロット自体は維持し、次の依頼で起動し直す
    private handleExit(child: ChildProcess, error: Error): void {
        if (this.child === child) {
            this.child = null;
        }
        if (this.pending) {
            const pending = this.pending;
            this.pending = null;
            pending.reject(error);
        }
    }

    // コンテキスト肥大防止のため、利用回数超過時はプロセスのみ作り直す
    private recycleProcess(): void {
        if (this.child) {
            const child = this.child;
            this.child = null;
            try {
                child.stdin?.end();
            } catch {
                // 無視: プロセスが既に終了している場合がある
            }
            killProcessTree(child);
        }
        this.ensureProcess();
    }

    run(prompt: string): Promise<string> {
        if (this.disposed) {
            return Promise.reject(new Error('Worker is already disposed'));
        }
        if (this.pending) {
            return Promise.reject(new Error('Worker is busy'));
        }
        if (this.child && this.useCount >= PERSISTENT_WORKER_MAX_USES) {
            this.recycleProcess();
        }

        const execution = new Promise<string>((resolve, reject) => {
            this.pending = { resolve, reject };
            try {
                const child = this.ensureProcess();
                const message = {
                    type: 'user',
                    message: {
                        role: 'user',
                        content: [{ type: 'text', text: prompt }],
                    },
                };
                child.stdin?.write(`${JSON.stringify(message)}\n`);
                this.useCount += 1;
            } catch (error) {
                this.pending = null;
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });

        return withTimeout(execution, () => {
            if (this.child) {
                killProcessTree(this.child);
            }
        });
    }

    dispose(): void {
        this.disposed = true;
        if (this.pending) {
            const pending = this.pending;
            this.pending = null;
            pending.reject(new Error('Worker disposed'));
        }
        if (this.child) {
            const child = this.child;
            this.child = null;
            try {
                child.stdin?.end();
            } catch {
                // 無視: プロセスが既に終了している場合がある
            }
            killProcessTree(child);
        }
    }
}

// grok 用の常駐ワーカー
// ACP (Agent Client Protocol) の stdio モードで JSON-RPC により対話する
class GrokAcpWorker implements TranslationWorker {
    lastUsedAt = Date.now();
    private disposed = false;
    private child: ChildProcess | null = null;
    private stdoutBuffer = '';
    private stderrTail = '';
    private nextRequestId = 1;
    private readonly pendingById = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    private ready: Promise<string> | null = null;
    private useCount = 0;
    private messageChunks = '';
    private promptInFlight = false;

    constructor(
        readonly index: number,
        private readonly resolvedPath: string
    ) {}

    get alive(): boolean {
        return !this.disposed;
    }

    isReusable(): boolean {
        return !this.disposed;
    }

    warmUp(): void {
        if (this.disposed || this.ready) return;
        this.ready = this.startSession();
        this.ready.catch(() => {
            // 起動失敗は次の依頼時に報告・再試行する
        });
    }

    private send(payload: Record<string, unknown>): void {
        this.child?.stdin?.write(`${JSON.stringify(payload)}\n`);
    }

    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pendingById.set(id, { resolve, reject });
            this.send({ jsonrpc: '2.0', id, method, params });
        });
    }

    // プロセスを起動し、ACP の初期化とセッション作成を行う
    private async startSession(): Promise<string> {
        const child = spawnCli(this.resolvedPath, ['agent', 'stdio']);
        this.stdoutBuffer = '';
        this.stderrTail = '';
        this.useCount = 0;
        child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));
        child.stderr?.on('data', (chunk: string) => {
            this.stderrTail = (this.stderrTail + chunk).slice(-2000);
        });
        child.on('error', error => this.handleExit(child, error));
        child.on('close', code =>
            this.handleExit(
                child,
                new Error(`grok process exited with code ${String(code)}: ${this.stderrTail.slice(-300)}`)
            )
        );
        this.child = child;

        await this.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        });
        const session = (await this.request('session/new', {
            cwd: getWorkerCwd(),
            mcpServers: [],
        })) as { sessionId?: string };
        if (!session.sessionId) {
            throw new Error('grok did not return a session id');
        }
        return session.sessionId;
    }

    private handleStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        let newlineIndex = this.stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
            if (line) {
                this.handleLine(line);
            }
            newlineIndex = this.stdoutBuffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        let message: {
            id?: number;
            method?: string;
            result?: unknown;
            error?: { message?: string };
            params?: { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } };
        };
        try {
            message = JSON.parse(line) as typeof message;
        } catch {
            return;
        }

        // 自分の要求への応答
        if (message.id !== undefined && this.pendingById.has(message.id) && message.method === undefined) {
            const pending = this.pendingById.get(message.id);
            this.pendingById.delete(message.id);
            if (message.error) {
                pending?.reject(new Error(`grok returned an error: ${message.error.message ?? line.slice(0, 300)}`));
            } else {
                pending?.resolve(message.result);
            }
            return;
        }

        // 応答本文のストリーミング (思考チャンクは含めない)
        if (message.method === 'session/update') {
            const update = message.params?.update;
            if (
                this.promptInFlight &&
                update?.sessionUpdate === 'agent_message_chunk' &&
                update.content?.type === 'text' &&
                typeof update.content.text === 'string'
            ) {
                this.messageChunks += update.content.text;
            }
            return;
        }

        // エージェントからの要求 (ツール実行の許可等) は翻訳では不要のため拒否する
        if (message.method !== undefined && message.id !== undefined) {
            this.send({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32601, message: 'not supported' },
            });
        }
    }

    // プロセス終了時の処理。スロット自体は維持し、次の依頼で起動し直す
    private handleExit(child: ChildProcess, error: Error): void {
        if (this.child !== child) {
            return;
        }
        this.child = null;
        this.ready = null;
        const pendings = [...this.pendingById.values()];
        this.pendingById.clear();
        for (const pending of pendings) {
            pending.reject(error);
        }
    }

    // コンテキスト肥大防止のため、利用回数超過時はプロセスのみ作り直す
    private recycleProcess(): void {
        if (this.child) {
            const child = this.child;
            this.child = null;
            this.ready = null;
            killProcessTree(child);
        }
        this.ready = null;
    }

    async run(prompt: string): Promise<string> {
        if (this.disposed) {
            throw new Error('Worker is already disposed');
        }
        if (this.promptInFlight) {
            throw new Error('Worker is busy');
        }
        if (this.child && this.useCount >= PERSISTENT_WORKER_MAX_USES) {
            this.recycleProcess();
        }

        const execution = (async () => {
            if (!this.ready) {
                this.ready = this.startSession();
            }
            let sessionId: string;
            try {
                sessionId = await this.ready;
            } catch (error) {
                // 起動失敗時は次回の依頼で再試行できるようにする
                this.ready = null;
                throw error;
            }
            this.messageChunks = '';
            this.promptInFlight = true;
            try {
                await this.request('session/prompt', {
                    sessionId,
                    prompt: [{ type: 'text', text: prompt }],
                });
                this.useCount += 1;
                return this.messageChunks;
            } finally {
                this.promptInFlight = false;
            }
        })();

        return withTimeout(execution, () => {
            if (this.child) {
                killProcessTree(this.child);
            }
        });
    }

    dispose(): void {
        this.disposed = true;
        const error = new Error('Worker disposed');
        const pendings = [...this.pendingById.values()];
        this.pendingById.clear();
        for (const pending of pendings) {
            pending.reject(error);
        }
        if (this.child) {
            const child = this.child;
            this.child = null;
            killProcessTree(child);
        }
        this.ready = null;
    }
}

export function createTranslationWorker(agentId: AgentCliId, resolvedPath: string, index: number): TranslationWorker {
    switch (agentId) {
        case 'claude-code':
            return new PersistentClaudeWorker(index, resolvedPath);
        case 'grok':
            return new GrokAcpWorker(index, resolvedPath);
        default:
            return new WarmStdinWorker(index, agentId, resolvedPath);
    }
}
