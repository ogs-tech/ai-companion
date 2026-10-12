import { useState } from 'react';
import { Box, Collapse, List, Tooltip, Typography } from '@mui/material';
import { Eye, ExternalLink, Folder, File as FileIcon, FolderInput, FolderSearch, FolderX, Globe, SquareTerminal } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { TreeRow } from '../ds/TreeRow.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import { useOpenInBrowser, useRevealPath, type OpenWithTarget } from '../../hooks/use-open-with.js';
import { OpenWithMenu } from './OpenWithMenu.js';
import { focusManualTab } from '../../lib/browser-tabs-store.js';
import type { FileBrowserEntry } from '../../../shared/file-browser.js';

interface RowMenuTarget {
  relPath: string;
  kind: 'file' | 'dir';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface FolderTreeProps {
  /** Every path is relative to the open workspace's root. */
  onSelectFile: (relPath: string) => void;
  /** A folder row's "Abrir como workspace" — opens that folder as its own workspace (`workspace.open`). */
  onOpenAsWorkspace: (absolutePath: string) => void;
  /** Right-click on a file row → "Preview" — opens a read-only rendered-Markdown tab instead of the normal editing tab. Never offered for folders (nothing to preview). */
  onPreviewFile?: (relPath: string) => void;
  /** Right-click on a file OR folder row → "New Action" — opens a brand-new session with a draft first message referencing it. */
  onNewAction?: (relPath: string) => void;
  /** Pinned row rendered above the folders/files, e.g. an `InstructionTreeRow` for the current scope. */
  instructionRow?: React.ReactNode;
  /** Pinned nodes rendered below `instructionRow` and above the folders/files, e.g. Skills/Agents/Hooks/MCP `TreeGroup`s for the current scope. */
  pinnedRows?: React.ReactNode;
}

interface TreeNodeProps {
  entry: FileBrowserEntry;
  relPath: string;
  depth: number;
  onSelectFile: (relPath: string) => void;
  onOpenAsWorkspace: (absolutePath: string) => void;
  onOpenRowMenu: (e: React.MouseEvent, target: RowMenuTarget) => void;
  onError: (message: string) => void;
}

function TreeNode({
  entry,
  relPath,
  depth,
  onSelectFile,
  onOpenAsWorkspace,
  onOpenRowMenu,
  onError,
}: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const resolveAbsolutePath = useResolveAbsolutePath();
  const isDir = entry.kind === 'dir';
  const { data: children, isError: childrenError } = useDirListing(relPath, { enabled: expanded && isDir });

  const handleOpenAsWorkspace = async (): Promise<void> => {
    try {
      onOpenAsWorkspace(await resolveAbsolutePath.mutateAsync(relPath));
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  return (
    <>
      <TreeRow
        pl={1.5 + depth * 2}
        chevron={isDir ? (expanded ? 'expanded' : 'collapsed') : 'spacer'}
        glyph={isDir ? Folder : FileIcon}
        primary={entry.name}
        actionsVisibility="always"
        onClick={() => {
          if (isDir) setExpanded((v) => !v);
          else onSelectFile(relPath);
        }}
        onContextMenu={(e) => onOpenRowMenu(e, { relPath, kind: entry.kind })}
        actions={
          isDir ? (
            <Tooltip title="Abrir como workspace">
              <Box
                component="span"
                role="button"
                tabIndex={0}
                aria-label={`Abrir ${entry.name} como workspace`}
                data-testid={`tree-node-open-as-workspace-${entry.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleOpenAsWorkspace();
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  if (e.key === ' ') e.preventDefault();
                  e.stopPropagation();
                  void handleOpenAsWorkspace();
                }}
                sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
              >
                <Icon glyph={FolderInput} size={14} />
              </Box>
            </Tooltip>
          ) : undefined
        }
      />
      {isDir && (
        <Collapse in={expanded} unmountOnExit>
          {childrenError ? (
            <Typography
              variant="caption"
              color="error"
              data-testid={`tree-node-error-${entry.name}`}
              sx={{ display: 'block', pl: 1.5 + (depth + 1) * 2, py: 0.5 }}
            >
              Falha ao carregar
            </Typography>
          ) : (
            <List disablePadding>
              {(children ?? []).map((child) => (
                <TreeNode
                  key={child.name}
                  entry={child}
                  relPath={`${relPath}/${child.name}`}
                  depth={depth + 1}
                  onSelectFile={onSelectFile}
                  onOpenAsWorkspace={onOpenAsWorkspace}
                  onOpenRowMenu={onOpenRowMenu}
                  onError={onError}
                />
              ))}
            </List>
          )}
        </Collapse>
      )}
    </>
  );
}

export function FolderTree({
  onSelectFile,
  onOpenAsWorkspace,
  onPreviewFile,
  onNewAction,
  instructionRow,
  pinnedRows,
}: FolderTreeProps): React.ReactElement {
  const { data: rootEntries, isError } = useDirListing('');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<RowMenuTarget>();
  const rowMenuTarget = rowMenu.state?.target;
  const [openWithAnchor, setOpenWithAnchor] = useState<HTMLElement | null>(null);
  const [openWithTarget, setOpenWithTarget] = useState<OpenWithTarget | null>(null);
  const revealPath = useRevealPath();
  const openInBrowser = useOpenInBrowser();

  const asOpenWithTarget = (target: RowMenuTarget): OpenWithTarget => ({ relPath: target.relPath, kind: target.kind });

  const closeRowAndSubmenu = (): void => {
    setOpenWithAnchor(null);
    rowMenu.closeMenu();
  };

  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget
    ? [
        ...(rowMenuTarget.kind === 'file'
          ? [{ key: 'preview', label: 'Preview', glyph: Eye, onSelect: () => onPreviewFile?.(rowMenuTarget.relPath) }]
          : []),
        {
          key: 'open-with',
          label: 'Abrir com',
          glyph: ExternalLink,
          keepOpen: true,
          hasSubmenu: true,
          onSelect: (anchor) => {
            setOpenWithTarget(asOpenWithTarget(rowMenuTarget));
            setOpenWithAnchor(anchor);
          },
        },
        ...(rowMenuTarget.kind === 'file'
          ? [
              {
                key: 'open-in-browser',
                label: 'Abrir no navegador',
                glyph: Globe,
                onSelect: () => {
                  openInBrowser
                    .mutateAsync(asOpenWithTarget(rowMenuTarget))
                    .then(({ tabId }) => focusManualTab(tabId))
                    .catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
                },
              },
            ]
          : []),
        {
          key: 'reveal',
          label: 'Revelar no Finder',
          glyph: FolderSearch,
          onSelect: () => {
            revealPath
              .mutateAsync(asOpenWithTarget(rowMenuTarget))
              .catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
          },
        },
        { key: 'new-action', label: 'New Action', glyph: SquareTerminal, onSelect: () => onNewAction?.(rowMenuTarget.relPath) },
      ]
    : [];

  if (isError) {
    return (
      <Box data-testid="folder-tree-error" sx={{ p: 2 }}>
        <EmptyState
          glyph={FolderX}
          title="Não foi possível carregar a árvore de arquivos"
          description="Verifique as permissões da pasta e tente novamente."
          testId="folder-tree-error"
        />
      </Box>
    );
  }

  return (
    <>
      <List disablePadding data-testid="folder-tree">
        {instructionRow}
        {pinnedRows}
        {(rootEntries ?? []).map((entry) => (
          <TreeNode
            key={entry.name}
            entry={entry}
            relPath={entry.name}
            depth={0}
            onSelectFile={onSelectFile}
            onOpenAsWorkspace={onOpenAsWorkspace}
            onOpenRowMenu={rowMenu.openMenu}
            onError={(message) => setToast({ variant: 'error', message })}
          />
        ))}
      </List>
      <RowContextMenu state={rowMenu.state} onClose={closeRowAndSubmenu} actions={rowMenuActions} />
      <OpenWithMenu
        anchorEl={openWithAnchor}
        target={openWithTarget}
        onClose={() => setOpenWithAnchor(null)}
        onDone={closeRowAndSubmenu}
        onError={(message) => setToast({ variant: 'error', message })}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
