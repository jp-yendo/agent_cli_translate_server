import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { AGENT_EXECUTION_TIMEOUT_MS, getAppRootDir } from '../../shared/constants';
import type { AgentCliId } from '../../shared/agent-catalog';
import { buildCliLaunchPlan } from '../utils/cli-spawn';

// 翻訳を実行するエージェントワーカー
//
// 起動オーバーヘッドを最小化するため、全ワーカーがプロセスを保持する:
// - claude-code: stream-json モードの常駐プロセスを維持し、複数の翻訳依頼で再利用する
// - grok / opencode / OpenCode (Ollama): ACP (JSON-RPC over stdio) の常駐プロセスを維持する
// - codex: app-server (JSONL over stdio) の常駐プロセスを維持する
//
// ワーカー (スロット) の終了は保持期間の経過・サーバー停止・アプリ終了時のみ

export interface TranslationWorker {
    readonly index: number;
    readonly alive: boolean;
    readonly processStartedAt: number;
    // プロンプトを実行し、CLI の生の応答テキストを返す
    run(prompt: string): Promise<string>;
    isReusable(): boolean;
    // プロセスを事前起動して待機状態にする
    warmUp(): Promise<void>;
    dispose(): void;
}

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

function waitForSpawn(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = (): void => {
            child.off('spawn', handleSpawn);
            child.off('error', handleError);
            child.off('close', handleClose);
        };
        const handleSpawn = (): void => {
            cleanup();
            resolve();
        };
        const handleError = (error: Error): void => {
            cleanup();
            reject(error);
        };
        const handleClose = (code: number | null): void => {
            cleanup();
            reject(new Error(`Agent process exited during startup with code ${String(code)}`));
        };
        child.once('spawn', handleSpawn);
        child.once('error', handleError);
        child.once('close', handleClose);
    });
}

type RpcPending = {
    resolve(value: unknown): void;
    reject(error: Error): void;
};

// Codex app-server の常駐プロセスを維持し、同一スレッドへ複数の翻訳依頼を送る
class PersistentCodexWorker implements TranslationWorker {
    private disposed = false;
    private child: ChildProcess | null = null;
    private stdoutBuffer = '';
    private stderrTail = '';
    private nextRequestId = 1;
    private readonly pendingById = new Map<number, RpcPending>();
    private ready: Promise<string> | null = null;
    private processStartedAtValue = 0;
    private useCount = 0;
    private messageChunks = '';
    private promptInFlight = false;
    private pendingTurn: { threadId: string; resolve(value: string): void; reject(error: Error): void } | null = null;

    constructor(
        readonly index: number,
        private readonly resolvedPath: string,
        private readonly maxUses: number
    ) {}

    get alive(): boolean {
        return !this.disposed;
    }

    get processStartedAt(): number {
        return this.processStartedAtValue;
    }

    isReusable(): boolean {
        return (
            !this.disposed &&
            this.ready !== null &&
            this.child !== null &&
            this.child.exitCode === null &&
            !this.child.killed
        );
    }

    async warmUp(): Promise<void> {
        if (this.disposed) {
            throw new Error('Worker is already disposed');
        }
        const ready = this.ready ?? this.startSession();
        this.ready = ready;
        try {
            await withTimeout(ready, () => {
                this.ready = null;
                if (this.child) killProcessTree(this.child);
            });
        } catch (error) {
            if (this.ready === ready) this.ready = null;
            throw error;
        }
    }

