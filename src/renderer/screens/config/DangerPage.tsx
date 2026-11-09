import { useState } from 'react';
import { Alert, Button, Typography } from '@mui/material';
import { callIpc } from '../../lib/ipc.js';
import { RestoreConfirmDialog } from '../settings/RestoreConfirmDialog.js';
import { workspacePathHint } from '../../../shared/brand.js';
import { ConfigPageFrame } from './ConfigPageFrame.js';

export function DangerPage(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async (): Promise<void> => {
    setRestoring(true);
    setError(null);
    try {
      await callIpc('app.restore', {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao restaurar');
    } finally {
      setRestoring(false);
      setOpen(false);
    }
  };

  return (
    <ConfigPageFrame title="Zona de perigo" danger testId="config-page-danger">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Restaura o aplicativo para o estado inicial deletando <code>{workspacePathHint()}</code>, <code>~/.claude</code> e <code>.env.local</code>. O aplicativo será fechado em seguida.
      </Typography>
      {error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Button variant="outlined" color="error" disabled={restoring} onClick={() => setOpen(true)}>
        {restoring ? 'Restaurando…' : 'Restaurar para estado inicial'}
      </Button>
      <RestoreConfirmDialog open={open} onConfirm={() => void restore()} onCancel={() => setOpen(false)} />
    </ConfigPageFrame>
  );
}
