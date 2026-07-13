// 対応する Agent CLI のカタログ定義 (静的メタデータ)

export type AgentCliId = 'claude-code' | 'codex' | 'grok' | 'opencode';

export type AgentCliDefinition = {
    id: AgentCliId;
    // 画面表示名
    displayName: string;
    // 実行コマンド名
    command: string;
    // 提供パッケージ等の補足
    packageName: string;
};

export const AGENT_CLI_DEFINITIONS: AgentCliDefinition[] = [
    {
        id: 'claude-code',
        displayName: 'Claude Code',
        command: 'claude',
        packageName: '@anthropic-ai/claude-code',
    },
    {
        id: 'codex',
        displayName: 'Codex CLI',
        command: 'codex',
        packageName: '@openai/codex',
    },
    {
        id: 'grok',
        displayName: 'Grok CLI',
        command: 'grok',
        packageName: '@xai-official/grok',
    },
    {
        id: 'opencode',
        displayName: 'opencode',
        command: 'opencode',
        packageName: 'opencode-ai',
    },
];

export const AGENT_CLI_IDS: AgentCliId[] = AGENT_CLI_DEFINITIONS.map(def => def.id);

export function getAgentCliDefinition(id: AgentCliId): AgentCliDefinition {
    const def = AGENT_CLI_DEFINITIONS.find(d => d.id === id);
    if (!def) {
        throw new Error(`Unknown agent CLI id: ${id}`);
    }
    return def;
}
