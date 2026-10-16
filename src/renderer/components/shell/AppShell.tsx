import { useEffect, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { TopNav } from './TopNav.js';
import { AppFooter } from './AppFooter.js';
import { CommandPalette } from './CommandPalette.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useContextNavigation } from '../../hooks/use-context-navigation.js';

interface AppShellProps {
  onOpenSettings: () => void;
  healthSeverity?: 'ok' | 'warning' | 'error';
  children: ReactNode;
}

export function AppShell({ onOpenSettings, healthSeverity, children }: AppShellProps): React.ReactElement {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const { openFolder } = useContextNavigation();

  // Re-registered every render so ⌘O always calls the current `openFolder`
  // (it closes over the active workspace).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (key === 'o') {
        e.preventDefault();
        openFolder().catch((err: unknown) =>
          setToast({ variant: 'error', message: err instanceof Error ? err.message : String(err) }),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Box
      data-testid="main-screen"
      sx={{ height: '100vh', overflow: 'hidden', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}
    >
      <TopNav onOpenSettings={onOpenSettings} onOpenCommandPalette={() => setPaletteOpen(true)} />
      <Box data-testid="app-shell" sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, overflowY: 'auto' }}>
          {children}
        </Box>
      </Box>
      <AppFooter {...(healthSeverity !== undefined ? { healthSeverity } : {})} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
