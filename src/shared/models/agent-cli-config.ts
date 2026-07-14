import type { AgentCliId } from '../agent-catalog';

// Agent CLI ごとの設定 (agents テーブル相当)
export type AgentCliConfig = {
    // 同時起動できるエージェント数
    maxConcurrency: number;
    // 1プロセスを再作成するまでの最大利用回数
    maxUses: number;
    // Agent CLI へ明示的に渡すモデル名。不要な Agent では null
    modelName: string | null;
};

// Agent CLI ごとの同時起動数のデフォルト値
export const DEFAULT_MAX_CONCURRENCY: Record<AgentCliId, number> = {
    'claude-code': 5,
    codex: 5,
    grok: 5,
    opencode: 1,
    'opencode-ollama': 1,
};

export const DEFAULT_MAX_USES = 50;

export function createDefaultAgentCliConfig(id: AgentCliId): AgentCliConfig {
    return {
        maxConcurrency: DEFAULT_MAX_CONCURRENCY[id],
        maxUses: DEFAULT_MAX_USES,
        modelName: null,
    };
}
