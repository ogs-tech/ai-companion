import { useState } from 'react';
import { Box, Button, IconButton, List, Stack, Tooltip, Typography } from '@mui/material';
import { Folder, FolderOpen, FolderSearch, Plus, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { TreeRow, treeGroupLabelSx } from '../ds/TreeRow.js';
import { callIpc } from '../../lib/ipc.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { SessionStatusBadge } from '../SessionStatusBadge.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { WorkspaceRemoveConfirmDialog } from '../shell/WorkspaceRemoveConfirmDialog.js';
import { useContextNavigation } from '../../hooks/use-context-navigation.js';
import { useDeleteWorkspace, useWorkspaces } from '../../hooks/use-workspaces.js';
import type { Workspace } from '../../../shared/workspace.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface WorkspaceManagementListProps {
  /** Starter Pack/Marketplaces/Diagnóstico — global app destinations, listed under "App". */
  appAreaRows?: React.ReactNode;
}

function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', minHeight: 26, pl: 1.5, pr: 1, pt: 0.75 }}>
      <Typography component="span" sx={{ ...treeGroupLabelSx, flexGrow: 1 }}>
        {label}
      </Typography>
      {action}
    </Stack>
  );
}

/**
 * Início's left panel: the registered workspaces (click = switch; right-click
 * = Abrir / Revelar no Finder / Remover…) and the app-level destinations.
 * Rows carry no always-visible destructive action — removal sits behind the
 * context menu and a confirm dialog.
 */
export function WorkspaceManagementList({ appAreaRows }: WorkspaceManagementListProps = {}): React.ReactElement {
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

  const openFolderAction = (
    <Tooltip title="Abrir pasta">
      <IconButton
        size="small"
        data-testid="workspace-list-open-folder"
        aria-label="Abrir pasta"
        onClick={() => run(openFolder)}
        sx={{ p: 0.25 }}
      >
        <Icon glyph={Plus} size={14} />
      </IconButton>
    </Tooltip>
  );

  return (
    <Box data-testid="workspace-management-list">
      <SectionHeader label="Workspaces" action={openFolderAction} />
      {showEmptyState ? (
        <Box sx={{ p: 1.5 }}>
          <EmptyState
            glyph={FolderOpen}
            title="Nenhum workspace ainda"
            description="Um workspace é uma pasta: agrupa as customizations e sessões dela. Abra uma para começar."
            cta={
              <Button
                variant="outlined"
                size="small"
                startIcon={<Icon glyph={FolderOpen} size={16} />}
                data-testid="workspace-list-empty-open-folder"
                onClick={() => run(openFolder)}
              >
                Abrir pasta…
              </Button>
            }
            testId="workspace-management-empty"
          />
        </Box>
      ) : (
        <List disablePadding>
          {sorted.map((w) => (
            <Tooltip key={w.id} title={w.rootPath} placement="right">
              <Box>
                <TreeRow
                  testId={`workspace-list-row-${w.id}`}
                  pl={1.5}
                  glyph={Folder}
                  primary={w.name}
                  onClick={() => run(() => switchTo(w.id))}
                  onContextMenu={(e) => rowMenu.openMenu(e, w)}
                  badge={<SessionStatusBadge anchor={{ kind: 'workspace', workspaceId: w.id }} />}
                />
              </Box>
            </Tooltip>
          ))}
        </List>
      )}
      {appAreaRows && (
        <>
          <SectionHeader label="App" />
          <List disablePadding>{appAreaRows}</List>
        </>
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
