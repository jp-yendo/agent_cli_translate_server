import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getAgentCliDefinition, type AgentCliId } from '../../shared/agent-catalog';
import type { ServerStatus } from '../../shared/types';
import { AgentPool } from './agent-pool';
import { detectAgents } from './agent-detector';
import { addLog } from './log-service';
import { loadSettings } from './settings-store';
import { TranslationServer } from './translation-server';

// 翻訳サーバー全体のライフサイクル管理
// Listen できるのはアプリ全体で1つの Agent CLI のみ

type RunningState = {
    agentId: AgentCliId;
    host: string;
    port: number;
    pool: AgentPool;
    server: TranslationServer;
};

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
        agentId: running.agentId,
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

export async function startServer(agentId: AgentCliId): Promise<ServerStatus> {
    if (running || starting) {
        throw new Error('Translation server is already running');
    }
    starting = true;
    try {
        return await startServerInternal(agentId);
    } finally {
        starting = false;
    }
}

async function startServerInternal(agentId: AgentCliId): Promise<ServerStatus> {
    const definition = getAgentCliDefinition(agentId);
    const availabilities = await detectAgents();
    const availability = availabilities.find(a => a.id === agentId);
    if (!availability?.available || !availability.resolvedPath) {
        throw new Error(`Agent CLI command not found: ${definition.command}`);
    }

    const settings = loadSettings();
    const agentConfig = settings.agents[agentId];
    if (agentId === 'opencode-ollama' && !agentConfig.modelName?.trim()) {
        throw new Error('An Ollama model name is required for OpenCode (Ollama)');
    }
    const hint = agentConfig.hintId ? settings.hints.find(h => h.id === agentConfig.hintId) : undefined;

    const pool = new AgentPool({
        agentId,
        resolvedPath: availability.resolvedPath,
        maxConcurrency: agentConfig.maxConcurrency,
        maxUses: agentConfig.maxUses,
        modelName: agentConfig.modelName,
        maxLifetimeMs: settings.common.agentRetentionSec * 1000,
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
        agentId,
        host: settings.common.host,
        port: settings.common.port,
        pool,
        server,
    };

    addLog('info', 'serverStarted', {
        agent: definition.displayName,
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
    addLog('info', 'serverStopped', { agent: getAgentCliDefinition(state.agentId).displayName });
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
