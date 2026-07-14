import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getAgentCliDefinition } from '../../shared/agent-catalog';
import { getApiProviderDefinition, isApiProviderId, type ApiProviderId } from '../../shared/api-provider-catalog';
import { getEngineDisplayName } from '../../shared/engine-catalog';
import type { EngineId, ServerStatus } from '../../shared/types';
import { AgentPool } from './agent-pool';
import { detectAgents } from './agent-detector';
import { createApiWorker } from './api-worker';
import { createTranslationWorker, type TranslationWorker } from './agent-worker';
import { addLog } from './log-service';
import { loadSettings } from './settings-store';
import { TranslationServer } from './translation-server';

// 翻訳サーバー全体のライフサイクル管理
// Listen できるのはアプリ全体で1つの翻訳エンジン (Agent CLI / API プロバイダー) のみ

type RunningState = {
    engineId: EngineId;
    host: string;
    port: number;
    pool: AgentPool;
    server: TranslationServer;
};

// API プロバイダーのワーカーはプロセスを持たないため最大稼働時間による再作成を行わない
const API_WORKER_LIFETIME_MS = Number.MAX_SAFE_INTEGER;

let running: RunningState | null = null;
// startServer が検出等の await 中に多重実行されるのを防ぐ
let starting = false;

export function getServerStatus(): ServerStatus {
    if (!running) {
        return { running: false, activeWorkers: 0, busyWorkers: 0, queueLength: 0 };
    }
    const stats = running.pool.getStats();
    return {
        running: true,
        agentId: running.engineId,
        host: running.host,
        port: running.port,
        activeWorkers: stats.activeWorkers,
        busyWorkers: stats.busyWorkers,
        queueLength: stats.queueLength,
    };
}

function broadcastStatus(): void {
    const status = getServerStatus();
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.SERVER_STATUS_CHANGED, status);
        }
    }
}

export async function startServer(engineId: EngineId): Promise<ServerStatus> {
    if (running || starting) {
        throw new Error('Translation server is already running');
    }
    starting = true;
    try {
        return await startServerInternal(engineId);
    } finally {
        starting = false;
    }
}

// エンジン種別に応じてプールのワーカー生成方法・同時起動数・最大稼働時間を決定する
async function buildPoolOptions(engineId: EngineId): Promise<{
    createWorker: (index: number) => TranslationWorker;
    maxConcurrency: number;
    maxLifetimeMs: number;
}> {
    const settings = loadSettings();

    if (isApiProviderId(engineId)) {
        const config = settings.apiProviders[engineId];
        if (!config.model.trim()) {
            throw new Error(`A model name is required for ${getApiProviderDefinition(engineId).displayName}`);
        }
        return {
            createWorker: (index: number) => createApiWorker(engineId as ApiProviderId, config, index),
            maxConcurrency: config.maxConcurrency,
            maxLifetimeMs: API_WORKER_LIFETIME_MS,
        };
    }

    const definition = getAgentCliDefinition(engineId);
    const availabilities = await detectAgents();
    const availability = availabilities.find(a => a.id === engineId);
    if (!availability?.available || !availability.resolvedPath) {
        throw new Error(`Agent CLI command not found: ${definition.command}`);
    }
    const agentConfig = settings.agents[engineId];
    if (engineId === 'opencode-ollama' && !agentConfig.modelName?.trim()) {
        throw new Error('An Ollama model name is required for OpenCode (Ollama)');
    }
    const resolvedPath = availability.resolvedPath;
    return {
        createWorker: (index: number) =>
            createTranslationWorker(engineId, resolvedPath, index, agentConfig.maxUses, agentConfig.modelName),
        maxConcurrency: agentConfig.maxConcurrency,
        maxLifetimeMs: settings.common.agentRetentionSec * 1000,
    };
}

async function startServerInternal(engineId: EngineId): Promise<ServerStatus> {
    const settings = loadSettings();
    const poolOptions = await buildPoolOptions(engineId);
    const hint = settings.common.hintId ? settings.hints.find(h => h.id === settings.common.hintId) : undefined;

    const pool = new AgentPool({
        createWorker: poolOptions.createWorker,
        maxConcurrency: poolOptions.maxConcurrency,
        maxLifetimeMs: poolOptions.maxLifetimeMs,
        log: addLog,
        onStatsChanged: () => broadcastStatus(),
    });

    const server = new TranslationServer({
        host: settings.common.host,
        port: settings.common.port,
        fallbackFrom: settings.common.fallbackFrom,
        fallbackTo: settings.common.fallbackTo,
        hintSummary: hint?.summary || undefined,
        pool,
        log: addLog,
    });

    try {
        await pool.start();
        await server.start();
    } catch (error) {
        pool.shutdown();
        const message = error instanceof Error ? error.message : String(error);
        addLog('error', 'serverStartFailed', { error: message });
        throw new Error(message);
    }

    running = {
        engineId,
        host: settings.common.host,
        port: settings.common.port,
        pool,
        server,
    };

    addLog('info', 'serverStarted', {
        agent: getEngineDisplayName(engineId),
        host: settings.common.host,
        port: settings.common.port,
    });
    if (hint) {
        addLog('info', 'hintApplied', { name: hint.name });
    }
    broadcastStatus();
    return getServerStatus();
}

export async function stopServer(): Promise<ServerStatus> {
    if (!running) {
        return getServerStatus();
    }
    const state = running;
    running = null;
    // 子プロセス (エージェント) の終了は同期処理のため先に実行し、
    // アプリ終了時のレースでプロセスが残らないようにする
    state.pool.shutdown();
    await state.server.stop();
    addLog('info', 'serverStopped', { agent: getEngineDisplayName(state.engineId) });
    broadcastStatus();
    return getServerStatus();
}

export function isServerRunning(): boolean {
    return running !== null;
}

export async function shutdownOnAppQuit(): Promise<void> {
    if (running) {
        await stopServer();
    }
}

// アップデート適用時など、終了を遅延できない場合の同期シャットダウン
// エージェントの子プロセス終了 (同期) のみ確実に行い、HTTP サーバーの close は
// プロセス終了に委ねる
export function emergencyShutdownSync(): void {
    if (!running) return;
    const state = running;
    running = null;
    state.pool.shutdown();
    void state.server.stop();
}
