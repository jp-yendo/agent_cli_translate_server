import type { AgentCliId } from '../../shared/agent-catalog';
import type { LogLevel } from '../../shared/types';
import { createTranslationWorker, type TranslationWorker } from './agent-worker';

// エージェントプール
//
// - 設定された同時起動数までワーカーを起動し、翻訳依頼を割り振る
// - 同時起動数を超えた依頼は待ち状態にする (タイムアウトなし、待ち数の制限なし)
// - 空いたワーカーは再利用し、設定された稼働時間を超えたワーカーは終了させる
// - 初回応答速度を維持するため、Listen 前に1体の起動完了を待ち、
//   最大稼働時間の経過でワーカーが0体になった場合も1体を起動し直して待機させる

export type PoolStats = {
    activeWorkers: number;
    busyWorkers: number;
    queueLength: number;
};

export type PoolOptions = {
    agentId: AgentCliId;
    resolvedPath: string;
    maxConcurrency: number;
    maxUses: number;
    modelName: string | null;
    maxLifetimeMs: number;
    log: (level: LogLevel, key: string, params?: Record<string, string | number>) => void;
    onStatsChanged: (stats: PoolStats) => void;
};

type Waiter = {
    resolve(worker: TranslationWorker): void;
    reject(error: Error): void;
};

const SWEEP_INTERVAL_MS = 15_000;

export class AgentPool {
    private readonly workers = new Set<TranslationWorker>();
    private readonly idle: TranslationWorker[] = [];
    private readonly queue: Waiter[] = [];
    private nextIndex = 1;
    private shuttingDown = false;
    private started = false;
    private readonly sweepTimer: NodeJS.Timeout;

    constructor(private readonly opts: PoolOptions) {
        this.sweepTimer = setInterval(() => this.sweepExpiredWorkers(), SWEEP_INTERVAL_MS);
    }

    async start(): Promise<void> {
        if (this.started) return;
        const worker = await this.spawnReadyWorker();
        if (this.shuttingDown) {
            this.destroyWorker(worker, 'workerDisposed');
            throw new Error('Pool is shutting down');
        }
        this.idle.push(worker);
        this.started = true;
        this.emitStats();
    }

    // ワーカーが1体もいない場合に、起動完了した1体を待機させる
    private async ensureMinimumWorker(): Promise<void> {
        if (this.shuttingDown || this.workers.size > 0) return;
        try {
            const worker = await this.spawnReadyWorker();
            if (this.shuttingDown) {
                this.destroyWorker(worker, 'workerDisposed');
                return;
            }
            this.idle.push(worker);
            this.emitStats();
        } catch {
            // 次の依頼または監視周期で再試行する
        }
    }

    getStats(): PoolStats {
        return {
            activeWorkers: this.workers.size,
            busyWorkers: this.workers.size - this.idle.length,
            queueLength: this.queue.length,
        };
    }

    private emitStats(): void {
        this.opts.onStatsChanged(this.getStats());
    }

    async run(prompt: string): Promise<string> {
        const worker = await this.acquire();
        try {
            const response = await worker.run(prompt);
            return response;
        } finally {
            this.release(worker);
        }
    }

    private async acquire(): Promise<TranslationWorker> {
        if (this.shuttingDown) {
            throw new Error('Pool is shutting down');
        }
        // 待機中に死んだワーカー (常駐プロセスの異常終了等) は破棄して次を探す
        let idleWorker = this.idle.pop();
        while (
            idleWorker &&
            (!idleWorker.alive ||
                !idleWorker.isReusable() ||
                Date.now() - idleWorker.processStartedAt >= this.opts.maxLifetimeMs)
        ) {
            this.destroyWorker(
                idleWorker,
                Date.now() - idleWorker.processStartedAt >= this.opts.maxLifetimeMs ? 'workerExpired' : 'workerDisposed'
            );
            idleWorker = this.idle.pop();
        }
        if (idleWorker) {
            this.emitStats();
            return idleWorker;
        }
        if (this.workers.size < this.opts.maxConcurrency) {
            try {
                const worker = await this.spawnReadyWorker();
                this.emitStats();
                return worker;
            } catch (error) {
                void this.ensureMinimumWorker();
                throw error;
            }
        }
        // 全ワーカーが処理中のため待ち状態にする
        return await new Promise<TranslationWorker>((resolve, reject) => {
            this.queue.push({ resolve, reject });
            this.opts.log('info', 'queueWaiting', { count: this.queue.length });
            this.emitStats();
        });
    }

    private createWorker(): TranslationWorker {
        const worker = createTranslationWorker(
            this.opts.agentId,
            this.opts.resolvedPath,
            this.nextIndex,
            this.opts.maxUses,
            this.opts.modelName
        );
        this.nextIndex += 1;
        this.workers.add(worker);
        this.opts.log('info', 'workerSpawned', { index: worker.index });
        return worker;
    }

    private async spawnReadyWorker(): Promise<TranslationWorker> {
        const worker = this.createWorker();
        try {
            await worker.warmUp();
            return worker;
        } catch (error) {
            this.destroyWorker(worker, 'workerDisposed');
            throw error;
        }
    }

    private destroyWorker(worker: TranslationWorker, reasonKey: 'workerDisposed' | 'workerExpired'): void {
        this.workers.delete(worker);
        const idleIndex = this.idle.indexOf(worker);
        if (idleIndex >= 0) {
            this.idle.splice(idleIndex, 1);
        }
        worker.dispose();
        this.opts.log('info', reasonKey, { index: worker.index });
    }

    private release(worker: TranslationWorker): void {
        if (this.shuttingDown) {
            return;
        }
        const expired = Date.now() - worker.processStartedAt >= this.opts.maxLifetimeMs;
        if (!worker.alive || !worker.isReusable() || expired) {
            this.destroyWorker(worker, expired ? 'workerExpired' : 'workerDisposed');
            // 待ちがある場合は代わりのワーカーを起動して割り当てる
            const waiter = this.queue.shift();
            if (waiter) {
                if (this.workers.size < this.opts.maxConcurrency) {
                    void this.spawnReadyWorker().then(waiter.resolve, error => {
                        waiter.reject(error instanceof Error ? error : new Error(String(error)));
                        void this.ensureMinimumWorker();
                    });
                } else {
                    // 他のワーカーの解放を待つため待ち行列へ戻す
                    this.queue.unshift(waiter);
                }
            }
            void this.ensureMinimumWorker();
            this.emitStats();
            return;
        }

        const waiter = this.queue.shift();
        if (waiter) {
            // 空いたワーカーを待ち中の依頼へ再利用する
            waiter.resolve(worker);
        } else {
            this.idle.push(worker);
        }
        void this.ensureMinimumWorker();
        this.emitStats();
    }

    private sweepExpiredWorkers(): void {
        if (this.shuttingDown) return;
        const now = Date.now();
        const expired = this.idle.filter(worker => now - worker.processStartedAt >= this.opts.maxLifetimeMs);
        for (const worker of expired) {
            this.destroyWorker(worker, 'workerExpired');
        }
        if (expired.length > 0 || this.workers.size === 0) {
            void this.ensureMinimumWorker();
            this.emitStats();
        }
    }

    shutdown(): void {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        clearInterval(this.sweepTimer);
        while (this.queue.length > 0) {
            const waiter = this.queue.shift();
            waiter?.reject(new Error('Translation server stopped'));
        }
        for (const worker of [...this.workers]) {
            this.workers.delete(worker);
            worker.dispose();
        }
        this.idle.length = 0;
    }
}
