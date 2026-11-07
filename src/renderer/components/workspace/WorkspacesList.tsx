import { useState } from 'react';
import { Box, InputBase, List, Typography } from '@mui/material';
import { Folder, FolderPlus, Search } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { SectionAction, SectionHeader } from '../ds/ContainerChrome.js';
import { TreeRow } from '../ds/TreeRow.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { recentWorkspaces, useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';
import { relativeTime } from '../../lib/relative-time.js';

/** How many recent workspaces the list shows before "Ver todos". */
const RECENT_LIMIT = 8;

interface WorkspacesListProps {
  /** "Ver todos (n)…" — opens the Workspaces page on the canvas. */
  onOpenWorkspaces: () => void;
  limit?: number;
}

/**
 * Início's panel body: the workspaces list, newest first. Searching looks
 * through every workspace; without a query it shows the latest few and
 * "Ver todos" for the rest. The app's destinations (Starter Pack,
 * Marketplaces, Diagnóstico) live only in the rail.
 */
export function WorkspacesList({ onOpenWorkspaces, limit = RECENT_LIMIT }: WorkspacesListProps): React.ReactElement {
  const { data: workspaces } = useWorkspaces();
  const { switchTo, openFolder } = useContextNavigation();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [query, setQuery] = useState('');
  const all = workspaces ?? [];
  const needle = query.trim().toLowerCase();
  const searching = needle !== '';
  const ordered = recentWorkspaces(all, null, all.length);
  const rows = searching ? ordered.filter((w) => w.name.toLowerCase().includes(needle) || w.rootPath.toLowerCase().includes(needle)) : ordered.slice(0, limit);
  const fail = (err: unknown): void => setToast({ variant: 'error', message: err instanceof Error ? err.message : String(err) });

  return (
    <Box data-testid="workspaces-list" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, pt: 0.5 }}>
      <SectionHeader
        title="Workspaces"
        level="view"
        testId="workspaces-header"
        actions={<SectionAction label="Abrir pasta como workspace" testId="workspaces-new" glyph={FolderPlus} onClick={() => void openFolder().catch(fail)} />}
      />
      <Box
        sx={(theme) => ({
          display: 'flex', alignItems: 'center', gap: 0.5, mx: 1.5, mb: 0.75, px: 0.75, flexShrink: 0,
          border: `1px solid ${theme.palette.divider}`, borderRadius: `${theme.ogs.radius.xs}px`,
        })}
      >
        <Icon glyph={Search} size={13} />
        <InputBase
          fullWidth
          placeholder="Buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          inputProps={{ 'aria-label': 'Buscar workspaces', 'data-testid': 'workspaces-search' }}
          sx={{ fontSize: '0.8rem', py: 0.25 }}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <List disablePadding>
          {rows.map((w) => (
            <TreeRow
              key={w.id}
              testId={`workspace-list-row-${w.id}`}
              pl={1.5}
              glyph={Folder}
              primary={w.name}
              onClick={() => switchTo(w.id).catch(fail)}
              badge={
                <>
                  <Typography component="span" data-testid={`workspace-list-time-${w.id}`} sx={{ ml: 'auto', fontSize: '0.7rem', color: 'text.disabled', flexShrink: 0 }}>
                    {relativeTime(w.lastOpenedAt)}
                  </Typography>
                  <SessionStatusBadge anchor={{ kind: 'workspace', workspaceId: w.id }} />
                </>
              }
            />
          ))}
        </List>
        {searching && rows.length === 0 && (
          <Typography variant="caption" color="text.secondary" data-testid="workspaces-empty" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
            Nenhum workspace encontrado
          </Typography>
        )}
        {!searching && all.length > rows.length && (
          <Box
            component="button"
            type="button"
            data-testid="workspaces-see-all"
            onClick={onOpenWorkspaces}
            sx={{ border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: '0.75rem', color: 'text.secondary', textAlign: 'left', px: 1.5, py: 0.75, '&:hover': { color: 'text.primary' } }}
          >
            {`Ver todos (${all.length})…`}
          </Box>
        )}
      </Box>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
