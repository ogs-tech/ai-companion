import { useEffect, useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { ConfigPageFrame } from './ConfigPageFrame.js';

export function GitHubPage(): React.ReactElement {
  const [value, setValue] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [safeStorageUnavailable, setSafeStorageUnavailable] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const result = await callIpc<{ hasToken: boolean }>('credentials.hasGithubToken', {});
        setHasToken(result.hasToken);
      } catch (err) {
        if (err instanceof IpcCallError && err.kind === 'io') setSafeStorageUnavailable(true);
      }
    })();
  }, []);

  const save = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await callIpc('credentials.setGithubToken', { token: value });
      setHasToken(true);
      setValue('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o PAT');
    } finally {
      setLoading(false);
    }
  };

  const clear = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await callIpc('credentials.clearGithubToken', {});
      setHasToken(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao limpar o PAT');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfigPageFrame title="GitHub" testId="config-page-github">
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        Personal Access Token para publicar plugins no GitHub. Status: <strong>{hasToken ? 'Configurado' : 'Não configurado'}</strong>
      </Typography>
      {safeStorageUnavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Armazenamento seguro não está disponível neste sistema. O GitHub PAT não pode ser salvo.
        </Alert>
      )}
      {error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          PAT salvo com sucesso.
        </Alert>
      )}
      <Stack direction="row" sx={{ gap: 2, alignItems: 'flex-start' }}>
        <TextField
          type="password"
          label="GitHub Personal Access Token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          size="small"
          disabled={safeStorageUnavailable || loading}
          sx={{ flexGrow: 1 }}
        />
        <Button variant="contained" onClick={() => void save()} disabled={!value || safeStorageUnavailable || loading}>
          Salvar
        </Button>
        <Button variant="outlined" color="error" onClick={() => void clear()} disabled={!hasToken || safeStorageUnavailable || loading}>
          Limpar
        </Button>
      </Stack>
    </ConfigPageFrame>
  );
}
