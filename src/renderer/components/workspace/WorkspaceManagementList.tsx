import { useState } from 'react';
import { Box, Button, List, ListItemButton, ListItemText, Stack, Tooltip } from '@mui/material';
import { Folder, FolderPlus, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { callIpc } from '../../lib/ipc.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
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
interface WorkspaceManagementListProps {
  /** Checked before switching into another workspace — returns false to abort (e.g. the caller has unsaved Workbench tabs and the user declined to discard them). Defaults to always-allow. */
  beforeSwitch?: () => boolean;
  /** Pinned row rendered above the workspace list (and its empty state) — the Global workspace's own Personal Instruction row, matching how `FolderTree` pins the current scope's `InstructionTreeRow`. */
  instructionRow?: React.ReactNode;
}

export function WorkspaceManagementList({ beforeSwitch, instructionRow }: WorkspaceManagementListProps = {}): React.ReactElement {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const { data: workspaces } = useWorkspaces();
  const switchWorkspace = useSwitchWorkspace();
  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  const otherWorkspaces = (workspaces ?? []).filter((w) => !w.isDefault);
  // Only commit to the empty-state layout once the list has actually
  // settled — while `workspaces` is still undefined (first paint), this
  // renders the same List+button shape the loaded/non-empty case does, so
  // the "Novo workspace" button never gets swapped out for a fresh DOM node
  // mid-click.
  const showEmptyState = workspaces !== undefined && otherWorkspaces.length === 0;

  const handleSwitch = async (w: Workspace): Promise<void> => {
    if (beforeSwitch && !beforeSwitch()) return;
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

  const newWorkspaceButton = (
    <Button
      variant="outlined"
      size="small"
      startIcon={<Icon glyph={FolderPlus} size={16} />}
      data-testid="workspace-list-new"
      onClick={() => void handleNew()}
    >
      Novo workspace
    </Button>
  );

  return (
    <Box data-testid="workspace-management-list">
      {instructionRow && <List disablePadding>{instructionRow}</List>}
      {showEmptyState ? (
        <Box sx={{ p: 1.5 }}>
          <EmptyState
            glyph={FolderPlus}
            title="Nenhum outro workspace"
            description="Um workspace agrupa as customizations e sessões de um projeto ou pasta específica. Crie um para começar."
            cta={newWorkspaceButton}
            testId="workspace-management-empty"
          />
        </Box>
      ) : (
        <>
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
                    <SessionStatusBadge anchor={{ kind: 'workspace', workspaceId: w.id }} />
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
          <Box sx={{ m: 1.5 }}>{newWorkspaceButton}</Box>
        </>
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
