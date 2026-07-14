import React from 'react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import { useTranslation } from 'react-i18next';
import { API_PROVIDER_DEFINITIONS, type ApiProviderDefinition } from '@shared/api-provider-catalog';
import type { AgentCliAvailability } from '@shared/types';
import type { AgentCliConfig } from '@shared/models/agent-cli-config';
import type { ApiProviderConfig } from '@shared/models/api-provider-config';
import { useAppStore } from '../store';

// 翻訳サーバーの起動画面
// 対応する Agent CLI と API プロバイダーを一覧表示し、各エンジンの設定と開始/停止を行う
// 翻訳ヒントは全エンジン共通の設定として画面上部に置き、選択の変更で即時保存する

type AgentAccordionProps = {
    agent: AgentCliAvailability;
};

function AgentAccordion({ agent }: AgentAccordionProps) {
    const { t } = useTranslation();
    const settings = useAppStore(state => state.settings);
    const status = useAppStore(state => state.status);
    const saveAgentConfig = useAppStore(state => state.saveAgentConfig);
    const startServer = useAppStore(state => state.startServer);
    const stopServer = useAppStore(state => state.stopServer);

    const savedConfig = settings?.agents[agent.id];
    const requiresModel = agent.id === 'opencode-ollama';

    const [draft, setDraft] = React.useState<AgentCliConfig | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);
    const [modelRequired, setModelRequired] = React.useState(false);
    const modelInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (savedConfig) {
            setDraft({ ...savedConfig });
            if (savedConfig.modelName) setModelRequired(false);
        }
    }, [savedConfig]);

    if (!savedConfig || !draft) return null;

    const isRunningSelf = status.running && status.agentId === agent.id;
    const isDirty =
        draft.maxConcurrency !== savedConfig.maxConcurrency ||
        draft.maxUses !== savedConfig.maxUses ||
        draft.modelName !== savedConfig.modelName;
    const startDisabled = !agent.available || (status.running && !isRunningSelf) || busy;

    const handleStartStop = async (event: React.MouseEvent) => {
        event.stopPropagation();
        if (!isRunningSelf && requiresModel && !savedConfig.modelName?.trim()) {
            setExpanded(true);
            setModelRequired(true);
            setTimeout(() => modelInputRef.current?.focus(), 0);
            return;
        }
        setBusy(true);
        try {
            if (isRunningSelf) {
                await stopServer();
            } else {
                await startServer(agent.id);
            }
        } finally {
            setBusy(false);
        }
    };

    const handleSave = async () => {
        const maxConcurrency = Math.max(1, Math.floor(draft.maxConcurrency || 1));
        const maxUses = Math.max(1, Math.floor(draft.maxUses || 1));
        const modelName = draft.modelName?.trim() || null;
        try {
            await saveAgentConfig(agent.id, { ...draft, maxConcurrency, maxUses, modelName });
            if (modelName) setModelRequired(false);
        } catch {
            // エラーはストアの lastError 経由で Snackbar に表示される
        }
    };

    return (
        <Accordion disableGutters expanded={expanded} onChange={(_event, value) => setExpanded(value)}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} slotProps={{ root: { component: 'div' } }}>
                <Stack direction='row' spacing={2} sx={{ alignItems: 'center', flexGrow: 1, mr: 2 }}>
                    <Typography sx={{ fontWeight: 500, minWidth: 120 }}>{agent.displayName}</Typography>
                    <Typography variant='caption' sx={{ color: 'text.secondary', flexGrow: 1 }} noWrap>
                        {agent.command}
                    </Typography>
                    <Button
                        size='small'
                        variant='contained'
                        color={isRunningSelf ? 'error' : 'primary'}
                        startIcon={isRunningSelf ? <StopIcon /> : <PlayArrowIcon />}
                        disabled={!isRunningSelf && startDisabled}
                        onClick={handleStartStop}
                        onFocus={event => event.stopPropagation()}
                    >
                        {isRunningSelf ? t('server.stop') : t('server.start')}
                    </Button>
                </Stack>
            </AccordionSummary>
            <AccordionDetails>
                <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                            label={t('server.maxConcurrency')}
                            type='number'
                            size='small'
                            value={draft.maxConcurrency}
                            onChange={event => setDraft({ ...draft, maxConcurrency: Number(event.target.value) })}
                            slotProps={{ htmlInput: { min: 1, max: 32 } }}
                            sx={{ width: 180 }}
                        />
                        <TextField
                            label={t('server.maxUses')}
                            type='number'
                            size='small'
                            value={draft.maxUses}
                            onChange={event => setDraft({ ...draft, maxUses: Number(event.target.value) })}
                            slotProps={{ htmlInput: { min: 1, max: 10000 } }}
                            sx={{ width: 180 }}
                        />
                        {requiresModel && (
                            <TextField
                                label={t('server.ollamaModel')}
                                size='small'
                                value={draft.modelName ?? ''}
                                onChange={event => setDraft({ ...draft, modelName: event.target.value })}
                                inputRef={modelInputRef}
                                placeholder={t('server.modelPlaceholder')}
                                error={modelRequired}
                                helperText={modelRequired ? t('server.ollamaModelRequired') : undefined}
                                sx={{ minWidth: 320, flexGrow: 1 }}
                            />
                        )}
                    </Stack>
                    <Divider />
                    <Stack direction='row' spacing={2} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                        <Typography variant='caption' sx={{ color: 'text.secondary' }}>
                            {t('server.settingsNote')}
                        </Typography>
                        <Button variant='contained' size='small' disabled={!isDirty} onClick={handleSave}>
                            {t('server.save')}
                        </Button>
                    </Stack>
                </Stack>
            </AccordionDetails>
        </Accordion>
    );
}

