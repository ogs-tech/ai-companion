import { useState } from 'react';
import { Box, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Stack, Tooltip, Typography } from '@mui/material';
import { Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Kicker } from '../ds/Kicker.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useActiveWorkspace, useDeleteWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { WorkspaceRemoveConfirmDialog } from './WorkspaceRemoveConfirmDialog.js';
import { WORKSPACE_SUBS, PLUGINS_SUBS, type Nav, type SubDef } from './nav.js';
import type { Workspace } from '../../../shared/workspace.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface SubRailProps {
  nav: Nav;
  onSelect: (nav: Nav) => void;
}

export const SUBRAIL_WIDTH = 220;

// Pinned above the Skills/Agents/Instructions/… list so it stays legible,
// wherever you navigate, that this list belongs to the active workspace —
// its content already changes per workspace on the backend today.
function WorkspaceContext(): React.ReactElement {
  const { data: active } = useActiveWorkspace();
  const switchWorkspace = useSwitchWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  // Captured at the moment the dialog opens, not read live off `active` —
  // confirming switches the active workspace back to Default as a side
  // effect, and the dialog must keep naming the workspace being removed
  // rather than flipping to "Default" mid-close.
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const handleRemove = async (): Promise<void> => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (!target) return;
    try {
      await switchWorkspace.mutateAsync('default');
      await deleteWorkspace.mutateAsync(target.id);
      setToast({ variant: 'success', message: `${target.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  return (
    <Box sx={(theme) => ({ px: 1, pb: 1.5, mb: 1.5, borderBottom: `1px solid ${theme.palette.divider}` })}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            {active?.name ?? '…'}
            {active?.isDefault && (
              <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                {' '}
                · Global
              </Box>
            )}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={(theme) => ({ display: 'block', fontFamily: theme.ogs.fonts.mono })}
          >
            {active?.rootPath ?? ''}
          </Typography>
        </Box>
        {active && !active.isDefault && (
          <Tooltip title="Remover workspace">
            <IconButton
              data-testid="workspace-context-remove"
              size="small"
              onClick={() => setPendingRemoval(active)}
              sx={{ mt: -0.25 }}
            >
              <Icon glyph={Trash2} size={14} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <WorkspaceRemoveConfirmDialog
        open={pendingRemoval !== null}
        workspaceName={pendingRemoval?.name ?? ''}
        onConfirm={() => void handleRemove()}
        onCancel={() => setPendingRemoval(null)}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}

export function SubRail({ nav, onSelect }: SubRailProps): React.ReactElement | null {
  if (!('sub' in nav)) return null;

  const section = nav.area === 'workspace' ? 'Workspace' : 'Plugins';
  const items: ReadonlyArray<SubDef<string>> = nav.area === 'workspace' ? WORKSPACE_SUBS : PLUGINS_SUBS;
  const activeSub = nav.sub;

  return (
    <Box
      component="nav"
      aria-label={section}
      sx={(theme) => ({
        width: SUBRAIL_WIDTH,
        flexShrink: 0,
        borderRight: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.ogs.surfaces.rail,
        px: 1.5,
        py: 2,
      })}
    >
      {nav.area === 'workspace' && <WorkspaceContext />}
      <Box sx={{ px: 1, mb: 1 }}>
        <Kicker>{section}</Kicker>
      </Box>
      <List dense disablePadding>
        {items.map((item) => {
          const selected = item.sub === activeSub;
          return (
            <ListItemButton
              key={item.sub}
              data-testid={`nav-${item.sub}`}
              selected={selected}
              {...(selected ? { 'aria-current': 'page' as const } : {})}
              onClick={() => onSelect({ area: nav.area, sub: item.sub } as Nav)}
              sx={(theme) => ({
                borderRadius: theme.ogs.radius.sm,
                mb: 0.5,
                borderLeft: selected
                  ? `2px solid ${theme.palette.info.main}`
                  : '2px solid transparent',
                '&.Mui-selected': { bgcolor: 'action.selected' },
              })}
            >
              <ListItemIcon sx={{ minWidth: 30, color: selected ? 'text.primary' : 'text.secondary' }}>
                <Icon glyph={item.glyph} size={16} />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{
                  primary: {
                    variant: 'body2',
                    sx: { fontWeight: selected ? 600 : 400 },
                  },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
