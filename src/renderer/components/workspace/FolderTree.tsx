import { useState } from 'react';
import { Box, Collapse, IconButton, List, Tooltip, Typography } from '@mui/material';
import { Eye, ExternalLink, FileDiff, Folder, File as FileIcon, FolderInput, FolderRoot, FolderSearch, FolderX, Globe, Minus, Plus, SquareTerminal, Undo2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { TreeRow } from '../ds/TreeRow.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import { useOpenInBrowser, useRevealPath, type OpenWithTarget } from '../../hooks/use-open-with.js';
import { OpenWithMenu } from './OpenWithMenu.js';
import { focusManualTab } from '../../lib/browser-tabs-store.js';
import { EMPTY_GIT_DECORATIONS, type GitDecoration, type GitDecorations } from './git/git-decorations.js';
import type { FileBrowserEntry } from '../../../shared/file-browser.js';
import type { GitDiffSource, GitFileChange } from '../../../shared/git.js';

interface RowMenuTarget {
  relPath: string;
  kind: 'file' | 'dir';
  /** A file removed from disk (listed under "Removidos"): only the git actions apply. */
  removed?: boolean;
}

/** Git state and actions the tree decorates its rows with; omitted at a workspace without a usable repo. */
export interface FolderTreeGit {
  decorations: GitDecorations;
  busy: boolean;
  onOpenDiff: (args: { path: string; source: GitDiffSource }) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (files: GitFileChange[]) => void;
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
  /** Pinned nodes rendered above the folders/files, e.g. the workspace's Launch Configurations group. */
  pinnedRows?: React.ReactNode;
  /** Whether a folder (by its root-relative path) is itself a registered workspace's root — gets a small badge. */
  isWorkspaceRoot?: (relPath: string) => boolean;
  git?: FolderTreeGit;
}

interface TreeNodeProps {
  entry: FileBrowserEntry;
  relPath: string;
  depth: number;
  onSelectFile: (relPath: string) => void;
  onOpenRowMenu: (e: React.MouseEvent, target: RowMenuTarget) => void;
  isWorkspaceRoot: (relPath: string) => boolean;
  decorations: GitDecorations;
  git: FolderTreeGit | undefined;
}

function GitBadge({ letters, color, testId }: { letters: string; color: string; testId: string }): React.ReactElement {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={(theme) => ({ color, fontFamily: theme.ogs.fonts.mono, fontSize: '0.75rem', fontWeight: 600, ml: 'auto' })}
    >
      {letters}
    </Box>
  );
}

interface RowGitAction {
  key: 'stage' | 'unstage' | 'discard';
  label: string;
  glyph: typeof Plus;
  run: () => void;
}

