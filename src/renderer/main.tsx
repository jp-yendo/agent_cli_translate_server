import React from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Box, CssBaseline, Snackbar } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import './i18n/config';
import TitleBar, { type AppView } from './components/TitleBar';
import UpdateNotifier from './components/UpdateNotifier';
import ServerPanel from './components/ServerPanel';
import LogPanel from './components/LogPanel';
import CommonSettingsPanel from './components/CommonSettingsPanel';
import HintsPanel from './components/HintsPanel';
import { useAppStore } from './store';
import type { AppInfo } from '@shared/types';

function App() {
    const [info, setInfo] = React.useState<AppInfo | undefined>(undefined);
    const [view, setView] = React.useState<AppView>('server');
    const initialize = useAppStore(state => state.initialize);
    const applyAppInfo = useAppStore(state => state.applyAppInfo);
    const themeMode = useAppStore(state => state.themeMode);
    const lastError = useAppStore(state => state.lastError);
    const clearError = useAppStore(state => state.clearError);

    // アプリ情報を初期化
    React.useEffect(() => {
        window.agentCliTranslateServer.getAppInfo().then(appInfo => {
            setInfo(appInfo);
            applyAppInfo(appInfo);
        });
        void initialize();
    }, [applyAppInfo, initialize]);

    const muiTheme = React.useMemo(() => createTheme({ palette: { mode: themeMode } }), [themeMode]);

    return (
        <ThemeProvider theme={muiTheme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                <TitleBar info={info} view={view} onViewChange={setView} />
                <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', bgcolor: 'background.default' }}>
                    {view === 'server' && <ServerPanel />}
                    {view === 'logs' && <LogPanel />}
                    {view === 'common' && <CommonSettingsPanel />}
                    {view === 'hints' && <HintsPanel />}
                </Box>
            </Box>
            <Snackbar
                open={lastError !== null}
                autoHideDuration={8000}
                onClose={clearError}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity='error' onClose={clearError} sx={{ maxWidth: 600 }}>
                    {lastError}
                </Alert>
            </Snackbar>
            <UpdateNotifier />
        </ThemeProvider>
    );
}

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
