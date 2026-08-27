import { useState } from 'react';
import { Box, Button, List, ListItemButton, ListItemText, Stack, Tooltip } from '@mui/material';
import { Folder, FolderPlus, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { callIpc } from '../../lib/ipc.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { useCreateWorkspace, useDeleteWorkspace, useSwitchWorkspace, useWorkspaces } from '../../hooks/use-workspaces.js';
import type { Workspace } from '../../../shared/workspace.js';

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Other project workspaces you can jump into or remove. This only ever
 * renders from the Global overview, so the active workspace is always
 * Default itself — already named by the screen around this list — and is
 * left out here rather than repeated as an unswitchable, undeletable row.
 * Rows are styled identically to a FolderTree folder row (same icon size,
 * same trailing action-icon treatment) so it reads as one tree, not a card.
 */
export function WorkspaceManagementList(): React.ReactElement {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const { data: workspaces = [] } = useWorkspaces();
  const switchWorkspace = useSwitchWorkspace();
  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  const otherWorkspaces = workspaces.filter((w) => !w.isDefault);

  const handleSwitch = async (w: Workspace): Promise<void> => {
    try {
      await switchWorkspace.mutateAsync(w.id);
      setToast({ variant: 'success', message: `Workspace alterado para ${w.name}` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleDelete = async (w: Workspace): Promise<void> => {
    try {
      await deleteWorkspace.mutateAsync(w.id);
      setToast({ variant: 'success', message: `${w.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleNew = async (): Promise<void> => {
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
    <Box data-testid="workspace-management-list">
      <List disablePadding>
        {otherWorkspaces.map((w) => (
          <Tooltip key={w.id} title={w.rootPath} placement="top">
            <ListItemButton
              dense
              data-testid={`workspace-list-row-${w.id}`}
              onClick={() => void handleSwitch(w)}
              sx={{ pl: 1.5 }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
                <Icon glyph={Folder} size={14} />
                <ListItemText
                  primary={w.name}
                  slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }}
                />
              </Stack>
              <Box
                component="span"
                role="button"
                tabIndex={0}
                aria-label={`Remover ${w.name}`}
                data-testid={`workspace-list-delete-${w.id}`}
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
                sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
              >
                <Icon glyph={Trash2} size={14} />
              </Box>
            </ListItemButton>
          </Tooltip>
        ))}
      </List>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Icon glyph={FolderPlus} size={16} />}
        data-testid="workspace-list-new"
        sx={{ m: 1.5 }}
        onClick={() => void handleNew()}
      >
        Novo workspace
      </Button>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
