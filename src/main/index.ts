import path from 'path';
import { app, BrowserWindow, nativeTheme, ipcMain } from 'electron';
import { setupConsoleBridge, setMainWindow } from './utils/console-bridge';
import { registerIpcHandlers } from './ipc/index';
import { initializeUpdater, scheduleStartupCheck, isInstallingUpdate } from './services/updater';
import { emergencyShutdownSync, isServerRunning, shutdownOnAppQuit } from './services/server-manager';
import { loadSettings, saveUiSettings } from './services/settings-store';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
        },
        show: false,
    });

    // コンソールブリッジ用にメインウィンドウを設定
    setMainWindow(mainWindow);

    if (isDev) {
        mainWindow.loadURL('http://localhost:3001');
        // 開発時はDevToolsを自動で開く
        try {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        } catch {
            // DevToolsのオープンに失敗した場合は無視
        }
        // メニューなしでDevToolsを切り替えるためのキーボードショートカット
        mainWindow.webContents.on('before-input-event', (event, input) => {
            const isToggleCombo =
                (input.key?.toLowerCase?.() === 'i' && (input.control || input.meta) && input.shift) ||
                input.key === 'F12';
            if (isToggleCombo) {
                event.preventDefault();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.toggleDevTools();
                }
            }
        });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => {
        setMainWindow(null);
        mainWindow = null;
    });

    // ウィンドウの読み込み完了 + 数秒後にバックグラウンドでアップデートを 1 回チェック
    // (起動が遅くてもウィンドウが表示されてから走るよう did-finish-load にフックする)
    scheduleStartupCheck(mainWindow);
}

app.whenReady().then(async () => {
    // コンソールブリッジをセットアップしてメインプロセスのログをDevToolsに送信
    setupConsoleBridge();

    // electron-updater のイベントを登録 (本番ビルド時のみ動作)
    initializeUpdater();

    // アプリケーション固有のIPCハンドラを登録
    registerIpcHandlers();

    // 初回起動時は OS の設定からテーマと言語を判定し、設定ファイルへ確定保存する
    {
        const ui = { ...loadSettings().ui };
        let changed = false;
        if (ui.theme === 'system') {
            ui.theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
            changed = true;
        }
        if (ui.language === null) {
            ui.language = app.getLocale().startsWith('ja') ? 'ja' : 'en';
            changed = true;
        }
        if (changed) {
            saveUiSettings(ui);
        }
        // 保存済みのテーマ設定を適用する
        nativeTheme.themeSource = ui.theme;
    }

    // アプリ情報取得とウィンドウ制御のIPC
    ipcMain.handle('app:getInfo', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- ビルド成果物の相対位置からpackage.jsonを実行時に読み込むため
        const pkg = require('../../package.json');
        const ui = loadSettings().ui;
        return {
            name: app.getName() || pkg.name || 'Agent CLI Translate Server',
            version: pkg.version || app.getVersion(),
            // 言語設定が保存されていなければ OS のロケールに従う
            language: ui.language ?? ((app.getLocale().startsWith('ja') ? 'ja' : 'en') as 'ja' | 'en'),
            theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
            os: process.platform as 'win32' | 'darwin' | 'linux',
        };
    });

    ipcMain.handle('app:setTheme', (_e, theme: 'light' | 'dark' | 'system') => {
        nativeTheme.themeSource = theme;
        saveUiSettings({ theme });
        return { theme };
    });

    ipcMain.handle('app:setLanguage', (_e, lang: 'ja' | 'en') => {
        saveUiSettings({ language: lang });
        return { language: lang };
    });

    ipcMain.handle('window:minimize', () => {
        mainWindow?.minimize();
    });
    ipcMain.handle('window:maximizeOrRestore', () => {
        if (!mainWindow) return false;
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
            return false;
        }
        mainWindow.maximize();
        return true;
    });
    ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
    ipcMain.handle('window:close', () => {
        mainWindow?.close();
    });
    createWindow();
});

// 翻訳サーバー・エージェントの停止が完了してからアプリを終了する
let quitCleanupDone = false;
app.on('before-quit', event => {
    if (quitCleanupDone) return;
    quitCleanupDone = true;
    if (!isServerRunning()) return;
    if (isInstallingUpdate()) {
        // アップデート適用時の quitAndInstall による終了は妨げてはならないため、
        // 終了は保留せずエージェントプロセスのみ同期で即時終了する
        emergencyShutdownSync();
        return;
    }
    // 一旦終了を保留し、サーバーと全エージェントの停止完了後に改めて終了する
    event.preventDefault();
    void shutdownOnAppQuit()
        .catch(error => {
            console.error('Failed to shut down translation server on quit:', error);
        })
        .finally(() => {
            app.quit();
        });
});

app.on('window-all-closed', () => {
    // 更新インストール中は終了・再起動を更新器に委ねるため、ここでの app.quit() を抑止する。
    // (先に app.quit() を走らせると macOS で更新器のステージング/再起動と競合し更新に失敗し得る)
    if (isInstallingUpdate()) return;
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
