import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { AgentCliId } from '../../shared/agent-catalog';
import type { AgentCliConfig } from '../../shared/models/agent-cli-config';
import type { CommonSettings } from '../../shared/models/common-settings';
import type { TranslationHint } from '../../shared/models/translation-hint';
import { detectAgents } from '../services/agent-detector';
import { getRecentLogs } from '../services/log-service';
import { getServerStatus, startServer, stopServer } from '../services/server-manager';
import {
    createHint,
    deleteHint,
    loadSettings,
    saveAgentConfig,
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

    ipcMain.handle(IPC_CHANNELS.HINTS_CREATE, (_e, input: { name: string; summary: string }) => createHint(input));
    ipcMain.handle(IPC_CHANNELS.HINTS_UPDATE, (_e, hint: TranslationHint) => updateHint(hint));
    ipcMain.handle(IPC_CHANNELS.HINTS_DELETE, (_e, hintId: string) => deleteHint(hintId));

    ipcMain.handle(IPC_CHANNELS.AGENTS_DETECT, () => detectAgents());

    ipcMain.handle(IPC_CHANNELS.SERVER_START, (_e, agentId: AgentCliId) => startServer(agentId));
    ipcMain.handle(IPC_CHANNELS.SERVER_STOP, () => stopServer());
    ipcMain.handle(IPC_CHANNELS.SERVER_GET_STATUS, () => getServerStatus());

    ipcMain.handle(IPC_CHANNELS.LOG_GET_RECENT, () => getRecentLogs());
}
