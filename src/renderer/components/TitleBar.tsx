import React from 'react';
import { Box, Button, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AppInfo } from '@shared/types';
import MinimizeIcon from '@mui/icons-material/Minimize';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import CloseIcon from '@mui/icons-material/Close';
import DnsIcon from '@mui/icons-material/Dns';
import ArticleIcon from '@mui/icons-material/Article';
import SettingsIcon from '@mui/icons-material/Settings';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import MenuIcon from '@mui/icons-material/Menu';

// 画面の種類 (キャプション内ナビゲーションで切り替える)
export type AppView = 'server' | 'logs' | 'common' | 'hints';

// 共通設定はナビゲーションではなく、バーガーメニューの左に歯車アイコンのみで表示する
// テーマ・言語の切り替えは共通設定画面で行う
const NAV_ITEMS: Array<{ view: AppView; labelKey: string; icon: React.ReactElement }> = [
    { view: 'server', labelKey: 'nav.server', icon: <DnsIcon fontSize='small' /> },
    { view: 'logs', labelKey: 'nav.logs', icon: <ArticleIcon fontSize='small' /> },
    { view: 'hints', labelKey: 'nav.hints', icon: <TipsAndUpdatesIcon fontSize='small' /> },
];

type Props = {
    info: AppInfo | undefined;
    view: AppView;
    onViewChange(view: AppView): void;
};

export default function TitleBar({ info, view, onViewChange }: Props) {
    const { t } = useTranslation();
    const isMac = info?.os === 'darwin';
    const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);

    const controlButtonSx = {
        borderRadius: 0,
        width: 44,
        height: 48,
        color: 'text.primary',
        '&:hover': { bgcolor: 'action.hover' },
    } as const;

    return (
        <Box
            sx={{
                WebkitAppRegion: 'drag',
                display: 'flex',
                alignItems: 'center',
                pl: 2,
                height: 48,
                bgcolor: 'background.paper',
                borderBottom: 1,
                borderColor: 'divider',
                userSelect: 'none',
            }}
        >
            <Box sx={{ ml: isMac ? 10 : 0, display: 'flex', alignItems: 'baseline', gap: 1, mr: 2, flexShrink: 0 }}>
                <Typography variant='body1' sx={{ fontWeight: 500, fontSize: '0.95rem' }} noWrap>
                    {t('appTitle')}
                </Typography>
                {info?.version && (
                    <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                        v{info.version}
                    </Typography>
                )}
            </Box>

            <Box sx={{ flexGrow: 1 }} />

            {/* キャプション内ナビゲーション (右寄せ) */}
            <Box
                sx={{
                    WebkitAppRegion: 'no-drag',
                    display: { xs: 'none', md: 'flex' },
                    alignItems: 'center',
                    gap: 0.5,
                    overflow: 'hidden',
                    mr: 1,
                }}
            >
                {NAV_ITEMS.map(item => (
                    <Button
                        key={item.view}
                        size='small'
                        color={view === item.view ? 'primary' : 'inherit'}
                        startIcon={item.icon}
                        onClick={() => onViewChange(item.view)}
                        sx={{
                            px: 1.5,
                            fontWeight: view === item.view ? 600 : 400,
                            bgcolor: view === item.view ? 'action.selected' : 'transparent',
                        }}
                    >
                        {t(item.labelKey)}
                    </Button>
                ))}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' }}>
                {/* 共通設定 (アイコンのみ) */}
                <IconButton
                    size='medium'
                    aria-label={t('nav.commonSettings')}
                    onClick={() => onViewChange('common')}
                    sx={{
                        ...controlButtonSx,
                        color: view === 'common' ? 'primary.main' : 'text.primary',
                    }}
                >
                    <SettingsIcon fontSize='small' />
                </IconButton>

                {/* バーガーメニュー (画面切り替え) */}
                <IconButton
                    size='medium'
                    aria-label={t('titleBar.menu')}
                    onClick={event => setMenuAnchor(event.currentTarget)}
                    sx={controlButtonSx}
                >
                    <MenuIcon fontSize='small' />
                </IconButton>
                <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
                    {NAV_ITEMS.map(item => (
                        <MenuItem
                            key={item.view}
                            selected={view === item.view}
                            onClick={() => {
                                setMenuAnchor(null);
                                onViewChange(item.view);
                            }}
                        >
                            <ListItemIcon>{item.icon}</ListItemIcon>
                            <ListItemText>{t(item.labelKey)}</ListItemText>
                        </MenuItem>
                    ))}
                </Menu>

                {/* Window controls - macOSでは非表示 */}
                {!isMac && (
                    <>
                        <IconButton
                            size='medium'
                            onClick={() => window.agentCliTranslateServer.minimize()}
                            sx={{ ...controlButtonSx, width: 48 }}
                        >
                            <MinimizeIcon />
                        </IconButton>
                        <IconButton
                            size='medium'
                            onClick={async () => {
                                await window.agentCliTranslateServer.maximizeOrRestore();
                            }}
                            sx={{ ...controlButtonSx, width: 48 }}
                        >
                            <CropSquareIcon />
                        </IconButton>
                        <IconButton
                            size='medium'
                            onClick={() => window.agentCliTranslateServer.close()}
                            sx={{
                                ...controlButtonSx,
                                width: 48,
                                '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' },
                            }}
                        >
                            <CloseIcon />
                        </IconButton>
                    </>
                )}
            </Box>
        </Box>
    );
}
