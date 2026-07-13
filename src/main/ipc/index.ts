import { registerUpdaterIpcHandlers } from './updater';
import { registerTranslateServerIpcHandlers } from './translate-server';

/**
 * IPCハンドラを登録
 * アプリケーション固有のIPC通信はここに追加
 */
export function registerIpcHandlers() {
    // 自動アップデート関連の IPC ハンドラ
    registerUpdaterIpcHandlers();

    // 翻訳サーバー関連の IPC ハンドラ
    registerTranslateServerIpcHandlers();
}
