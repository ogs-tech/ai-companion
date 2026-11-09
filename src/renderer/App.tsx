import { useCallback, useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { callIpc } from './lib/ipc.js';
import { queryClient } from './lib/query-client.js';
import { IoError } from './screens/IoError.js';
import { Main } from './screens/Main.js';
import { AppErrorBoundary } from './components/AppErrorBoundary.js';
import { DialogHost } from './components/DialogHost.js';
import { RecoveryScreen } from './components/RecoveryScreen.js';
import { useDesktopBridge } from './hooks/use-desktop-bridge.js';
import type { Settings } from '../shared/settings.js';

type View =
  | { kind: 'loading' }
  | { kind: 'main'; settings: Settings }
  | { kind: 'io-error'; message: string; retry: () => Promise<void> };

export function App(): React.ReactElement {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppRoot />
        <DialogHost />
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

function AppRoot(): React.ReactElement {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const recovery = useDesktopBridge();

  const bootstrap = useCallback(async (): Promise<void> => {
    try {
      const current = await callIpc<Settings | null>('settings.get', {});
      const settings =
        current ??
        (await callIpc<Settings>('settings.merge', {}));
      setView({ kind: 'main', settings });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'I/O error';
      setView({ kind: 'io-error', message, retry: () => bootstrap() });
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (recovery !== null) {
    return <RecoveryScreen details={recovery} onReload={() => window.location.reload()} />;
  }

  if (view.kind === 'loading') {
    return (
      <Box
        component="main"
        data-testid="loading-screen"
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          color: 'text.secondary',
        }}
      >
        <CircularProgress size={20} />
        Loading…
      </Box>
    );
  }

  if (view.kind === 'io-error') {
    return (
      <IoError
        message={view.message}
        onRetry={() => void view.retry()}
        onCancel={() => void bootstrap()}
      />
    );
  }

  return <Main />;
}
