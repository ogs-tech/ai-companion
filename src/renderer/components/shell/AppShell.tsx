import { useEffect, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { TopNav } from './TopNav.js';
import { StatusBar } from './StatusBar.js';
import { CommandPalette, type PaletteIntent } from './CommandPalette.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { openManualTab } from '../../lib/browser-tabs-store.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';
import { useThemeMode } from '../../lib/theme-mode-context.js';
import { useMenuCommand } from '../../lib/menu-commands.js';
import { ShortcutsDialog } from './ShortcutsDialog.js';
import { useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useUiPreferences } from '../../hooks/use-ui-settings.js';
import { hasActiveEditor } from '../../lib/editor-navigation.js';

interface AppShellProps {
  onOpenSettings: () => void;
  healthSeverity?: 'ok' | 'warning' | 'error';
  children: ReactNode;
}

export function AppShell({ onOpenSettings, healthSeverity, children }: AppShellProps): React.ReactElement {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIntent, setPaletteIntent] = useState<PaletteIntent>('commands');
  // A fresh key per opening resets the palette's query and mode.
  const [paletteKey, setPaletteKey] = useState(0);
  const openPalette = (intent: PaletteIntent): void => {
    setPaletteIntent(intent);
    setPaletteKey((k) => k + 1);
    setPaletteOpen(true);
  };
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { openFolder, goHome, switchTo, activeWorkspace } = useContextNavigation();
  const { data: workspaces } = useWorkspaces();
  const { setTheme } = useThemeMode();
  const prefs = useUiPreferences();

  // Links the session's CLI opened itself (`/login`, MCP OAuth) arrive from main.
  // Same http(s)-only rule as terminal links; main already filtered, this is defense in depth.
  useEffect(
    () =>
      window.api.externalLink.onOpen((url) => {
        if (/^https?:\/\//i.test(url)) void openManualTab(url);
      }),
    [],
  );

  // The native menu owns every shortcut (see src/shared/desktop.ts); these run when its items are clicked.
  useMenuCommand('command-palette', () => openPalette('commands'));
  useMenuCommand('quick-open', () => openPalette('files'));
  useMenuCommand('command-mode', () => openPalette('command-mode'));
  // ⌘G only means "go to line" while an editor is in front; otherwise it does nothing.
  useMenuCommand('go-to-line', () => {
    if (hasActiveEditor()) openPalette('line');
  });
  useMenuCommand('open-settings', onOpenSettings);
  useMenuCommand('toggle-word-wrap', () => prefs.setWordWrap(!prefs.wordWrap));
  useMenuCommand('show-shortcuts', () => setShortcutsOpen(true));
  useMenuCommand('theme-system', () => setTheme('system'));
  useMenuCommand('theme-light', () => setTheme('light'));
  useMenuCommand('theme-dark', () => setTheme('dark'));
  useMenuCommand('open-folder', () => {
    openFolder().catch((err: unknown) =>
      setToast({ variant: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  });
  useMenuCommand('go-home', () => {
    goHome().catch((err: unknown) =>
      setToast({ variant: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  });
  // Cycles Início → each workspace in list order → Início.
  useMenuCommand('next-workspace', () => {
    const ids = (workspaces ?? []).map((w) => w.id);
    const next = ids.length === 0 ? null : activeWorkspace ? ids[ids.indexOf(activeWorkspace.id) + 1] : ids[0];
    (next === undefined || next === null ? goHome() : switchTo(next)).catch((err: unknown) =>
      setToast({ variant: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  });
  useEffect(
    () =>
      window.api.desktop.onOpenWorkspace((workspaceId) => {
        switchTo(workspaceId).catch((err: unknown) =>
          setToast({ variant: 'error', message: err instanceof Error ? err.message : String(err) }),
        );
      }),
  );

  return (
    <Box
      data-testid="main-screen"
      sx={{ height: '100vh', overflow: 'hidden', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}
    >
      <TopNav onOpenSettings={onOpenSettings} onOpenCommandPalette={() => openPalette('commands')} onOpenWorkspacePicker={() => openPalette('workspaces')} />
      <Box data-testid="app-shell" sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, overflowY: 'auto' }}>
          {children}
        </Box>
      </Box>
      <StatusBar {...(healthSeverity !== undefined ? { healthSeverity } : {})} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CommandPalette key={paletteKey} open={paletteOpen} intent={paletteIntent} onClose={() => setPaletteOpen(false)} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
