import { BrowserWindow } from 'electron';
import { IPC_CHANNELS, LOG_MAX_ENTRIES } from '../../shared/constants';
import type { LogEntry, LogLevel } from '../../shared/types';

// 動作状況ログ (画面表示のみ、ファイルには出力しない)
// 直近 LOG_MAX_ENTRIES 件でローテーションする

const entries: LogEntry[] = [];
let nextId = 1;

export function addLog(level: LogLevel, key: string, params?: Record<string, string | number>): LogEntry {
    const entry: LogEntry = {
        id: nextId++,
        timestamp: Date.now(),
        level,
        key,
        params,
    };
    entries.push(entry);
    while (entries.length > LOG_MAX_ENTRIES) {
        entries.shift();
    }
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.LOG_ADDED, entry);
        }
    }
    return entry;
}

export function getRecentLogs(): LogEntry[] {
    return [...entries];
}
