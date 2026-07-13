import type { AgentCliId } from '../../shared/agent-catalog';
import type { LogLevel } from '../../shared/types';
import { createTranslationWorker, type TranslationWorker } from './agent-worker';

// エージェントプール
//
// - 設定された同時起動数までワーカーを起動し、翻訳依頼を割り振る
// - 同時起動数を超えた依頼は待ち状態にする (タイムアウトなし、待ち数の制限なし)
// - 空いたワーカーは再利用し、保持期間を超えて未使用のワーカーは終了させる
// - 初回応答速度を維持するため、プール生成時に1体を事前起動し、
//   保持期間の経過でワーカーが0体になった場合も1体を起動し直して待機させる

export type PoolStats = {
    activeWorkers: number;
    busyWorkers: number;
    queueLength: number;
};

export type PoolOptions = {
    agentId: AgentCliId;
    resolvedPath: string;
    maxConcurrency: number;
    retentionMs: number;
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
    private readonly sweepTimer: NodeJS.Timeout;

    constructor(private readonly opts: PoolOptions) {
        this.sweepTimer = setInterval(() => this.sweepIdleWorkers(), SWEEP_INTERVAL_MS);
        this.ensureMinimumWorker();
    }

    // ワーカーが1体もいない場合に1体を起動して待機させる
    private ensureMinimumWorker(): void {
        if (this.shuttingDown || this.workers.size > 0) return;
        this.idle.push(this.spawnWorker());
        this.emitStats();
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

    private acquire(): Promise<TranslationWorker> {
        if (this.shuttingDown) {
            return Promise.reject(new Error('Pool is shutting down'));
        }
        // 待機中に死んだワーカー (常駐プロセスの異常終了等) は破棄して次を探す
        let idleWorker = this.idle.pop();
        while (idleWorker && (!idleWorker.alive || !idleWorker.isReusable())) {
            this.destroyWorker(idleWorker, 'workerDisposed');
            idleWorker = this.idle.pop();
        }
        if (idleWorker) {
            this.emitStats();
            return Promise.resolve(idleWorker);
        }
        if (this.workers.size < this.opts.maxConcurrency) {
            const worker = this.spawnWorker();
            this.emitStats();
            return Promise.resolve(worker);
        }
        // 全ワーカーが処理中のため待ち状態にする
        return new Promise<TranslationWorker>((resolve, reject) => {
            this.queue.push({ resolve, reject });
            this.opts.log('info', 'queueWaiting', { count: this.queue.length });
            this.emitStats();
        });
    }

    private spawnWorker(): TranslationWorker {
        const worker = createTranslationWorker(this.opts.agentId, this.opts.resolvedPath, this.nextIndex);
        this.nextIndex += 1;
        this.workers.add(worker);
        this.opts.log('info', 'workerSpawned', { index: worker.index });
        try {
            worker.warmUp();
        } catch {
            // 事前起動の失敗は依頼実行時に改めて報告される
        }
        return worker;
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
        worker.lastUsedAt = Date.now();

        if (!worker.alive || !worker.isReusable()) {
            this.destroyWorker(worker, 'workerDisposed');
            // 待ちがある場合は代わりのワーカーを起動して割り当てる
            const waiter = this.queue.shift();
            if (waiter) {
                if (this.workers.size < this.opts.maxConcurrency) {
                    waiter.resolve(this.spawnWorker());
                } else {
                    // 他のワーカーの解放を待つため待ち行列へ戻す
                    this.queue.unshift(waiter);
                }
            }
            this.ensureMinimumWorker();
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
        this.ensureMinimumWorker();
        this.emitStats();
    }

    private sweepIdleWorkers(): void {
        if (this.shuttingDown) return;
        const now = Date.now();
        const expired = this.idle.filter(worker => now - worker.lastUsedAt >= this.opts.retentionMs);
        for (const worker of expired) {
            this.destroyWorker(worker, 'workerExpired');
        }
        if (expired.length > 0) {
            this.ensureMinimumWorker();
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
