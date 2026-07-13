import React from 'react';
import {
    Button,
    Card,
    CardContent,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import type { TranslationHint } from '@shared/models/translation-hint';
import { useAppStore } from '../store';

// 翻訳ヒント管理画面
// アプリ概要 (サマリ) の追加・編集・削除を行う

type EditorState = {
    mode: 'add' | 'edit';
    hint: TranslationHint;
};

export default function HintsPanel() {
    const { t } = useTranslation();
    const settings = useAppStore(state => state.settings);
    const createHint = useAppStore(state => state.createHint);
    const updateHint = useAppStore(state => state.updateHint);
    const deleteHint = useAppStore(state => state.deleteHint);

    const hints = settings?.hints ?? [];
    const [editor, setEditor] = React.useState<EditorState | null>(null);
    const [deleteTarget, setDeleteTarget] = React.useState<TranslationHint | null>(null);

    const handleEditorSave = async () => {
        if (!editor) return;
        try {
            if (editor.mode === 'add') {
                await createHint({ name: editor.hint.name, summary: editor.hint.summary });
            } else {
                await updateHint(editor.hint);
            }
            setEditor(null);
        } catch {
            // エラーはストアの lastError 経由で Snackbar に表示される (ダイアログは開いたまま)
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteHint(deleteTarget.id);
        } catch {
            // エラーはストアの lastError 経由で Snackbar に表示される
        }
        setDeleteTarget(null);
    };

    return (
        <Stack spacing={2} sx={{ p: 2 }}>
            <Stack direction='row' spacing={2} sx={{ alignItems: 'center' }}>
                <Stack sx={{ flexGrow: 1 }}>
                    <Typography variant='subtitle1' sx={{ fontWeight: 500 }}>
                        {t('hints.title')}
                    </Typography>
                    <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                        {t('hints.description')}
                    </Typography>
                </Stack>
                <Button
                    variant='contained'
                    size='small'
                    startIcon={<AddIcon />}
                    onClick={() =>
                        setEditor({ mode: 'add', hint: { id: '', name: '', summary: '' } })
                    }
                >
                    {t('hints.add')}
                </Button>
            </Stack>

            {hints.length === 0 && (
                <Typography variant='body2' sx={{ color: 'text.secondary', p: 2 }}>
                    {t('hints.empty')}
                </Typography>
            )}

            {hints.map(hint => (
                <Card key={hint.id} variant='outlined'>
                    <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, '&:last-child': { pb: 2 } }}>
                        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 500 }}>{hint.name}</Typography>
                            <Typography
                                variant='body2'
                                sx={{
                                    color: 'text.secondary',
                                    whiteSpace: 'pre-wrap',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                }}
                            >
                                {hint.summary}
                            </Typography>
                        </Stack>
                        <Stack direction='row'>
                            <IconButton
                                size='small'
                                aria-label={t('hints.edit')}
                                onClick={() => setEditor({ mode: 'edit', hint: { ...hint } })}
                            >
                                <EditIcon fontSize='small' />
                            </IconButton>
                            <IconButton
                                size='small'
                                aria-label={t('hints.delete')}
                                onClick={() => setDeleteTarget(hint)}
                            >
                                <DeleteIcon fontSize='small' />
                            </IconButton>
                        </Stack>
                    </CardContent>
                </Card>
            ))}

            {/* 追加・編集ダイアログ */}
            {/* 入力内容の誤破棄を防ぐため、ダイアログ外クリックでは閉じない */}
            <Dialog
                open={editor !== null}
                onClose={(_event, reason) => {
                    if (reason === 'backdropClick') return;
                    setEditor(null);
                }}
                fullWidth
                maxWidth='md'
            >
                <DialogTitle>{editor?.mode === 'add' ? t('hints.dialogAddTitle') : t('hints.dialogEditTitle')}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label={t('hints.name')}
                            size='small'
                            value={editor?.hint.name ?? ''}
                            onChange={event =>
                                setEditor(prev =>
                                    prev ? { ...prev, hint: { ...prev.hint, name: event.target.value } } : prev
                                )
                            }
                            autoFocus
                        />
                        <TextField
                            label={t('hints.summary')}
                            placeholder={t('hints.summaryPlaceholder')}
                            multiline
                            minRows={4}
                            value={editor?.hint.summary ?? ''}
                            onChange={event =>
                                setEditor(prev =>
                                    prev ? { ...prev, hint: { ...prev.hint, summary: event.target.value } } : prev
                                )
                            }
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditor(null)}>{t('hints.cancel')}</Button>
                    <Button
                        variant='contained'
                        disabled={!editor || !editor.hint.name.trim()}
                        onClick={handleEditorSave}
                    >
                        {t('hints.ok')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 削除確認ダイアログ */}
            <Dialog
                open={deleteTarget !== null}
                onClose={(_event, reason) => {
                    if (reason === 'backdropClick') return;
                    setDeleteTarget(null);
                }}
                maxWidth='xs'
            >
                <DialogTitle>{t('hints.dialogDeleteTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2'>
                        {t('hints.dialogDeleteMessage', { name: deleteTarget?.name ?? '' })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)}>{t('hints.cancel')}</Button>
                    <Button variant='contained' color='error' onClick={handleDelete}>
                        {t('hints.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Stack>
    );
}
