import { getAgentCliDefinition } from './agent-catalog';
import { getApiProviderDefinition, isApiProviderId } from './api-provider-catalog';
import type { EngineId } from './types';

// 翻訳エンジン (Agent CLI / API プロバイダー) の表示名を取得する
export function getEngineDisplayName(engineId: EngineId): string {
    return isApiProviderId(engineId)
        ? getApiProviderDefinition(engineId).displayName
        : getAgentCliDefinition(engineId).displayName;
}
