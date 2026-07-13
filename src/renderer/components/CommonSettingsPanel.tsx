import React from 'react';
import { Button, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_CODES, getLanguageName } from '@shared/languages';
import type { CommonSettings } from '@shared/models/common-settings';
import type { AppLanguage } from '@shared/types';
import { useAppStore } from '../store';

// Agent CLI 共通の設定画面
// 「表示設定」(テーマ・言語: 保存で即時反映) と
// 「サーバー設定」(アドレス等: 次回サーバー開始時に反映) をセクションで分ける

type UiDraft = {
    theme: 'light' | 'dark';
    language: AppLanguage;
};

export default function CommonSettingsPanel() {
    const { t } = useTranslation();
    const settings = useAppStore(state => state.settings);
    const saveCommonSettings = useAppStore(state => state.saveCommonSettings);
    const themeMode = useAppStore(state => state.themeMode);
    const language = useAppStore(state => state.language);
    const setThemeMode = useAppStore(state => state.setThemeMode);
    const setLanguage = useAppStore(state => state.setLanguage);

    const saved = settings?.common;
    const [draft, setDraft] = React.useState<CommonSettings | null>(null);
    const [uiDraft, setUiDraft] = React.useState<UiDraft>({ theme: themeMode, language });

    React.useEffect(() => {
        if (saved) {
            setDraft({ ...saved });
        }
    }, [saved]);

    // 保存済みのテーマ・言語の変化に追従する
    React.useEffect(() => {
        setUiDraft({ theme: themeMode, language });
    }, [themeMode, language]);

    if (!saved || !draft) return null;

    const isUiDirty = uiDraft.theme !== themeMode || uiDraft.language !== language;
    const isServerDirty =
        draft.host !== saved.host ||
        draft.port !== saved.port ||
        draft.fallbackFrom !== saved.fallbackFrom ||
        draft.fallbackTo !== saved.fallbackTo ||
        draft.agentRetentionSec !== saved.agentRetentionSec;

    const isDirty = isUiDirty || isServerDirty;

    const handleSave = async () => {
        try {
            if (uiDraft.theme !== themeMode) {
                await setThemeMode(uiDraft.theme);
            }
            if (uiDraft.language !== language) {
                await setLanguage(uiDraft.language);
            }
            if (isServerDirty) {
                await saveCommonSettings({
                    ...draft,
                    host: draft.host.trim() || '127.0.0.1',
                    port: Math.min(65535, Math.max(1, Math.floor(draft.port || 4660))),
                    agentRetentionSec: Math.max(1, Math.floor(draft.agentRetentionSec || 300)),
                });
            }
        } catch {
            // エラーはストアの lastError 経由で Snackbar に表示される
        }
    };

    const languageMenuItems = LANGUAGE_CODES.map(code => (
        <MenuItem key={code} value={code}>
            {code} - {getLanguageName(code)}
        </MenuItem>
    ));

    return (
        <Stack spacing={4} sx={{ p: 3, maxWidth: 640 }}>
            {/* 表示設定セクション (保存で即時反映) */}
            <Stack spacing={2}>
                <Typography variant='subtitle1' sx={{ fontWeight: 600 }}>
                    {t('common.sectionDisplay')}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                        label={t('common.theme')}
                        select
                        size='small'
                        value={uiDraft.theme}
                        onChange={event => setUiDraft({ ...uiDraft, theme: event.target.value as 'light' | 'dark' })}
                        sx={{ flexGrow: 1 }}
                    >
                        <MenuItem value='light'>{t('common.themeLight')}</MenuItem>
                        <MenuItem value='dark'>{t('common.themeDark')}</MenuItem>
                    </TextField>
                    <TextField
                        label={t('common.language')}
                        select
                        size='small'
                        value={uiDraft.language}
                        onChange={event => setUiDraft({ ...uiDraft, language: event.target.value as AppLanguage })}
                        sx={{ flexGrow: 1 }}
                    >
                        <MenuItem value='ja'>日本語</MenuItem>
                        <MenuItem value='en'>English</MenuItem>
                    </TextField>
                </Stack>
            </Stack>

            <Divider />

            {/* サーバー設定セクション (次回サーバー開始時に反映) */}
            <Stack spacing={2}>
                <Stack>
                    <Typography variant='subtitle1' sx={{ fontWeight: 600 }}>
                        {t('common.sectionServer')}
                    </Typography>
                    <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                        {t('common.note')}
                    </Typography>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                        label={t('common.host')}
                        size='small'
                        value={draft.host}
                        onChange={event => setDraft({ ...draft, host: event.target.value })}
                        sx={{ flexGrow: 1 }}
                    />
                    <TextField
                        label={t('common.port')}
                        type='number'
                        size='small'
                        value={draft.port}
                        onChange={event => setDraft({ ...draft, port: Number(event.target.value) })}
                        slotProps={{ htmlInput: { min: 1, max: 65535 } }}
                        sx={{ width: 160 }}
                    />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                        label={t('common.fallbackFrom')}
                        select
                        size='small'
                        value={draft.fallbackFrom}
                        onChange={event => setDraft({ ...draft, fallbackFrom: event.target.value })}
                        sx={{ flexGrow: 1 }}
                    >
                        {languageMenuItems}
                    </TextField>
                    <TextField
                        label={t('common.fallbackTo')}
                        select
                        size='small'
                        value={draft.fallbackTo}
                        onChange={event => setDraft({ ...draft, fallbackTo: event.target.value })}
                        sx={{ flexGrow: 1 }}
                    >
                        {languageMenuItems}
                    </TextField>
                </Stack>
                <TextField
                    label={t('common.agentRetentionSec')}
                    type='number'
                    size='small'
                    value={draft.agentRetentionSec}
                    onChange={event => setDraft({ ...draft, agentRetentionSec: Number(event.target.value) })}
                    slotProps={{ htmlInput: { min: 1 } }}
                    sx={{ width: 240 }}
                />
            </Stack>

            {/* 保存 (両セクション共通) */}
            <Stack direction='row' sx={{ justifyContent: 'flex-end' }}>
                <Button variant='contained' disabled={!isDirty} onClick={handleSave}>
                    {t('common.save')}
                </Button>
            </Stack>
        </Stack>
    );
}
