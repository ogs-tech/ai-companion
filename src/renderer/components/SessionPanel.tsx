import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { SquareTerminal, Lock } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import type { SessionAnchor, SessionSnapshot } from '../../shared/session.js';
import { Kicker } from './ds/Kicker.js';
import { Icon } from './ds/Icon.js';
import { StatusPill, type StatusPillVariant } from './ds/StatusPill.js';
import { EmptyState } from './ds/EmptyState.js';
import { ogs, colorRoles } from '../tokens.js';

type PanelStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

interface SessionPanelProps {
  anchor: SessionAnchor;
}

const STATUS_PILL: Record<PanelStatus, { variant: StatusPillVariant; label: string }> = {
  idle: { variant: 'idle', label: 'Parada' },
  starting: { variant: 'starting', label: 'Iniciando' },
  running: { variant: 'running', label: 'Ativa' },
  exited: { variant: 'exited', label: 'Encerrada' },
  error: { variant: 'error', label: 'Erro' },
};

// A real terminal reads as its own environment, not as a themed app panel —
// so this stays ink-on-cream regardless of the app's light/dark mode.
const TERMINAL_XTERM_THEME = {
  background: ogs.ink,
  foreground: ogs.creamInk,
  cursor: colorRoles.dark.azul,
};

interface SessionHeaderProps {
  pill: { variant: StatusPillVariant; label: string };
  action?: React.ReactNode;
}

function SessionHeader({ pill, action }: SessionHeaderProps): React.ReactElement {
  return (
    <Stack
      direction="row"
      sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', rowGap: 1 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Icon glyph={SquareTerminal} size={16} />
        <Kicker>Sessão</Kicker>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <StatusPill variant={pill.variant} label={pill.label} testId="session" />
        {action}
      </Stack>
    </Stack>
  );
}

/** Shown in the editor before the entity's first save — there's no urn yet to anchor a session to. */
export function SessionPanelLocked(): React.ReactElement {
  return (
    <Box data-testid="session-panel-locked">
      <SessionHeader pill={{ variant: 'idle', label: 'Disponível após salvar' }} />
      <EmptyState
        glyph={Lock}
        title="Salve para abrir uma sessão"
        description="Um terminal claude fica ancorado a este item assim que ele existir de verdade."
        testId="session-locked"
      />
    </Box>
  );
}

export function SessionPanel({ anchor }: SessionPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const terminal = new Terminal({ convertEol: true, fontSize: 13, theme: TERMINAL_XTERM_THEME });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    if (containerRef.current) terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const dataDisposable = terminalRef.current?.onData((data) => {
      void callIpc('session.write', { sessionId, data });
    });
    const unsubOutput = window.api.session.onOutput(sessionId, (chunk) => {
      terminalRef.current?.write(chunk);
    });
    const unsubExit = window.api.session.onExit(sessionId, () => {
      setStatus('exited');
    });
    return () => {
      dataDisposable?.dispose();
      unsubOutput();
      unsubExit();
    };
  }, [sessionId]);

  useEffect(() => {
    const syncSize = (): void => {
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims && sessionId) {
        void callIpc('session.resize', { sessionId, cols: dims.cols, rows: dims.rows });
      }
    };
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, [sessionId]);

  const handleOpen = async (): Promise<void> => {
    setStatus('starting');
    setError(null);
    try {
      const session = await callIpc<SessionSnapshot>('session.spawn', { anchor });
      setSessionId(session.sessionId);
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) {
        void callIpc('session.resize', { sessionId: session.sessionId, cols: dims.cols, rows: dims.rows });
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  const action =
    status === 'idle' || status === 'error' ? (
      <Button variant="outlined" size="small" onClick={() => void handleOpen()} data-testid="session-open">
        {status === 'error' ? 'Tentar novamente' : 'Abrir sessão'}
      </Button>
    ) : status === 'exited' ? (
      <Button size="small" onClick={() => void handleOpen()} data-testid="session-resume">
        Retomar
      </Button>
    ) : null;

  return (
    <Box data-testid="session-panel">
      <SessionHeader pill={STATUS_PILL[status]} action={action} />
      {error && (
        <Typography color="error" data-testid="session-error" sx={{ mb: 1.5 }}>
          {error}
        </Typography>
      )}
      <Box
        ref={containerRef}
        data-testid="session-terminal"
        sx={(theme) => ({
          height: 420,
          p: 1,
          bgcolor: ogs.ink,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: theme.ogs.radius.md,
          overflow: 'hidden',
        })}
      />
    </Box>
  );
}
