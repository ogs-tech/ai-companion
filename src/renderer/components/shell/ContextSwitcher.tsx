import { useState } from 'react';
import { ButtonBase, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { ChevronDown, ChevronRight, Folder, FolderMinus, FolderOpen, FolderPlus, House, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RenameWorkspaceDialog } from './RenameWorkspaceDialog.js';
import { WorkspaceRemoveConfirmDialog } from './WorkspaceRemoveConfirmDialog.js';
import { recentWorkspaces, useContextNavigation } from '../../hooks/use-context-navigation.js';
import {
  useAddWorkspaceFolder,
  useDeleteWorkspace,
  useRemoveWorkspaceFolder,
  useRenameWorkspace,
  useWorkspaces,
} from '../../hooks/use-workspaces.js';
import { callIpc } from '../../lib/ipc.js';
import { basename } from '../../lib/folder-identity.js';
import { confirmDiscardUnsavedTabs } from '../../lib/workspace-tabs-guard.js';
import { workspaceFolders, type Workspace } from '../../../shared/workspace.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The TopNav's "where am I" control: `🏠 Início ▾` or `📁 <name> ▾`. Its menu
 * is the one place to change context — Início, recents, every workspace,
 * open a folder, remove the open workspace. The workspace root path lives
 * only in this button's tooltip.
 */
export function ContextSwitcher(): React.ReactElement {
  const { activeWorkspace, goHome, switchTo, openFolder } = useContextNavigation();
  const { data: workspaces } = useWorkspaces();
  const deleteWorkspace = useDeleteWorkspace();
  const addFolder = useAddWorkspaceFolder();
  const removeFolder = useRemoveWorkspaceFolder();
  const renameWorkspace = useRenameWorkspace();
  // Set right after the first extra folder lands: the old name described one folder.
  const [renaming, setRenaming] = useState<{ workspace: Workspace; reason?: string } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [allAnchor, setAllAnchor] = useState<HTMLElement | null>(null);
  // Captured when the dialog opens, so a context change underneath can't retarget it.
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const isHome = activeWorkspace === null;
  const currentId = activeWorkspace?.id ?? null;
  const recents = recentWorkspaces(workspaces ?? [], currentId);
  const alphabetical = [...(workspaces ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const closeMenus = (): void => {
    setAllAnchor(null);
    setMenuAnchor(null);
  };

  const run = (action: () => Promise<unknown>): void => {
    closeMenus();
    action().catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
  };

  const handleRemove = async (): Promise<void> => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (!target || !confirmDiscardUnsavedTabs()) return;
    try {
      // Deleting the open workspace goes home server-side.
      await deleteWorkspace.mutateAsync(target.id);
      setToast({ variant: 'success', message: `${target.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleAddFolder = async (): Promise<void> => {
    if (!activeWorkspace) return;
    const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
    if (picked.canceled || !picked.path) return;
    const wasSingle = workspaceFolders(activeWorkspace).length === 1;
    const updated = await addFolder.mutateAsync({ id: activeWorkspace.id, path: picked.path });
    if (wasSingle) {
      setRenaming({
        workspace: updated,
        reason: 'Este workspace agora tem mais de uma pasta. O nome atual descrevia só a primeira — quer renomear?',
      });
    }
  };

  const handleRemoveFolder = async (workspace: Workspace, folder: string): Promise<void> => {
    await removeFolder.mutateAsync({ id: workspace.id, path: folder });
    setToast({ variant: 'success', message: `Pasta ${basename(folder)} removida do workspace (nada foi apagado do disco)` });
  };

  const label = isHome ? 'Início' : (activeWorkspace?.name ?? '…');

  return (
    <>
      <Tooltip title={isHome ? 'Global' : (activeWorkspace ? workspaceFolders(activeWorkspace).join('\n') : '')}>
        <ButtonBase
          data-testid="context-switcher"
          aria-haspopup="menu"
          aria-label={`Contexto: ${label}`}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={(theme) => ({
            gap: 0.75,
            px: 1,
            height: 26,
            borderRadius: `${theme.ogs.radius.sm}px`,
            color: 'text.primary',
            maxWidth: 240,
            '&:hover': { bgcolor: 'action.hover' },
          })}
        >
          <Icon glyph={isHome ? House : Folder} size={15} />
          <Typography component="span" noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {label}
          </Typography>
          <Icon glyph={ChevronDown} size={14} />
        </ButtonBase>
      </Tooltip>

      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={closeMenus} data-testid="context-switcher-menu">
        <MenuItem data-testid="context-switcher-home" selected={isHome} onClick={() => run(goHome)}>
          <ListItemIcon><Icon glyph={House} size={16} /></ListItemIcon>
          <ListItemText>Início</ListItemText>
        </MenuItem>
        <Divider />
        {recents.length > 0 && <ListSubheader sx={{ lineHeight: '28px' }}>Recentes</ListSubheader>}
        {recents.map((w) => (
          <MenuItem key={w.id} data-testid={`context-switcher-recent-${w.id}`} onClick={() => run(() => switchTo(w.id))}>
            <ListItemIcon><Icon glyph={Folder} size={16} /></ListItemIcon>
            <ListItemText>{w.name}</ListItemText>
          </MenuItem>
        ))}
        <MenuItem
          data-testid="context-switcher-all"
          disabled={alphabetical.length === 0}
          onClick={(e) => setAllAnchor(e.currentTarget)}
        >
          <ListItemIcon><Icon glyph={Folder} size={16} /></ListItemIcon>
          <ListItemText>Todos os workspaces</ListItemText>
          <Icon glyph={ChevronRight} size={14} />
        </MenuItem>
        <Divider />
        <MenuItem data-testid="context-switcher-open-folder" onClick={() => run(openFolder)}>
          <ListItemIcon><Icon glyph={FolderOpen} size={16} /></ListItemIcon>
          <ListItemText>Criar workspace…</ListItemText>
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 2 }}>⌘O</Typography>
        </MenuItem>
        {activeWorkspace && (
          <MenuItem data-testid="context-switcher-add-folder" onClick={() => run(handleAddFolder)}>
            <ListItemIcon><Icon glyph={FolderPlus} size={16} /></ListItemIcon>
            <ListItemText>Adicionar pasta ao workspace…</ListItemText>
          </MenuItem>
        )}
        {activeWorkspace && workspaceFolders(activeWorkspace).length > 1 &&
          workspaceFolders(activeWorkspace).map((folder) => (
            <MenuItem
              key={folder}
              data-testid={`context-switcher-remove-folder-${basename(folder)}`}
              onClick={() => run(() => handleRemoveFolder(activeWorkspace, folder))}
            >
              <ListItemIcon><Icon glyph={FolderMinus} size={16} /></ListItemIcon>
              <ListItemText>Remover pasta «{basename(folder)}» do workspace</ListItemText>
            </MenuItem>
          ))}
        {activeWorkspace && (
          <MenuItem
            data-testid="context-switcher-remove"
            onClick={() => {
              closeMenus();
              setPendingRemoval(activeWorkspace);
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}><Icon glyph={Trash2} size={16} /></ListItemIcon>
            <ListItemText>Remover este workspace…</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <Menu
        anchorEl={allAnchor}
        open={allAnchor !== null}
        onClose={() => setAllAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        data-testid="context-switcher-all-menu"
      >
        {alphabetical.map((w) => (
          <MenuItem
            key={w.id}
            data-testid={`context-switcher-workspace-${w.id}`}
            selected={w.id === currentId}
            onClick={() => run(() => switchTo(w.id))}
          >
            <ListItemText>{w.name}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      <WorkspaceRemoveConfirmDialog
        open={pendingRemoval !== null}
        workspaceName={pendingRemoval?.name ?? ''}
        onConfirm={() => void handleRemove()}
        onCancel={() => setPendingRemoval(null)}
      />
      <RenameWorkspaceDialog
        open={renaming !== null}
        currentName={renaming?.workspace.name ?? ''}
        {...(renaming?.reason ? { reason: renaming.reason } : {})}
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          const target = renaming?.workspace;
          setRenaming(null);
          if (target) {
            renameWorkspace
              .mutateAsync({ id: target.id, name })
              .catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
          }
        }}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
