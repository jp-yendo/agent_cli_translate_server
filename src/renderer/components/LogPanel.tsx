import React from 'react';
import { Box, Checkbox, Chip, FormControlLabel, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { LogLevel } from '@shared/types';
import { useAppStore } from '../store';

// 動作状況ログ画面
// 直近200件でローテーションし、自動スクロールが有効なら常に最新のログへスクロールする

const LEVEL_COLORS: Record<LogLevel, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
    info: 'default',
    request: 'info',
    success: 'success',
    warn: 'warning',
    error: 'error',
};

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

export default function LogPanel() {
    const { t } = useTranslation();
    const logs = useAppStore(state => state.logs);
    const autoScroll = useAppStore(state => state.autoScroll);
    const setAutoScroll = useAppStore(state => state.setAutoScroll);
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    return (
        <Stack spacing={1} sx={{ p: 2, height: '100%', minHeight: 0 }}>
            <FormControlLabel
                control={
                    <Checkbox
                        checked={autoScroll}
                        onChange={event => setAutoScroll(event.target.checked)}
                        size='small'
                    />
                }
                label={t('logs.autoScroll')}
            />
            <Box
                ref={containerRef}
                sx={{
                    flexGrow: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    bgcolor: 'background.paper',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1,
                    fontFamily: 'Consolas, Menlo, monospace',
                }}
            >
                {logs.length === 0 && (
                    <Typography variant='body2' sx={{ color: 'text.secondary', p: 1 }}>
                        {t('logs.empty')}
                    </Typography>
                )}
                {logs.map(entry => (
                    <Stack
                        key={entry.id}
                        direction='row'
                        spacing={1}
                        sx={{ alignItems: 'flex-start', py: 0.25, px: 0.5 }}
                    >
                        <Typography variant='caption' sx={{ color: 'text.secondary', pt: '3px', flexShrink: 0 }}>
                            {formatTime(entry.timestamp)}
                        </Typography>
                        <Chip
                            size='small'
                            label={entry.level}
                            color={LEVEL_COLORS[entry.level]}
                            variant='outlined'
                            sx={{ height: 20, fontSize: '0.65rem', flexShrink: 0, minWidth: 64 }}
                        />
                        <Typography variant='body2' sx={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                            {t(`log.${entry.key}`, { ...entry.params, defaultValue: entry.key })}
                        </Typography>
                    </Stack>
                ))}
            </Box>
        </Stack>
    );
}