type ApiProviderAccordionProps = {
    definition: ApiProviderDefinition;
};

function ApiProviderAccordion({ definition }: ApiProviderAccordionProps) {
    const { t } = useTranslation();
    const settings = useAppStore(state => state.settings);
    const status = useAppStore(state => state.status);
    const saveApiProviderConfig = useAppStore(state => state.saveApiProviderConfig);
    const testApiConnection = useAppStore(state => state.testApiConnection);
    const listApiModels = useAppStore(state => state.listApiModels);
    const startServer = useAppStore(state => state.startServer);
    const stopServer = useAppStore(state => state.stopServer);

    const savedConfig = settings?.apiProviders[definition.id];

    const [draft, setDraft] = React.useState<ApiProviderConfig | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);
    const [modelRequired, setModelRequired] = React.useState(false);
    const modelInputRef = React.useRef<HTMLInputElement>(null);

    // 接続テスト
    const [testing, setTesting] = React.useState(false);
    const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);

    // モデル選択ダイアログ
    const [modelDialogOpen, setModelDialogOpen] = React.useState(false);
    const [modelLoading, setModelLoading] = React.useState(false);
    const [modelList, setModelList] = React.useState<string[]>([]);
    const [modelError, setModelError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (savedConfig) {
            setDraft({ ...savedConfig });
            if (savedConfig.model.trim()) setModelRequired(false);
        }
    }, [savedConfig]);

    if (!savedConfig || !draft) return null;

    const isRunningSelf = status.running && status.agentId === definition.id;
    const isDirty =
        draft.baseUrl !== savedConfig.baseUrl ||
        draft.apiKey !== savedConfig.apiKey ||
        draft.model !== savedConfig.model ||
        draft.maxConcurrency !== savedConfig.maxConcurrency;
    const startDisabled = (status.running && !isRunningSelf) || busy;

    const handleStartStop = async (event: React.MouseEvent) => {
        event.stopPropagation();
        if (!isRunningSelf && !savedConfig.model.trim()) {
            setExpanded(true);
            setModelRequired(true);
            setTimeout(() => modelInputRef.current?.focus(), 0);
            return;
        }
        setBusy(true);
        try {
            if (isRunningSelf) {
                await stopServer();
            } else {
                await startServer(definition.id);
            }
        } finally {
            setBusy(false);
        }
    };

    const handleSave = async () => {
        const model = draft.model.trim();
        const maxConcurrency = Math.max(1, Math.floor(draft.maxConcurrency || 1));
        try {
            await saveApiProviderConfig(definition.id, {
                baseUrl: draft.baseUrl.trim(),
                apiKey: draft.apiKey,
                model,
                maxConcurrency,
            });
            if (model) setModelRequired(false);
        } catch {
            // エラーはストアの lastError 経由で Snackbar に表示される
        }
    };

    const probeConfig = (): ApiProviderConfig => ({
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey,
        model: draft.model,
        maxConcurrency: draft.maxConcurrency,
    });

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const result = await testApiConnection(definition.id, probeConfig());
            setTestResult(
                result.ok
                    ? { ok: true, message: t('server.testSuccess') }
                    : { ok: false, message: t('server.testFailure', { error: result.error ?? '' }) }
            );
        } finally {
            setTesting(false);
        }
    };

    const handleOpenModelDialog = async () => {
        setModelDialogOpen(true);
        setModelLoading(true);
        setModelError(null);
        setModelList([]);
        try {
            const models = await listApiModels(definition.id, probeConfig());
            setModelList(models);
        } catch (error) {
            setModelError(error instanceof Error ? error.message : String(error));
        } finally {
            setModelLoading(false);
        }
    };

    const handleSelectModel = (model: string) => {
        setDraft({ ...draft, model });
        setModelRequired(false);
        setModelDialogOpen(false);
    };

    return (
        <Accordion disableGutters expanded={expanded} onChange={(_event, value) => setExpanded(value)}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} slotProps={{ root: { component: 'div' } }}>
                <Stack direction='row' spacing={2} sx={{ alignItems: 'center', flexGrow: 1, mr: 2 }}>
                    <Typography sx={{ fontWeight: 500, minWidth: 120 }}>{definition.displayName}</Typography>
                    <Typography variant='caption' sx={{ color: 'text.secondary', flexGrow: 1 }} noWrap>
                        {savedConfig.model || definition.defaultBaseUrl}
                    </Typography>
                    <Button
                        size='small'
                        variant='contained'
                        color={isRunningSelf ? 'error' : 'primary'}
                        startIcon={isRunningSelf ? <StopIcon /> : <PlayArrowIcon />}
                        disabled={!isRunningSelf && startDisabled}
                        onClick={handleStartStop}
                        onFocus={event => event.stopPropagation()}
                    >
                        {isRunningSelf ? t('server.stop') : t('server.start')}
                    </Button>
                </Stack>
            </AccordionSummary>
            <AccordionDetails>
                <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                            label={t('server.apiBaseUrl')}
                            size='small'
                            value={draft.baseUrl}
                            onChange={event => setDraft({ ...draft, baseUrl: event.target.value })}
                            placeholder={definition.defaultBaseUrl}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ minWidth: 260, flexGrow: 1 }}
                        />
                        <TextField
                            label={t('server.apiKey')}
                            type='password'
                            size='small'
                            value={draft.apiKey}
                            onChange={event => setDraft({ ...draft, apiKey: event.target.value })}
                            autoComplete='off'
                            sx={{ minWidth: 220, flexGrow: 1 }}
                        />
                    </Stack>
                    <Stack direction='row' spacing={1} sx={{ alignItems: 'flex-start' }}>
                        <TextField
                            label={t('server.apiMaxConnections')}
                            type='number'
                            size='small'
                            value={draft.maxConcurrency}
                            onChange={event => setDraft({ ...draft, maxConcurrency: Number(event.target.value) })}
                            slotProps={{ htmlInput: { min: 1, max: 32 } }}
                            sx={{ width: 180 }}
                        />
                        <TextField
                            label={t('server.apiModel')}
                            size='small'
                            value={draft.model}
                            onChange={event => setDraft({ ...draft, model: event.target.value })}
                            inputRef={modelInputRef}
                            placeholder={t('server.modelPlaceholder')}
                            error={modelRequired}
                            helperText={modelRequired ? t('server.apiModelRequired') : undefined}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ flexGrow: 1 }}
                        />
                        <Button
                            variant='outlined'
                            size='small'
                            startIcon={<FormatListBulletedIcon />}
                            onClick={handleOpenModelDialog}
                            sx={{ flexShrink: 0, height: 40, whiteSpace: 'nowrap' }}
                        >
                            {t('server.apiModelSelect')}
                        </Button>
                    </Stack>
                    <Divider />
                    <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Typography variant='caption' sx={{ color: 'text.secondary', flexGrow: 1 }}>
                            {t('server.settingsNote')}
                        </Typography>
                        {testResult && (
                            <Typography
                                variant='caption'
                                sx={{ color: testResult.ok ? 'success.main' : 'error.main', wordBreak: 'break-all' }}
                            >
                                {testResult.message}
                            </Typography>
                        )}
                        <Button
                            variant='outlined'
                            size='small'
                            onClick={handleTest}
                            disabled={testing}
                            startIcon={testing ? <CircularProgress size={16} /> : undefined}
                            sx={{ flexShrink: 0 }}
                        >
                            {t('server.apiTestConnection')}
                        </Button>
                        <Button variant='contained' size='small' disabled={!isDirty} onClick={handleSave}>
                            {t('server.save')}
                        </Button>
                    </Stack>
                </Stack>
            </AccordionDetails>
            <Dialog open={modelDialogOpen} onClose={() => setModelDialogOpen(false)} fullWidth maxWidth='xs'>
                <DialogTitle>{t('server.modelDialogTitle')}</DialogTitle>
                <DialogContent dividers>
                    {modelLoading && (
                        <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', py: 2 }}>
                            <CircularProgress size={20} />
                            <Typography variant='body2'>{t('server.modelDialogLoading')}</Typography>
                        </Stack>
                    )}
                    {!modelLoading && modelError && (
                        <Alert severity='error'>{t('server.modelDialogError', { error: modelError })}</Alert>
                    )}
                    {!modelLoading && !modelError && modelList.length === 0 && (
                        <Typography variant='body2' sx={{ color: 'text.secondary', py: 1 }}>
                            {t('server.modelDialogEmpty')}
                        </Typography>
                    )}
                    {!modelLoading && !modelError && modelList.length > 0 && (
                        <List dense disablePadding>
                            {modelList.map(model => (
                                <ListItemButton
                                    key={model}
                                    selected={model === draft.model}
                                    onClick={() => handleSelectModel(model)}
                                >
                                    <ListItemText primary={model} />
                                </ListItemButton>
                            ))}
                        </List>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setModelDialogOpen(false)}>{t('server.cancel')}</Button>
                </DialogActions>
            </Dialog>
        </Accordion>
    );
}

