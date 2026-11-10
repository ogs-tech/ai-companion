import { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { TerminalPanel, type TerminalPanelIpc } from '../../components/workspace/TerminalPanel.js';
import { callIpc } from '../../lib/ipc.js';

const SETUP_IPC: TerminalPanelIpc = { write: 'channelSetup.write', resize: 'channelSetup.resize', status: 'channelSetup.terminal' };

interface ChannelSetupDialogProps {
  terminalId: string;
  title: string;
  /** Next step offered once the command succeeded (e.g. "Entrar agora" after an install). */
  next?: { label: string; onClick: () => void };
  /** Called after the dialog closed and the PTY was released. */
  onClose: () => void;
  /** Called when the command exits, whatever the code, so the page can re-check the channel. */
  onExited: () => void;
}

/** A visible terminal running one install / sign-in command; the user can type into it (OAuth prompts, sudo). */
export function ChannelSetupDialog({ terminalId, title, next, onClose, onExited }: ChannelSetupDialogProps): React.ReactElement {
  const [exit, setExit] = useState<{ code: number | null } | null>(null);

  useEffect(() => {
    const unsub = window.api.terminal.onExit(terminalId, (code) => {
      setExit({ code });
      onExited();
    });
    return unsub;
  }, [terminalId, onExited]);

  const close = (): void => {
    void callIpc('channelSetup.close', { terminalId }).finally(onClose);
  };

  const ok = exit !== null && exit.code === 0;
  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm" data-testid="channel-setup-dialog">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ height: 260 }}>
          <TerminalPanel terminalId={terminalId} ipc={SETUP_IPC} />
        </Box>
        <Typography variant="caption" color="text.secondary" role="status" sx={{ display: 'block', mt: 1 }}>
          {exit === null ? 'Em andamento. Responda aqui se o comando pedir algo.' : ok ? 'Concluído.' : `Terminou com erro (código ${exit.code ?? '—'}). Role o terminal para ver o motivo.`}
        </Typography>
      </DialogContent>
      <DialogActions>
        {ok && next && (
          <Button variant="contained" onClick={() => void callIpc('channelSetup.close', { terminalId }).finally(next.onClick)}>
            {next.label}
          </Button>
        )}
        <Button onClick={close}>{exit === null ? 'Cancelar' : 'Fechar'}</Button>
      </DialogActions>
    </Dialog>
  );
}
