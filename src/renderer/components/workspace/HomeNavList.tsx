import { useState } from 'react';
import { Box, List } from '@mui/material';
import { Folder, FolderOpen } from 'lucide-react';
import { TreeRow } from '../ds/TreeRow.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { recentWorkspaces, useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';

/** How many recent workspaces the menu lists under "Workspaces". */
const RECENT_LIMIT = 3;

interface HomeNavListProps {
  /** Whether the Workspaces page is the tab on screen — marks its row. */
  workspacesActive: boolean;
  onOpenWorkspaces: () => void;
  /** Starter Pack/Marketplaces/Diagnóstico — global app destinations, below the divider. */
  appAreaRows: React.ReactNode;
}

/**
 * Início's left panel: a flat menu (Início itself is the pinned overview tab, so it has no row). Workspaces opens its own page on the
 * canvas, like Starter Pack/Marketplaces/Diagnóstico; the latest few
 * workspaces sit under it for one-click opening. Managing them (remove,
 * reveal, open a folder) lives on that page.
 */
export function HomeNavList({
  workspacesActive,
  onOpenWorkspaces,
  appAreaRows,
}: HomeNavListProps): React.ReactElement {
  const { data: workspaces } = useWorkspaces();
  const { switchTo } = useContextNavigation();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const recents = recentWorkspaces(workspaces ?? [], null, RECENT_LIMIT);

  return (
    <Box data-testid="home-nav-list" sx={{ pt: 1 }}>
      <List disablePadding>
        <TreeRow
          testId="explorer-area-workspaces"
          pl={1.5}
          glyph={FolderOpen}
          primary="Workspaces"
          onClick={onOpenWorkspaces}
          {...(workspacesActive ? { accentColor: 'info.main' } : {})}
        />
        {/* Recents read one step larger than the group rows so the names stay legible while muted. */}
        <Box sx={{ '& .MuiListItemText-primary': { fontSize: '0.875rem' } }}>
          {recents.map((w) => (
            <TreeRow
              key={w.id}
              testId={`workspace-list-row-${w.id}`}
              pl={5}
              glyph={Folder}
              primary={w.name}
              muted
              onClick={() =>
                switchTo(w.id).catch((err: unknown) =>
                  setToast({
                    variant: 'error',
                    message: err instanceof Error ? err.message : String(err),
                  }),
                )
              }
              badge={<SessionStatusBadge anchor={{ kind: 'workspace', workspaceId: w.id }} />}
            />
          ))}
        </Box>
      </List>
      <Box role="separator" sx={{ height: '1px', bgcolor: 'divider', mx: 1.5, my: 1 }} />
      <List disablePadding>{appAreaRows}</List>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
