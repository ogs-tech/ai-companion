import { useEffect, useState, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { TopNav } from './TopNav.js';
import { SubRail } from './SubRail.js';
import { AppFooter } from './AppFooter.js';
import { CommandPalette } from './CommandPalette.js';
import { defaultSubFor, type Area, type WorkspaceSub, type Nav } from './nav.js';
import { useActiveWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';

interface AppShellProps {
  nav: Nav;
  onNavigate: (nav: Nav) => void;
  onOpenSettings: () => void;
  healthSeverity?: 'ok' | 'warning' | 'error';
  children: ReactNode;
}

export function AppShell({
  nav,
  onNavigate,
  onOpenSettings,
  healthSeverity,
  children,
}: AppShellProps): React.ReactElement {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: activeWorkspace } = useActiveWorkspace();
  const switchWorkspace = useSwitchWorkspace();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The "Início" tab (area: 'workspace') doubles as a "go home" gesture:
  // leaving a project workspace's own screens always lands back on the
  // Global workspace, whose Visão Geral is now the single place to
  // switch/create/remove workspaces.
  const selectArea = (area: Area): void => {
    if (area === 'workspace' && activeWorkspace && !activeWorkspace.isDefault) {
      void switchWorkspace.mutateAsync('default');
    }
    onNavigate(defaultSubFor(area));
  };
  const createEntity = (sub: WorkspaceSub): void => onNavigate({ area: 'workspace', sub });

  return (
    <Box
      data-testid="main-screen"
      sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}
    >
      <TopNav
        active={nav.area}
        onSelectArea={selectArea}
        onOpenSettings={onOpenSettings}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        {...(healthSeverity !== undefined ? { healthSeverity } : {})}
      />
      <Box data-testid="app-shell" sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <SubRail nav={nav} onSelect={onNavigate} />
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, overflowY: 'auto' }}>
          {children}
        </Box>
      </Box>
      <AppFooter />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(n) => onNavigate(n)}
        onCreate={createEntity}
      />
    </Box>
  );
}
