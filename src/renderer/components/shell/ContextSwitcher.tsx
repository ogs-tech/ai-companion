import { useState } from 'react';
import { ButtonBase, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import { ChevronDown, Folder, FolderOpen, FolderPlus, House, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { WorkspaceFolderRow } from './WorkspaceFolderRow.js';
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
 * The status bar's "where am I" control: `🏠 Início ▾` or `📁 <name> ▾`. Its
 * menu opens upward and is the one place to change context — Início, the latest recents, "Todos…"
 * (the palette's list), open a folder, remove the open workspace. The workspace root path lives
 * only in this button's tooltip.
 */
interface ContextSwitcherProps {
  /** "Todos…": the full list lives in the command palette, not a submenu. */
  onOpenAllWorkspaces: () => void;
}

export function ContextSwitcher({ onOpenAllWorkspaces }: ContextSwitcherProps): React.ReactElement {
  const { activeWorkspace, goHome, switchTo, openFolder } = useContextNavigation();
  const { data: workspaces } = useWorkspaces();
  const deleteWorkspace = useDeleteWorkspace();
  const addFolder = useAddWorkspaceFolder();
  const removeFolder = useRemoveWorkspaceFolder();
  const renameWorkspace = useRenameWorkspace();
  // Set right after the first extra folder lands: the old name described one folder.
  const [renaming, setRenaming] = useState<{ workspace: Workspace; reason?: string } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // Captured when the dialog opens, so a context change underneath can't retarget it.
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // The folder whose removal was armed by the first click; the second click confirms.
  const [armedFolder, setArmedFolder] = useState<string | null>(null);

  const isHome = activeWorkspace === null;
  const currentId = activeWorkspace?.id ?? null;
  const recents = recentWorkspaces(workspaces ?? [], currentId);

  const closeMenus = (): void => {
    setMenuAnchor(null);
    setArmedFolder(null);
  };

  const run = (action: () => Promise<unknown>): void => {
    closeMenus();
    action().catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
  };

  const handleRemove = async (): Promise<void> => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (!target || !(await confirmDiscardUnsavedTabs())) return;
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
      <Tooltip placement="top" title={isHome ? 'Global' : (activeWorkspace ? workspaceFolders(activeWorkspace).join('\n') : '')}>
        <ButtonBase
          data-testid="context-switcher"
          aria-haspopup="menu"
          aria-label={`Contexto: ${label}`}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{
            gap: 0.5,
            px: 0.75,
            // Sits in the 24px status bar: full bar height is the hit area; the negative margin keeps the label where the old plain text was.
            ml: -0.75,
            height: 24,
            color: 'text.primary',
            maxWidth: 240,
            fontSize: '0.6875rem',
            '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          }}
        >
          <Icon glyph={isHome ? House : Folder} size={12} />
          <Typography component="span" noWrap sx={{ fontSize: 'inherit', fontWeight: 500 }}>
            {label}
          </Typography>
          <Icon glyph={ChevronDown} size={12} />
        </ButtonBase>
      </Tooltip>

      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor !== null}
        onClose={closeMenus}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        data-testid="context-switcher-menu"
      >
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
        {(workspaces?.length ?? 0) > recents.length + (isHome ? 0 : 1) && (
          <MenuItem
            data-testid="context-switcher-all"
            onClick={() => {
              closeMenus();
              onOpenAllWorkspaces();
            }}
          >
            <ListItemIcon><Icon glyph={Folder} size={16} /></ListItemIcon>
            <ListItemText>Todos…</ListItemText>
          </MenuItem>
        )}
        {activeWorkspace && [
          <Divider key="folders-divider" />,
          workspaceFolders(activeWorkspace).length > 1 && (
            <ListSubheader key="folders-header" sx={{ lineHeight: '28px' }}>
              {`Pastas deste workspace (${workspaceFolders(activeWorkspace).length})`}
            </ListSubheader>
          ),
          ...(workspaceFolders(activeWorkspace).length > 1
            ? workspaceFolders(activeWorkspace).map((folder) => (
                <WorkspaceFolderRow
                  key={folder}
                  name={basename(folder)}
                  removable
                  armed={armedFolder === folder}
                  onArm={() => setArmedFolder(folder)}
                  onCancel={() => setArmedFolder((current) => (current === folder ? null : current))}
                  onConfirm={() => run(() => handleRemoveFolder(activeWorkspace, folder))}
                />
              ))
            : []),
          <MenuItem key="add-folder" data-testid="context-switcher-add-folder" onClick={() => run(handleAddFolder)}>
            <ListItemIcon><Icon glyph={FolderPlus} size={16} /></ListItemIcon>
            <ListItemText>{workspaceFolders(activeWorkspace).length > 1 ? 'Adicionar pasta…' : 'Adicionar pasta ao workspace…'}</ListItemText>
          </MenuItem>,
        ]}
        <Divider />
        <MenuItem data-testid="context-switcher-open-folder" onClick={() => run(openFolder)}>
          <ListItemIcon><Icon glyph={FolderOpen} size={16} /></ListItemIcon>
          <ListItemText>Criar workspace…</ListItemText>
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 2 }}>⌘O</Typography>
        </MenuItem>
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