/** Inline icon buttons on a row; real buttons, so they stay reachable by keyboard (the row reveals them on focus-within). */
function RowGitActions({ actions, busy, testIdBase }: { actions: RowGitAction[]; busy: boolean; testIdBase: string }): React.ReactElement | null {
  if (actions.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', ml: 0.5 }}>
      {actions.map((action) => (
        <Tooltip key={action.key} title={action.label}>
          <span>
            <IconButton
              size="small"
              aria-label={`${action.label}: ${testIdBase}`}
              data-testid={`git-row-${action.key}-${testIdBase}`}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                action.run();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              sx={{ p: 0.25 }}
            >
              <Icon glyph={action.glyph} size={12} />
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Box>
  );
}

function rowGitActions(
  git: FolderTreeGit | undefined,
  relPath: string,
  isDir: boolean,
  change: GitDecoration | undefined,
  dirState: { staged: boolean; unstaged: boolean } | undefined,
): RowGitAction[] {
  if (!git) return [];
  if (isDir) {
    return [
      ...(dirState?.unstaged ? [{ key: 'stage' as const, label: 'Stage pasta', glyph: Plus, run: () => git.onStage([relPath]) }] : []),
      ...(dirState?.staged ? [{ key: 'unstage' as const, label: 'Unstage pasta', glyph: Minus, run: () => git.onUnstage([relPath]) }] : []),
    ];
  }
  if (!change) return [];
  return [
    ...(change.unstaged ? [{ key: 'stage' as const, label: 'Stage', glyph: Plus, run: () => git.onStage([relPath]) }] : []),
    ...(change.staged ? [{ key: 'unstage' as const, label: 'Unstage', glyph: Minus, run: () => git.onUnstage([relPath]) }] : []),
    ...(change.unstaged ? [{ key: 'discard' as const, label: 'Descartar…', glyph: Undo2, run: () => git.onDiscard([change.file]) }] : []),
  ];
}

function TreeNode({
  entry,
  relPath,
  depth,
  onSelectFile,
  onOpenRowMenu,
  isWorkspaceRoot,
  decorations,
  git,
}: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const isDir = entry.kind === 'dir';
  const change = isDir ? undefined : decorations.byPath.get(relPath);
  const dirty = isDir && decorations.dirtyDirs.has(relPath);
  const { data: children, isError: childrenError } = useDirListing(relPath, { enabled: expanded && isDir });

  return (
    <>
      <TreeRow
        pl={1.5 + depth * 2}
        chevron={isDir ? (expanded ? 'expanded' : 'collapsed') : 'spacer'}
        glyph={isDir ? Folder : FileIcon}
        primary={change ? <Box component="span" sx={{ color: change.color }}>{entry.name}</Box> : entry.name}
        onClick={() => {
          if (isDir) setExpanded((v) => !v);
          else onSelectFile(relPath);
        }}
        onContextMenu={(e) => onOpenRowMenu(e, { relPath, kind: entry.kind })}
        {...(isDir && (isWorkspaceRoot(relPath) || dirty)
          ? {
              badge: (
                <>
                  {isWorkspaceRoot(relPath) && (
                    <Tooltip title="Workspace">
                      <Box component="span" data-testid={`tree-node-workspace-badge-${entry.name}`} sx={{ display: 'inline-flex', color: 'secondary.main' }}>
                        <Icon glyph={FolderRoot} size={12} />
                      </Box>
                    </Tooltip>
                  )}
                  {dirty && (
                    <Tooltip title="Contém alterações">
                      <Box
                        component="span"
                        data-testid={`git-dirty-dir-${relPath}`}
                        sx={{ ml: 'auto', width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }}
                      />
                    </Tooltip>
                  )}
                </>
              ),
            }
          : {})}
        {...(() => {
          const actions = rowGitActions(git, relPath, isDir, change, decorations.dirState.get(relPath));
          return actions.length > 0
            ? { actions: <RowGitActions actions={actions} busy={git?.busy ?? false} testIdBase={relPath} /> }
            : {};
        })()}
        {...(change ? { badge: <GitBadge letters={change.letters} color={change.color} testId={`git-badge-${relPath}`} /> } : {})}
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
                  onOpenRowMenu={onOpenRowMenu}
                  isWorkspaceRoot={isWorkspaceRoot}
                  decorations={decorations}
                  git={git}
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
  pinnedRows,
  isWorkspaceRoot = () => false,
  git,
}: FolderTreeProps): React.ReactElement {
  const { data: rootEntries, isError } = useDirListing('');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<RowMenuTarget>();
  const rowMenuTarget = rowMenu.state?.target;
  const [openWithAnchor, setOpenWithAnchor] = useState<HTMLElement | null>(null);
  const [openWithTarget, setOpenWithTarget] = useState<OpenWithTarget | null>(null);
  const revealPath = useRevealPath();
  const openInBrowser = useOpenInBrowser();
  const resolveAbsolutePath = useResolveAbsolutePath();
  const decorations = git?.decorations ?? EMPTY_GIT_DECORATIONS;

  const asOpenWithTarget = (target: RowMenuTarget): OpenWithTarget => ({ relPath: target.relPath, kind: target.kind });

  const closeRowAndSubmenu = (): void => {
    setOpenWithAnchor(null);
    rowMenu.closeMenu();
  };

  const gitActionsFor = (target: RowMenuTarget): RowContextMenuAction[] => {
    const change = git && target.kind === 'file' ? decorations.byPath.get(target.relPath) : undefined;
    if (!git || !change) return [];
    const { path } = change.file;
    const both = change.staged && change.unstaged;
    return [
      ...(change.staged
        ? [{ key: 'git-open-diff-staged', label: both ? 'Abrir diff (staged)' : 'Abrir diff', glyph: FileDiff, onSelect: () => git.onOpenDiff({ path, source: { kind: 'index' } }) }]
        : []),
      ...(change.unstaged
        ? [{ key: 'git-open-diff-worktree', label: both ? 'Abrir diff (alterações)' : 'Abrir diff', glyph: FileDiff, onSelect: () => git.onOpenDiff({ path, source: { kind: 'worktree' } }) }]
        : []),
      ...(change.unstaged ? [{ key: 'git-stage', label: 'Stage', glyph: Plus, onSelect: () => git.onStage([path]) }] : []),
      ...(change.staged ? [{ key: 'git-unstage', label: 'Unstage', glyph: Minus, onSelect: () => git.onUnstage([path]) }] : []),
      ...(change.unstaged ? [{ key: 'git-discard', label: 'Descartar…', glyph: Undo2, onSelect: () => git.onDiscard([change.file]) }] : []),
    ];
  };

  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget?.removed
    ? gitActionsFor(rowMenuTarget)
    : rowMenuTarget
    ? [
        ...gitActionsFor(rowMenuTarget),
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
        ...(rowMenuTarget.kind === 'dir'
          ? [
              {
                key: 'open-as-workspace',
                label: 'Abrir como workspace',
                glyph: FolderInput,
                onSelect: () => {
                  resolveAbsolutePath
                    .mutateAsync(rowMenuTarget.relPath)
                    .then(onOpenAsWorkspace)
                    .catch((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }));
                },
              },
            ]
          : []),
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
        {pinnedRows}
        {(rootEntries ?? []).map((entry) => (
          <TreeNode
            key={entry.name}
            entry={entry}
            relPath={entry.name}
            depth={0}
            onSelectFile={onSelectFile}
            onOpenRowMenu={rowMenu.openMenu}
            isWorkspaceRoot={isWorkspaceRoot}
            decorations={decorations}
            git={git}
          />
        ))}
        {decorations.deleted.length > 0 && (
          <>
            <Typography variant="caption" color="text.secondary" data-testid="git-removed-header" sx={{ display: 'block', px: 1.5, pt: 1, pb: 0.25 }}>
              Removidos
            </Typography>
            {decorations.deleted.map((file) => {
              const change = decorations.byPath.get(file.path);
              return (
                <TreeRow
                  key={file.path}
                  testId={`git-removed-${file.path}`}
                  pl={1.5}
                  chevron="spacer"
                  glyph={FileIcon}
                  muted
                  primary={<Box component="span" sx={{ color: change?.color ?? 'error.main' }}>{file.path}</Box>}
                  badge={<GitBadge letters={change?.letters ?? 'D'} color={change?.color ?? 'error.main'} testId={`git-badge-${file.path}`} />}
                  onClick={() => git?.onOpenDiff({ path: file.path, source: { kind: change?.unstaged === false ? 'index' : 'worktree' } })}
                  onContextMenu={(e) => rowMenu.openMenu(e, { relPath: file.path, kind: 'file', removed: true })}
                />
              );
            })}
          </>
        )}
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