export default function ServerPanel() {
    const { t } = useTranslation();
    const settings = useAppStore(state => state.settings);
    const agents = useAppStore(state => state.agents);
    const saveTranslationHint = useAppStore(state => state.saveTranslationHint);

    const hints = settings?.hints ?? [];
    const hintId = settings?.common.hintId ?? null;
    const availableAgents = agents.filter(agent => agent.available);

    return (
        <Stack spacing={2} sx={{ p: 2 }}>
            <TextField
                label={t('server.hint')}
                select
                size='small'
                value={hintId ?? 'none'}
                onChange={event => {
                    const next = event.target.value === 'none' ? null : event.target.value;
                    if (next !== hintId) void saveTranslationHint(next);
                }}
                sx={{ minWidth: 280 }}
            >
                <MenuItem value='none'>{t('server.hintNone')}</MenuItem>
                {hints.map(hint => (
                    <MenuItem key={hint.id} value={hint.id}>
                        {hint.name}
                    </MenuItem>
                ))}
            </TextField>

            <Box>
                <Typography variant='subtitle2' sx={{ mb: 1, color: 'text.secondary' }}>
                    {t('server.sectionAgentCli')}
                </Typography>
                {availableAgents.length === 0 && <Alert severity='warning'>{t('server.noAgents')}</Alert>}
                {availableAgents.map(agent => (
                    <AgentAccordion key={agent.id} agent={agent} />
                ))}
            </Box>

            <Box>
                <Typography variant='subtitle2' sx={{ mb: 1, color: 'text.secondary' }}>
                    {t('server.sectionApi')}
                </Typography>
                {API_PROVIDER_DEFINITIONS.map(definition => (
                    <ApiProviderAccordion key={definition.id} definition={definition} />
                ))}
            </Box>
        </Stack>
    );
}