    private send(payload: Record<string, unknown>): void {
        if (!this.child?.stdin?.writable) {
            throw new Error('codex app-server stdin is not writable');
        }
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    }

    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pendingById.set(id, { resolve, reject });
            try {
                this.send({ id, method, params });
            } catch (error) {
                this.pendingById.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private async startSession(): Promise<string> {
        const child = spawnCli(this.resolvedPath, ['app-server', '--stdio']);
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
                new Error(`codex app-server exited with code ${String(code)}: ${this.stderrTail.slice(-300)}`)
            )
        );
        this.child = child;
        this.processStartedAtValue = Date.now();
        await waitForSpawn(child);
        await this.request('initialize', {
            clientInfo: {
                name: 'agent_cli_translate_server',
                title: 'Agent CLI Translate Server',
                version: '0.1.0',
            },
        });
        this.send({ method: 'initialized' });
        const response = (await this.request('thread/start', {
            cwd: getWorkerCwd(),
            approvalPolicy: 'never',
            sandbox: 'read-only',
            ephemeral: true,
            serviceName: 'agent_cli_translate_server',
        })) as { thread?: { id?: string } };
        const threadId = response.thread?.id;
        if (!threadId) {
            throw new Error('codex app-server did not return a thread id');
        }
        return threadId;
    }

    private handleStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        let newlineIndex = this.stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
            if (line) this.handleLine(line);
            newlineIndex = this.stdoutBuffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        let message: {
            id?: number;
            method?: string;
            result?: unknown;
            error?: { message?: string };
            params?: {
                threadId?: string;
                delta?: string;
                turn?: { status?: string; error?: { message?: string } | null };
            };
        };
        try {
            message = JSON.parse(line) as typeof message;
        } catch {
            return;
        }

        if (message.id !== undefined && this.pendingById.has(message.id) && message.method === undefined) {
            const pending = this.pendingById.get(message.id);
            this.pendingById.delete(message.id);
            if (message.error) {
                pending?.reject(
                    new Error(`codex app-server returned an error: ${message.error.message ?? line.slice(0, 300)}`)
                );
            } else {
                pending?.resolve(message.result);
            }
            return;
        }

        if (
            message.method === 'item/agentMessage/delta' &&
            this.promptInFlight &&
            typeof message.params?.delta === 'string'
        ) {
            this.messageChunks += message.params.delta;
            return;
        }

        if (message.method === 'turn/completed' && this.pendingTurn) {
            const pending = this.pendingTurn;
            if (message.params?.threadId !== pending.threadId) return;
            this.pendingTurn = null;
            if (message.params.turn?.status === 'completed') {
                pending.resolve(this.messageChunks);
            } else {
                pending.reject(
                    new Error(
                        message.params.turn?.error?.message ?? 'codex app-server turn did not complete successfully'
                    )
                );
            }
            return;
        }

        if (message.method !== undefined && message.id !== undefined) {
            this.send({ id: message.id, error: { code: -32601, message: 'not supported' } });
        }
    }

    private handleExit(child: ChildProcess, error: Error): void {
        if (this.child !== child) return;
        this.child = null;
        this.ready = null;
        const pendings = [...this.pendingById.values()];
        this.pendingById.clear();
        for (const pending of pendings) pending.reject(error);
        if (this.pendingTurn) {
            const pending = this.pendingTurn;
            this.pendingTurn = null;
            pending.reject(error);
        }
    }

    private async recycleProcess(): Promise<void> {
        if (this.child) {
            const child = this.child;
            this.child = null;
            this.ready = null;
            killProcessTree(child);
        }
        await this.warmUp();
    }

    async run(prompt: string): Promise<string> {
        if (this.disposed) throw new Error('Worker is already disposed');
        if (this.promptInFlight) throw new Error('Worker is busy');

        const execution = (async () => {
            await this.warmUp();
            const threadId = await this.ready;
            if (!threadId) throw new Error('codex app-server is not ready');
            this.messageChunks = '';
            this.promptInFlight = true;
            const completion = new Promise<string>((resolve, reject) => {
                this.pendingTurn = { threadId, resolve, reject };
            });
            try {
                await this.request('turn/start', {
                    threadId,
                    input: [{ type: 'text', text: prompt }],
                });
                const response = await completion;
                this.useCount += 1;
                if (this.useCount >= this.maxUses) {
                    await this.recycleProcess();
                }
                return response;
            } finally {
                this.promptInFlight = false;
                if (this.pendingTurn?.threadId === threadId) this.pendingTurn = null;
            }
        })();

        return withTimeout(execution, () => {
            this.ready = null;
            if (this.child) killProcessTree(this.child);
        });
    }

    dispose(): void {
        this.disposed = true;
        const error = new Error('Worker disposed');
        const pendings = [...this.pendingById.values()];
        this.pendingById.clear();
        for (const pending of pendings) pending.reject(error);
        if (this.pendingTurn) {
            const pending = this.pendingTurn;
            this.pendingTurn = null;
            pending.reject(error);
        }
        if (this.child) killProcessTree(this.child);
        this.child = null;
        this.ready = null;
    }
}

