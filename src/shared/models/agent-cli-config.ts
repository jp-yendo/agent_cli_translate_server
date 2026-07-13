import type { AgentCliId } from '../agent-catalog';

// Agent CLI ごとの設定 (agents テーブル相当)
export type AgentCliConfig = {
    // 同時起動できるエージェント数
    maxConcurrency: number;
    // 利用する翻訳ヒントのID (未使用時は null)
    hintId: string | null;
};

// Agent CLI ごとの同時起動数のデフォルト値
export const DEFAULT_MAX_CONCURRENCY: Record<AgentCliId, number> = {
    'claude-code': 5,
    codex: 5,
    grok: 5,
    opencode: 1,
};

export function createDefaultAgentCliConfig(id: AgentCliId): AgentCliConfig {
    return {
        maxConcurrency: DEFAULT_MAX_CONCURRENCY[id],
        hintId: null,
    };
}
