import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import type { SessionSnapshot } from '../../../shared/session.js';

interface InlinePermissionProps {
  session: SessionSnapshot;
  onOpenSession: () => void;
}

/**
 * The full request under a Pergunta row: exact command, directory and the last thing the assistant said,
 * so nothing is approved unseen. Only "once" and "deny" exist — no "always", no batch approval.
 * Shown only for a prompt the `PermissionRequest` hook raised (it is what makes answering possible).
 */
export function InlinePermission({ session, onOpenSession }: InlinePermissionProps): React.ReactElement | null {
  const request = session.permissionRequest;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!request) return null;

  const answer = async (decision: 'allow' | 'deny'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await callIpc('session.answerPermission', { sessionId: session.sessionId, decision });
    } catch (err) {
      setError(err instanceof IpcCallError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-testid={`inline-permission-${session.sessionId}`} sx={{ mx: 1.25, mb: 0.75, p: 1, border: 1, borderColor: 'warning.main', borderRadius: 1 }}>
      {session.metrics?.lastAssistantText && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }} data-testid="inline-permission-context">
          {session.metrics.lastAssistantText}
        </Typography>
      )}
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
        {request.tool}
      </Typography>
      <Box
        component="pre"
        data-testid="inline-permission-command"
        sx={{ m: 0, my: 0.5, p: 0.75, fontSize: '0.6875rem', bgcolor: 'action.hover', borderRadius: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflow: 'auto' }}
      >
        {request.command}
      </Box>
      {request.cwd && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {`em ${request.cwd}`}
        </Typography>
      )}
      <Stack direction="row" spacing={0.75}>
        <Button size="small" variant="contained" disabled={busy} onClick={() => void answer('allow')} data-testid="inline-permission-allow">
          Permitir uma vez
        </Button>
        <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={() => void answer('deny')} data-testid="inline-permission-deny">
          Negar
        </Button>
        <Button size="small" color="inherit" onClick={onOpenSession} data-testid="inline-permission-open">
          Abrir sessão
        </Button>
      </Stack>
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      )}
    </Box>
  );
}