// claude-code 用の常駐ワーカー
// stream-json の入出力で1プロセスに複数の翻訳依頼を処理させる
class PersistentClaudeWorker implements TranslationWorker {
    private disposed = false;
    private child: ChildProcess | null = null;
    private ready: Promise<ChildProcess> | null = null;
    private processStartedAtValue = 0;
    private stdoutBuffer = '';
    private stderrTail = '';
    private useCount = 0;
    private pending: { resolve(value: string): void; reject(error: Error): void } | null = null;

    constructor(
        readonly index: number,
        private readonly resolvedPath: string,
        private readonly maxUses: number
    ) {}

    get alive(): boolean {
        return !this.disposed;
    }

    get processStartedAt(): number {
        return this.processStartedAtValue;
    }

    isReusable(): boolean {
        return (
            !this.disposed &&
            this.ready !== null &&
            this.child !== null &&
            this.child.exitCode === null &&
            !this.child.killed
        );
    }

    async warmUp(): Promise<void> {
        if (this.disposed) throw new Error('Worker is already disposed');
        const ready = this.ready ?? this.startProcess();
        this.ready = ready;
        try {
            await withTimeout(ready, () => {
                this.ready = null;
                if (this.child) killProcessTree(this.child);
            });
        } catch (error) {
            if (this.ready === ready) this.ready = null;
            throw error;
        }
    }

    private startProcess(): Promise<ChildProcess> {
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
        this.processStartedAtValue = Date.now();
        return waitForSpawn(child).then(() => child);
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
            this.ready = null;
        }
        if (this.pending) {
            const pending = this.pending;
            this.pending = null;
            pending.reject(error);
        }
    }

    // コンテキスト肥大防止のため、利用回数超過時はプロセスのみ作り直す
    private async recycleProcess(): Promise<void> {
        if (this.child) {
            const child = this.child;
            this.child = null;
            this.ready = null;
            try {
                child.stdin?.end();
            } catch {
                // 無視: プロセスが既に終了している場合がある
            }
            killProcessTree(child);
        }
        await this.warmUp();
    }

    async run(prompt: string): Promise<string> {
        if (this.disposed) throw new Error('Worker is already disposed');
        if (this.pending) throw new Error('Worker is busy');

        const execution = (async () => {
            await this.warmUp();
            const child = await this.ready;
            if (!child) throw new Error('claude process is not ready');
            const response = await new Promise<string>((resolve, reject) => {
                this.pending = { resolve, reject };
                const message = {
                    type: 'user',
                    message: {
                        role: 'user',
                        content: [{ type: 'text', text: prompt }],
                    },
                };
                child.stdin?.write(`${JSON.stringify(message)}\n`);
                this.useCount += 1;
            });
            if (this.useCount >= this.maxUses) {
                await this.recycleProcess();
            }
            return response;
        })();

        return withTimeout(execution, () => {
            this.ready = null;
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
            this.ready = null;
            try {
                child.stdin?.end();
            } catch {
                // 無視: プロセスが既に終了している場合がある
            }
            killProcessTree(child);
        }
    }
}

// grok / opencode / OpenCode (Ollama) 用の常駐ワーカー
// ACP (Agent Client Protocol) の stdio モードで JSON-RPC により対話する
class AcpWorker implements TranslationWorker {
    private disposed = false;
    private child: ChildProcess | null = null;
    private stdoutBuffer = '';
    private stderrTail = '';
    private nextRequestId = 1;
    private readonly pendingById = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    private ready: Promise<string> | null = null;
    private processStartedAtValue = 0;
    private useCount = 0;
    private messageChunks = '';
    private promptInFlight = false;

    constructor(
        readonly index: number,
        private readonly agentId: 'grok' | 'opencode' | 'opencode-ollama',
        private readonly resolvedPath: string,
        private readonly maxUses: number,
        private readonly modelName: string | null
    ) {}

