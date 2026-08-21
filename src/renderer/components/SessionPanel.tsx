import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import type { SessionSnapshot } from '../../shared/session.js';

type PanelStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

interface SessionPanelProps {
  entityUrn: string;
}

export function SessionPanel({ entityUrn }: SessionPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const terminal = new Terminal({ convertEol: true, fontSize: 13 });
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
      const session = await callIpc<SessionSnapshot>('session.spawn', { entityUrn });
      setSessionId(session.entityUrn);
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) {
        void callIpc('session.resize', { sessionId: session.entityUrn, cols: dims.cols, rows: dims.rows });
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  return (
    <Box data-testid="session-panel">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        {(status === 'idle' || status === 'error') && (
          <Button variant="outlined" size="small" onClick={() => void handleOpen()} data-testid="session-open">
            Abrir sessão
          </Button>
        )}
        {status === 'starting' && <Typography variant="body2">Iniciando sessão…</Typography>}
        {status === 'running' && <Typography variant="body2" color="success.main">Sessão ativa</Typography>}
        {status === 'exited' && (
          <>
            <Typography variant="body2" color="text.secondary">Sessão encerrada</Typography>
            <Button size="small" onClick={() => void handleOpen()} data-testid="session-resume">Retomar</Button>
          </>
        )}
      </Stack>
      {error && (
        <Typography color="error" data-testid="session-error" sx={{ mb: 1 }}>
          {error}
        </Typography>
      )}
      <Box ref={containerRef} data-testid="session-terminal" sx={{ height: 360 }} />
    </Box>
  );
}
