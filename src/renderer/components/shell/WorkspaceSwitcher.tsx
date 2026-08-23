import { useState } from 'react';
import { Box, Button, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { callIpc } from '../../lib/ipc.js';
import { Toast, type ToastMessage } from '../Toast.js';
import {
  useActiveWorkspace,
  useCreateWorkspace,
  useDeleteWorkspace,
  useSwitchWorkspace,
  useWorkspaces,
} from '../../hooks/use-workspaces.js';
import type { Workspace } from '../../../shared/workspace.js';

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function WorkspaceSwitcher(): React.ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const { data: workspaces = [] } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const switchWorkspace = useSwitchWorkspace();
  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  const close = (): void => setAnchor(null);

  const handleSwitch = async (w: Workspace): Promise<void> => {
    close();
    try {
      await switchWorkspace.mutateAsync(w.id);
      setToast({ variant: 'success', message: `Workspace alterado para ${w.name}` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleDelete = async (w: Workspace): Promise<void> => {
    close();
    try {
      await deleteWorkspace.mutateAsync(w.id);
      setToast({ variant: 'success', message: `${w.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleNew = async (): Promise<void> => {
    close();
    try {
      const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
      if (picked.canceled || !picked.path) return;
      const name = basename(picked.path);
      await createWorkspace.mutateAsync({ name, rootPath: picked.path });
      setToast({ variant: 'success', message: `${name} criado` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  return (
    <Box>
      <Button
        data-testid="workspace-switcher-trigger"
        onClick={(e) => setAnchor(e.currentTarget)}
        color="inherit"
        size="small"
        endIcon={<Icon glyph={ChevronDown} size={14} />}
      >
        {active?.name ?? '…'}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        {workspaces
          .filter((w) => w.id !== active?.id)
          .map((w) => (
            <MenuItem
              key={w.id}
              data-testid={`workspace-switch-${w.id}`}
              onClick={() => void handleSwitch(w)}
            >
              <ListItemText primary={w.name} secondary={w.rootPath} />
              <Box
                component="span"
                data-testid={`workspace-delete-${w.id}`}
                role="button"
                tabIndex={0}
                aria-label={`Excluir ${w.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(w);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  if (e.key === ' ') e.preventDefault();
                  e.stopPropagation();
                  void handleDelete(w);
                }}
                sx={{ display: 'inline-flex', ml: 1, cursor: 'pointer' }}
              >
                <Icon glyph={Trash2} size={14} />
              </Box>
            </MenuItem>
          ))}
        <MenuItem data-testid="workspace-new" onClick={() => void handleNew()}>
          <Icon glyph={Plus} size={14} />
          <Typography sx={{ ml: 1 }}>Novo workspace</Typography>
        </MenuItem>
      </Menu>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