    get alive(): boolean {
        return !this.disposed;
    }

    get processStartedAt(): number {
        return this.processStartedAtValue;
    }

    isReusable(): boolean {
        return (
            !this.disposed &&
            this.ready !== null &&
            this.child !== null &&
            this.child.exitCode === null &&
            !this.child.killed
        );
    }

    async warmUp(): Promise<void> {
        if (this.disposed) throw new Error('Worker is already disposed');
        const ready = this.ready ?? this.startSession();
        this.ready = ready;
        try {
            await withTimeout(ready, () => {
                this.ready = null;
                if (this.child) killProcessTree(this.child);
            });
        } catch (error) {
            if (this.ready === ready) this.ready = null;
            throw error;
        }
    }

    private send(payload: Record<string, unknown>): void {
        if (!this.child?.stdin?.writable) {
            throw new Error(`${this.agentId} ACP stdin is not writable`);
        }
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    }

    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;
            this.pendingById.set(id, { resolve, reject });
            try {
                this.send({ jsonrpc: '2.0', id, method, params });
            } catch (error) {
                this.pendingById.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    // プロセスを起動し、ACP の初期化とセッション作成を行う
    private async startSession(): Promise<string> {
        let args: string[];
        if (this.agentId === 'grok') {
            args = ['agent', 'stdio'];
        } else if (this.agentId === 'opencode') {
            args = ['acp', '--cwd', getWorkerCwd()];
        } else {
            if (!this.modelName) throw new Error('Ollama model name is required');
            args = ['launch', 'opencode', '--model', this.modelName, '--yes', '--', 'acp', '--cwd', getWorkerCwd()];
        }
        const child = spawnCli(this.resolvedPath, args);
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
                new Error(`${this.agentId} process exited with code ${String(code)}: ${this.stderrTail.slice(-300)}`)
            )
        );
        this.child = child;
        this.processStartedAtValue = Date.now();
        await waitForSpawn(child);

        await this.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        });
        const session = (await this.request('session/new', {
            cwd: getWorkerCwd(),
            mcpServers: [],
        })) as { sessionId?: string };
        if (!session.sessionId) {
            throw new Error(`${this.agentId} did not return a session id`);
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
                pending?.reject(
                    new Error(`${this.agentId} returned an error: ${message.error.message ?? line.slice(0, 300)}`)
                );
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
    private async recycleProcess(): Promise<void> {
        if (this.child) {
            const child = this.child;
            this.child = null;
            this.ready = null;
            killProcessTree(child);
        }
        this.ready = null;
        await this.warmUp();
    }

    async run(prompt: string): Promise<string> {
        if (this.disposed) {
            throw new Error('Worker is already disposed');
        }
        if (this.promptInFlight) {
            throw new Error('Worker is busy');
        }
        const execution = (async () => {
            await this.warmUp();
            const sessionId = await this.ready;
            if (!sessionId) throw new Error(`${this.agentId} ACP session is not ready`);
            this.messageChunks = '';
            this.promptInFlight = true;
            try {
                await this.request('session/prompt', {
                    sessionId,
                    prompt: [{ type: 'text', text: prompt }],
                });
                this.useCount += 1;
                const response = this.messageChunks;
                if (this.useCount >= this.maxUses) {
                    await this.recycleProcess();
                }
                return response;
            } finally {
                this.promptInFlight = false;
            }
        })();

        return withTimeout(execution, () => {
            this.ready = null;
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

export function createTranslationWorker(
    agentId: AgentCliId,
    resolvedPath: string,
    index: number,
    maxUses: number,
    modelName: string | null
): TranslationWorker {
    switch (agentId) {
        case 'claude-code':
            return new PersistentClaudeWorker(index, resolvedPath, maxUses);
        case 'codex':
            return new PersistentCodexWorker(index, resolvedPath, maxUses);
        case 'grok':
        case 'opencode':
        case 'opencode-ollama':
            return new AcpWorker(index, agentId, resolvedPath, maxUses, modelName);
        default:
            throw new Error(`Unsupported agent: ${agentId}`);
    }
}
