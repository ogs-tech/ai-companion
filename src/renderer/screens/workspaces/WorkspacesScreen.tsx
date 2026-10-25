import { useState } from 'react';
import { Box, Button, List, Stack, Tooltip, Typography } from '@mui/material';
import { Folder, FolderOpen, FolderSearch, Plus, Trash2 } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { EmptyState } from '../../components/ds/EmptyState.js';
import { TreeRow } from '../../components/ds/TreeRow.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { SessionStatusBadge } from '../../components/SessionStatusBadge.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from '../../components/workspace/RowContextMenu.js';
import { WorkspaceRemoveConfirmDialog } from '../../components/shell/WorkspaceRemoveConfirmDialog.js';
import { useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useDeleteWorkspace, useWorkspaces } from '../../hooks/use-workspaces.js';
import { callIpc } from '../../lib/ipc.js';
import { formatWhen } from '../../lib/format-session-history.js';
import type { Workspace } from '../../../shared/workspace.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The "Workspaces" page on Início's canvas: every registered workspace (click =
 * switch; right-click = Abrir / Revelar no Finder / Remover…) and the "Abrir
 * pasta" entry point. Rows carry no always-visible destructive action —
 * removal sits behind the context menu and a confirm dialog.
 */
export function WorkspacesScreen(): React.ReactElement {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const { data: workspaces } = useWorkspaces();
  const { switchTo, openFolder } = useContextNavigation();
  const deleteWorkspace = useDeleteWorkspace();
  const rowMenu = useRowContextMenu<Workspace>();
  const rowMenuTarget = rowMenu.state?.target;
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null);

  const sorted = [...(workspaces ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  // Only commit to the empty state once the list has settled, so first paint
  // never flashes it.
  const showEmptyState = workspaces !== undefined && sorted.length === 0;

  const run = (action: () => Promise<unknown>): void => {
    action().catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
  };

  const handleRemove = async (): Promise<void> => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (!target) return;
    try {
      await deleteWorkspace.mutateAsync(target.id);
      setToast({ variant: 'success', message: `${target.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget
    ? [
        { key: 'open', label: 'Abrir', glyph: FolderOpen, onSelect: () => run(() => switchTo(rowMenuTarget.id)) },
        {
          key: 'reveal',
          label: 'Revelar no Finder',
          glyph: FolderSearch,
          onSelect: () => run(() => callIpc('openWith.revealWorkspace', { id: rowMenuTarget.id })),
        },
        { key: 'remove', label: 'Remover…', glyph: Trash2, onSelect: () => setPendingRemoval(rowMenuTarget) },
      ]
    : [];

  return (
    <Box data-testid="workspaces-screen" sx={{ p: 2.5, overflowY: 'auto', height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" component="h1">
            Workspaces
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Pastas que você abriu no AI Companion.
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<Icon glyph={Plus} size={14} />}
          data-testid="workspaces-open-folder"
          onClick={() => run(openFolder)}
        >
          Abrir pasta
        </Button>
      </Stack>
      {showEmptyState ? (
        <EmptyState
          glyph={FolderOpen}
          title="Nenhum workspace ainda"
          description="Um workspace é uma pasta: agrupa as customizations e sessões dela. Abra uma para começar."
          testId="workspaces-empty"
        />
      ) : (
        <List disablePadding>
          {sorted.map((w) => (
            <Tooltip key={w.id} title={w.rootPath} placement="bottom-start">
              <Box sx={{ mb: 0.5 }}>
                <TreeRow
                  testId={`workspace-list-row-${w.id}`}
                  pl={1.5}
                  glyph={Folder}
                  primary={w.name}
                  onClick={() => run(() => switchTo(w.id))}
                  onContextMenu={(e) => rowMenu.openMenu(e, w)}
                  badge={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <SessionStatusBadge anchor={{ kind: 'workspace', workspaceId: w.id }} />
                      {w.lastOpenedAt && (
                        <Typography component="span" variant="caption" color="text.secondary">
                          {formatWhen(w.lastOpenedAt)}
                        </Typography>
                      )}
                    </Stack>
                  }
                />
              </Box>
            </Tooltip>
          ))}
        </List>
      )}
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
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
