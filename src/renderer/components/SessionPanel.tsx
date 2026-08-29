import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { SquareTerminal, Lock } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import { sessionsQueryKey } from '../hooks/use-sessions.js';
import { sessionAnchorKey, type SessionAnchor, type SessionSnapshotWithOutput } from '../../shared/session.js';
import { Kicker } from './ds/Kicker.js';
import { Icon } from './ds/Icon.js';
import { StatusPill, type StatusPillVariant } from './ds/StatusPill.js';
import { EmptyState } from './ds/EmptyState.js';
import { ogs, colorRoles } from '../tokens.js';
import { SESSION_STATUS_PILL } from '../lib/session-status-pill.js';

type PanelStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

interface SessionPanelProps {
  anchor: SessionAnchor;
  /**
   * The concrete session this panel is already attached to — passed by every
   * tab opened from the Workbench (any anchor kind), where the caller
   * already holds a live or resumed `sessionId` from a `spawn`/`resume`
   * response or an existing `SessionSnapshot` row. When present, the panel
   * attaches directly via `session.status(sessionId)` instead of deriving an
   * id from the anchor, skips the idle "Abrir sessão" state entirely, and
   * its inline "Retomar" action calls `session.resume(sessionId)`. Absent
   * only for a caller that doesn't yet have a session to attach to, which
   * keeps today's mount-time anchor-keyed reattach and click-to-spawn flow.
   */
  sessionId?: string;
  /** Whether this panel is the one currently in focus. Panels kept mounted in the background (visible=false) skip resize/fit so a zero-size container doesn't miscalculate the terminal's dimensions. */
  visible?: boolean;
}

const STATUS_PILL: Record<PanelStatus, { variant: StatusPillVariant; label: string }> = {
  idle: { variant: 'idle', label: 'Parada' },
  starting: { variant: 'starting', label: 'Iniciando' },
  error: { variant: 'error', label: 'Erro' },
  ...SESSION_STATUS_PILL,
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

export function SessionPanel({ anchor, sessionId: sessionIdProp, visible = true }: SessionPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const queryClient = useQueryClient();

  const [sessionId, setSessionId] = useState<string | null>(sessionIdProp ?? null);
  const [status, setStatus] = useState<PanelStatus>(sessionIdProp ? 'starting' : 'idle');
  const [error, setError] = useState<string | null>(null);

  // Attaches to a session already running server-side. When the caller
  // already knows a concrete sessionId (every Workbench tab, opened from a
  // spawn/resume response or an existing SessionSnapshot row), that id is
  // looked up directly — no idle "Abrir sessão" gate, since one is known to
  // exist by construction. Otherwise (only the CustomizationEditor-style
  // usage today), the anchor's own key doubles as its sessionId, so this is
  // still a plain lookup, no spawn needed — it just may find nothing yet.
  useEffect(() => {
    const lookupId = sessionIdProp ?? sessionAnchorKey(anchor);
    let active = true;
    void (async () => {
      try {
        const existing = await callIpc<SessionSnapshotWithOutput | null>('session.status', { sessionId: lookupId });
        if (active && existing) {
          if (!sessionIdProp) setSessionId(existing.sessionId);
          setStatus(existing.status === 'exited' ? 'exited' : 'running');
          // Written straight to the terminal (not through React state) so it
          // lands before the live onOutput subscription below ever starts —
          // by the time this resolves, the terminal-creation effect has
          // already run (it has no async gap), so the ref is populated.
          if (existing.outputBuffer) terminalRef.current?.write(existing.outputBuffer);
        }
      } catch {
        // No session to reattach to — stay idle/starting, same as a fresh anchor/session.
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdProp, sessionAnchorKey(anchor)]);

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
    // A hidden container (kept mounted in the background so its scrollback
    // survives) reports zero size — fitting against that would shrink the
    // terminal to nothing, so skip until it's visible again, then re-fit.
    const syncSize = (): void => {
      if (!visible) return;
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims && sessionId) {
        void callIpc('session.resize', { sessionId, cols: dims.cols, rows: dims.rows });
      }
    };
    syncSize();
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, [sessionId, visible]);

  const handleOpen = async (): Promise<void> => {
    setStatus('starting');
    setError(null);
    try {
      const session = await callIpc<SessionSnapshotWithOutput>('session.spawn', { anchor });
      setSessionId(session.sessionId);
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      // The resize effect below reacts to `sessionId` changing and fits/resizes
      // itself — no need to duplicate that call here.
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  const handleResume = async (id: string): Promise<void> => {
    setStatus('starting');
    setError(null);
    try {
      const session = await callIpc<SessionSnapshotWithOutput>('session.resume', { sessionId: id });
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  // Once a concrete sessionId is known (from the prop, or from an earlier
  // handleOpen), reconnecting means resuming that same session; only a
  // caller that never had one falls back to spawning fresh from the anchor.
  const reconnect = (): void => {
    void (sessionIdProp ? handleResume(sessionIdProp) : handleOpen());
  };

  const action =
    status === 'idle' || status === 'error' ? (
      <Button variant="outlined" size="small" onClick={reconnect} data-testid="session-open">
        {status === 'error' ? 'Tentar novamente' : 'Abrir sessão'}
      </Button>
    ) : status === 'exited' ? (
      <Button size="small" onClick={reconnect} data-testid="session-resume">
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
          borderRadius: `${theme.ogs.radius.md}px`,
          overflow: 'hidden',
        })}
      />
    </Box>
  );
}
