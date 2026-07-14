import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { AgentCliId } from '../../shared/agent-catalog';
import type { ApiProviderId } from '../../shared/api-provider-catalog';
import type { EngineId } from '../../shared/types';
import type { AgentCliConfig } from '../../shared/models/agent-cli-config';
import type { ApiProviderConfig } from '../../shared/models/api-provider-config';
import type { CommonSettings } from '../../shared/models/common-settings';
import type { TranslationHint } from '../../shared/models/translation-hint';
import { detectAgents } from '../services/agent-detector';
import { listApiModels, testApiConnection } from '../services/api-model-service';
import { getRecentLogs } from '../services/log-service';
import { getServerStatus, startServer, stopServer } from '../services/server-manager';
import {
    createHint,
    deleteHint,
    loadSettings,
    saveAgentConfig,
    saveApiProviderConfig,
    saveCommonSettings,
    updateHint,
} from '../services/settings-store';

// 翻訳サーバー関連の IPC ハンドラ
export function registerTranslateServerIpcHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => loadSettings());
    ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE_COMMON, (_e, common: CommonSettings) => saveCommonSettings(common));
    ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE_AGENT, (_e, agentId: AgentCliId, config: AgentCliConfig) =>
        saveAgentConfig(agentId, config)
    );
    ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE_API_PROVIDER, (_e, providerId: ApiProviderId, config: ApiProviderConfig) =>
        saveApiProviderConfig(providerId, config)
    );

    ipcMain.handle(IPC_CHANNELS.HINTS_CREATE, (_e, input: { name: string; summary: string }) => createHint(input));
    ipcMain.handle(IPC_CHANNELS.HINTS_UPDATE, (_e, hint: TranslationHint) => updateHint(hint));
    ipcMain.handle(IPC_CHANNELS.HINTS_DELETE, (_e, hintId: string) => deleteHint(hintId));

    ipcMain.handle(IPC_CHANNELS.AGENTS_DETECT, () => detectAgents());

    ipcMain.handle(IPC_CHANNELS.API_TEST_CONNECTION, (_e, providerId: ApiProviderId, config: ApiProviderConfig) =>
        testApiConnection(providerId, config)
    );
    ipcMain.handle(IPC_CHANNELS.API_LIST_MODELS, (_e, providerId: ApiProviderId, config: ApiProviderConfig) =>
        listApiModels(providerId, config)
    );

    ipcMain.handle(IPC_CHANNELS.SERVER_START, (_e, engineId: EngineId) => startServer(engineId));
    ipcMain.handle(IPC_CHANNELS.SERVER_STOP, () => stopServer());
    ipcMain.handle(IPC_CHANNELS.SERVER_GET_STATUS, () => getServerStatus());

    ipcMain.handle(IPC_CHANNELS.LOG_GET_RECENT, () => getRecentLogs());
}
