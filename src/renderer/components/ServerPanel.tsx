import React from 'react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Alert,
    Box,
    Button,
    Divider,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import type { AgentCliAvailability } from '@shared/types';
import type { AgentCliConfig } from '@shared/models/agent-cli-config';
import { useAppStore } from '../store';

// 翻訳サーバーの起動画面
// 対応する Agent CLI を一覧表示し、各エージェントの設定と開始/停止を行う

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
    const hints = settings?.hints ?? [];

    const [draft, setDraft] = React.useState<AgentCliConfig | null>(null);
    const [busy, setBusy] = React.useState(false);

    // 保存済み設定の変化 (保存完了・ヒント削除等) に合わせてドラフトを初期化する
    React.useEffect(() => {
        if (savedConfig) {
            setDraft({ ...savedConfig });
        }
    }, [savedConfig]);

    if (!savedConfig || !draft) return null;

    const isRunningSelf = status.running && status.agentId === agent.id;
    const isDirty = draft.maxConcurrency !== savedConfig.maxConcurrency || draft.hintId !== savedConfig.hintId;
    const startDisabled = !agent.available || (status.running && !isRunningSelf) || busy;

    const handleStartStop = async (event: React.MouseEvent) => {
        // アコーディオンの開閉を抑止する
        event.stopPropagation();
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
        try {
            await saveAgentConfig(agent.id, { ...draft, maxConcurrency });
        } catch {
            // エラーはストアの lastError 経由で Snackbar に表示される
        }
    };

    return (
        <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
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
                            onChange={event =>
                                setDraft({ ...draft, maxConcurrency: Number(event.target.value) })
                            }
                            slotProps={{ htmlInput: { min: 1, max: 32 } }}
                            sx={{ width: 180 }}
                        />
                        <TextField
                            label={t('server.hint')}
                            select
                            size='small'
                            // MUI の Select は空文字を「未選択」として扱うため、未使用は番兵値 'none' で表現する
                            value={draft.hintId ?? 'none'}
                            onChange={event =>
                                setDraft({
                                    ...draft,
                                    hintId: event.target.value === 'none' ? null : event.target.value,
                                })
                            }
                            sx={{ minWidth: 240 }}
                        >
                            <MenuItem value='none'>{t('server.hintNone')}</MenuItem>
                            {hints.map(hint => (
                                <MenuItem key={hint.id} value={hint.id}>
                                    {hint.name}
                                </MenuItem>
                            ))}
                        </TextField>
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

export default function ServerPanel() {
    const { t } = useTranslation();
    const agents = useAppStore(state => state.agents);
    const status = useAppStore(state => state.status);
    const refreshAgents = useAppStore(state => state.refreshAgents);

    const runningAgent = agents.find(agent => agent.id === status.agentId);
    // コマンドが検出できた Agent CLI のみを表示する
    const availableAgents = agents.filter(agent => agent.available);

    return (
        <Stack spacing={2} sx={{ p: 2 }}>
            <Stack direction='row' spacing={2} sx={{ alignItems: 'center' }}>
                <Alert severity={status.running ? 'success' : 'info'} sx={{ flexGrow: 1, py: 0 }}>
                    {status.running
                        ? `${t('server.statusRunning', {
                              agent: runningAgent?.displayName ?? status.agentId,
                              host: status.host,
                              port: status.port,
                          })} - ${t('server.workers', {
                              active: status.activeWorkers,
                              busy: status.busyWorkers,
                              queue: status.queueLength,
                          })}`
                        : t('server.statusStopped')}
                </Alert>
                <Button size='small' startIcon={<RefreshIcon />} onClick={() => void refreshAgents()}>
                    {t('server.redetect')}
                </Button>
            </Stack>
            <Box>
                {availableAgents.length === 0 && <Alert severity='warning'>{t('server.noAgents')}</Alert>}
                {availableAgents.map(agent => (
                    <AgentAccordion key={agent.id} agent={agent} />
                ))}
            </Box>
        </Stack>
    );
}
