import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Box, Collapse, IconButton, List, TextField, Tooltip, Typography } from '@mui/material';
import { ClipboardCopy, ClipboardPaste, Copy, CopyPlus, Eye, ExternalLink, FileDiff, FilePlus, Folder, File as FileIcon, FolderInput, FolderPlus, FolderRoot, FolderSearch, FolderX, Globe, Minus, Pencil, Plus, Scissors, SquareTerminal, TerminalSquare, Trash2, Undo2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { EmptyState } from '../ds/EmptyState.js';
import { TreeRow } from '../ds/TreeRow.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import { useOpenInBrowser, useRevealPath, type OpenWithTarget } from '../../hooks/use-open-with.js';
import { fileIconFor } from '../../lib/file-icon.js';
import { callIpc } from '../../lib/ipc.js';
import { isMac } from '../../lib/shortcut-labels.js';
import { TREE_DRAG_TYPE, isExternalFileDrag } from '../../lib/tree-drag.js';
import { isInside, parentOf, topLevelOnly, useExplorerActions, type ExplorerActions, type PathChange } from './use-explorer-actions.js';
import { OpenWithMenu } from './OpenWithMenu.js';
import { SessionFileBadge } from './SessionFileBadge.js';
import { useFileMarks } from '../../hooks/use-sessions.js';
import type { FileMark } from '../../lib/session-usage.js';
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

/** The folder containing a root-relative path; `''` for a top-level entry. */
function parentDir(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash === -1 ? '' : relPath.slice(0, slash);
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
  /** Right-click → "Abrir terminal aqui": a shell in that folder (a file's containing folder; `''` is the root). */
  onOpenTerminalHere?: (relDir: string) => void;
  /** Whether a folder (by its root-relative path) is itself a registered workspace's root — gets a small badge. */
  isWorkspaceRoot?: (relPath: string) => boolean;
  /** Multi-folder workspaces: what a top-level folder row shows after its name (branch, changes pill), keyed by the row's alias; `muted` dims a clean one. */
  rootInfo?: Record<string, RootInfo>;
  git?: FolderTreeGit;
  /** Root-relative paths of open file tabs with unsaved changes. */
  dirtyFiles?: ReadonlySet<string>;
  /** A single-folder workspace: the root node shown on top of the tree. Omitted with several folders (their alias nodes are the roots). */
  root?: { label: string; absolutePath: string; meta?: React.ReactNode };
  /** Several folders: a drag between two of them copies, and the folder aliases can't be renamed or trashed. */
  multi?: boolean;
  /** Open tabs follow a renamed or moved path. */
  onRetarget?: (changes: PathChange[]) => void;
  /** Open tabs under these paths were trashed. */
  onRemoved?: (paths: string[]) => void;
  /** Dropping a file on a tree row's "open" is not a thing; the editor area owns that. Receives the controller so the screen can undo from a shortcut. */
  onActions?: (actions: ExplorerActions) => void;
}

export interface RootInfo {
  meta: React.ReactNode;
  muted: boolean;
}

interface DragApi {
  dropTarget: string | null;
  start: (e: React.DragEvent, relPath: string) => void;
  over: (e: React.DragEvent, dir: string) => void;
  drop: (e: React.DragEvent, dir: string) => void;
  end: () => void;
}

const NO_DIRTY_FILES: ReadonlySet<string> = new Set();

interface TreeContextValue {
  actions: ExplorerActions;
  drag: DragApi;
  multi: boolean;
  /** Files sessions are editing / changed this turn, from the sessions store (computed once for the whole tree). */
  sessionMarks: Map<string, FileMark>;
  /** Open file tabs with unsaved changes — an editing mark on one of them is a conflict. */
  dirtyFiles: ReadonlySet<string>;
}

const TreeContext = createContext<TreeContextValue | null>(null);

function useTreeContext(): TreeContextValue {
  const ctx = useContext(TreeContext);
  if (ctx === null) throw new Error('TreeNode rendered outside FolderTree');
  return ctx;
}

/** A blur this soon after the name field first gets focus is not the user leaving it. */
const FOCUS_GRACE_MS = 250;

/** The text field that replaces a row's label while creating or renaming. Enter confirms, Esc cancels; on rename only the base name is pre-selected. */
function InlineNameField({ initial, selectBase, error, onCommit, onCancel }: {
  initial: string;
  selectBase: boolean;
  error: string | null;
  onCommit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const firstFocusAt = useRef<number | null>(null);
  const commit = async (): Promise<void> => {
    if (done.current) return;
    if (value.trim() === '') {
      done.current = true;
      onCancel();
      return;
    }
    done.current = true;
    const ok = await onCommit(value);
    if (!ok) done.current = false;
  };
  return (
    <Box sx={{ flex: 1, minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
      <TextField
        autoFocus
        fullWidth
        size="small"
        variant="standard"
        value={value}
        error={error !== null}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void commit();
          if (e.key === 'Escape') {
            done.current = true;
            onCancel();
          }
        }}
        onBlur={(e) => {
          // A blur right after the field first got focus is the menu / row handing focus around, not the user leaving: take it back.
          if (firstFocusAt.current !== null && performance.now() - firstFocusAt.current < FOCUS_GRACE_MS) {
            const input = e.currentTarget;
            setTimeout(() => input.focus(), 0);
            return;
          }
          void commit();
        }}
        slotProps={{
          htmlInput: {
            'data-testid': 'tree-name-input',
            'aria-label': 'Nome',
            'aria-invalid': error !== null,
            onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
              firstFocusAt.current ??= performance.now();
              const dot = initial.lastIndexOf('.');
              e.currentTarget.setSelectionRange(0, selectBase && dot > 0 ? dot : initial.length);
            },
            sx: { fontSize: '0.8rem', py: 0 },
          },
        }}
      />
      {error !== null && (
        <Typography variant="caption" color="error" role="alert" data-testid="tree-name-error" sx={{ display: 'block' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
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
  /** Top-level folder rows of a multi-folder workspace only. */
  rootInfo?: RootInfo | undefined;
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
  rootInfo,
}: TreeNodeProps): React.ReactElement {
  const { actions, drag, sessionMarks, dirtyFiles } = useTreeContext();
  const [expandedState, setExpanded] = useState(false);
  const isDir = entry.kind === 'dir';
  const change = isDir ? undefined : decorations.byPath.get(relPath);
  const dirty = isDir && decorations.dirtyDirs.has(relPath);
  const { editing } = actions;
  const creatingHere = isDir && editing?.kind === 'create' && editing.parentDir === relPath;
  // Creating inside a closed folder opens it so the field is visible.
  const expanded = expandedState || creatingHere;
  const { data: children, isError: childrenError } = useDirListing(relPath, { enabled: expanded && isDir });
  const renamingHere = editing?.kind === 'rename' && editing.path === relPath;
  const isDropTarget = isDir && drag.dropTarget === relPath;
  const fileIcon = isDir ? undefined : fileIconFor(entry.name);
  const sessionMark = isDir ? undefined : sessionMarks.get(relPath);
  const conflict = sessionMark !== undefined && sessionMark.editing.length > 0 && dirtyFiles.has(relPath);

  // A closed folder opens after ~500 ms of drag hover.
  useEffect(() => {
    if (!isDropTarget || expanded) return undefined;
    const timer = setTimeout(() => setExpanded(true), 500);
    return () => clearTimeout(timer);
  }, [isDropTarget, expanded]);

  const rowClick = (e: React.MouseEvent): void => {
    const visible = Array.from(e.currentTarget.closest('[data-testid="folder-tree"]')?.querySelectorAll<HTMLElement>('[data-relpath]') ?? []).map((el) => el.dataset['relpath'] ?? '');
    if (e.shiftKey) return actions.select(relPath, 'range', visible);
    if (e.metaKey || e.ctrlKey) return actions.select(relPath, 'toggle', visible);
    actions.select(relPath, 'replace', visible);
    if (isDir) setExpanded(!expanded);
    else onSelectFile(relPath);
  };

  return (
    <>
      <TreeRow
        pl={1.5 + depth * 2}
        chevron={isDir ? (expanded ? 'expanded' : 'collapsed') : 'spacer'}
        glyph={isDir ? Folder : (fileIcon?.glyph ?? FileIcon)}
        glyphTone={fileIcon?.tone}
        selected={actions.selection.has(relPath)}
        dropState={isDropTarget ? 'valid' : undefined}
        rowProps={{
          draggable: !renamingHere,
          'data-relpath': relPath,
          'data-kind': entry.kind,
          onDragStart: (e: React.DragEvent) => drag.start(e, relPath),
          onDragOver: (e: React.DragEvent) => drag.over(e, isDir ? relPath : parentOf(relPath)),
          onDrop: (e: React.DragEvent) => drag.drop(e, isDir ? relPath : parentOf(relPath)),
          onDragEnd: drag.end,
        }}
        primary={
          renamingHere ? (
            <InlineNameField initial={entry.name} selectBase={!isDir} error={actions.editError} onCommit={actions.commitEdit} onCancel={actions.cancelEdit} />
          ) : change ? (
            <Box component="span" sx={{ color: change.color }}>{entry.name}</Box>
          ) : (
            entry.name
          )
        }
        onClick={rowClick}
        onContextMenu={(e) => onOpenRowMenu(e, { relPath, kind: entry.kind })}
        {...(rootInfo?.muted ? { muted: true } : {})}
        {...(isDir && (isWorkspaceRoot(relPath) || dirty || rootInfo)
          ? {
              badge: (
                <>
                  {rootInfo?.meta}
                  {isWorkspaceRoot(relPath) && (
                    <Tooltip title="Workspace">
                      <Box component="span" data-testid={`tree-node-workspace-badge-${entry.name}`} sx={{ display: 'inline-flex', color: 'secondary.main' }}>
                        <Icon glyph={FolderRoot} size={12} />
                      </Box>
                    </Tooltip>
                  )}
                  {dirty && !rootInfo && (
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
          const rowActions = rowGitActions(git, relPath, isDir, change, decorations.dirState.get(relPath));
          return rowActions.length > 0
            ? { actions: <RowGitActions actions={rowActions} busy={git?.busy ?? false} testIdBase={relPath} /> }
            : {};
        })()}
        {...(change || sessionMark
          ? {
              badge: (
                <>
                  {sessionMark && <SessionFileBadge mark={sessionMark} conflict={conflict} testId={`session-mark-${relPath}`} />}
                  {change && <GitBadge letters={change.letters} color={change.color} testId={`git-badge-${relPath}`} />}
                </>
              ),
            }
          : {})}
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
              {creatingHere && editing?.kind === 'create' && (
                <CreateRow depth={depth + 1} type={editing.type} actions={actions} />
              )}
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

/** The placeholder row holding the name field while a file or folder is being created. */
function CreateRow({ depth, type, actions }: { depth: number; type: 'file' | 'dir'; actions: ExplorerActions }): React.ReactElement {
  return (
    <TreeRow
      testId="tree-create-row"
      pl={1.5 + depth * 2}
      chevron="spacer"
      glyph={type === 'dir' ? Folder : FileIcon}
      primary={<InlineNameField initial="" selectBase={false} error={actions.editError} onCommit={actions.commitEdit} onCancel={actions.cancelEdit} />}
    />
  );
}

export function FolderTree({
  onSelectFile,
  onOpenAsWorkspace,
  onPreviewFile,
  onNewAction,
  onOpenTerminalHere,
  isWorkspaceRoot = () => false,
  rootInfo,
  git,
  dirtyFiles = NO_DIRTY_FILES,
  root,
  multi = false,
  onRetarget = () => undefined,
  onRemoved = () => undefined,
  onActions,
}: FolderTreeProps): React.ReactElement {
  const sessionMarks = useFileMarks();
  const { data: rootEntries, isError } = useDirListing('');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<RowMenuTarget>();
  const rowMenuTarget = rowMenu.state?.target;
  const [openWithAnchor, setOpenWithAnchor] = useState<HTMLElement | null>(null);
  const [openWithTarget, setOpenWithTarget] = useState<OpenWithTarget | null>(null);
  const [rootExpanded, setRootExpanded] = useState(true);
  const revealPath = useRevealPath();
  const openInBrowser = useOpenInBrowser();
  const resolveAbsolutePath = useResolveAbsolutePath();
  const decorations = git?.decorations ?? EMPTY_GIT_DECORATIONS;
  const actions = useExplorerActions({ onRetarget, onRemoved, multi });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragPaths = useRef<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<{ x: number; y: number } | null>(null);
  const mac = isMac();

  useEffect(() => onActions?.(actions), [onActions, actions]);

  const asOpenWithTarget = (target: RowMenuTarget): OpenWithTarget => ({ relPath: target.relPath, kind: target.kind });

  const closeRowAndSubmenu = (): void => {
    setOpenWithAnchor(null);
    rowMenu.closeMenu();
  };

  // ── drag and drop ────────────────────────────────────────────────────────
  const isCopyGesture = (e: React.DragEvent): boolean => e.altKey || (!mac && e.ctrlKey);
  /** The folder of the dragged paths' own tree is a valid target unless it is one of them or inside one. */
  const isValidTarget = (dir: string): boolean => {
    if (multi && dir === '') return false;
    return dragPaths.current.every((p) => !isInside(dir, p));
  };
  const clearDrag = (): void => {
    dragPaths.current = [];
    setDropTarget(null);
    setCopyHint(null);
  };
  const drag: DragApi = {
    dropTarget,
    start: (e, relPath) => {
      const paths = actions.selection.has(relPath) ? [...actions.selection] : [relPath];
      dragPaths.current = topLevelOnly(paths);
      e.dataTransfer.setData(TREE_DRAG_TYPE, JSON.stringify(dragPaths.current));
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    over: (e, dir) => {
      const external = isExternalFileDrag(e.dataTransfer);
      if (!external && dragPaths.current.length === 0) return;
      e.stopPropagation();
      if (!external && !isValidTarget(dir)) {
        e.dataTransfer.dropEffect = 'none';
        setDropTarget(null);
        return;
      }
      if (external && multi && dir === '') return;
      e.preventDefault();
      const copy = external || isCopyGesture(e);
      e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
      setDropTarget(dir);
      setCopyHint(copy && !external ? { x: e.clientX + 14, y: e.clientY + 14 } : null);
      const scroller = containerRef.current?.parentElement;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (e.clientY < rect.top + 28) scroller.scrollTop -= 14;
        else if (e.clientY > rect.bottom - 28) scroller.scrollTop += 14;
      }
    },
    drop: (e, dir) => {
      e.preventDefault();
      e.stopPropagation();
      const external = isExternalFileDrag(e.dataTransfer);
      const sources = dragPaths.current;
      const copy = external || isCopyGesture(e);
      const files = Array.from(e.dataTransfer.files);
      clearDrag();
      if (external) {
        const paths = files.map((f) => window.api.getPathForFile(f)).filter((p) => p !== '');
        if (paths.length > 0) void actions.importExternal(paths, dir);
        return;
      }
      if (sources.length === 0 || !sources.every((p) => !isInside(dir, p))) return;
      // Dropping where it came from does nothing.
      if (!copy && sources.every((p) => parentOf(p) === dir)) return;
      void actions.transfer({ sources, targetDir: dir, mode: copy ? 'copy' : 'move' });
    },
    end: clearDrag,
  };

  // ── keyboard and clipboard (only while the tree has focus) ───────────────
  const selectedList = [...actions.selection];
  const pasteTarget = (): string | null => {
    const only = selectedList.length === 1 ? selectedList[0] : undefined;
    if (only === undefined) return multi ? null : '';
    const isDirRow = containerRef.current?.querySelector(`[data-relpath="${CSS.escape(only)}"]`)?.getAttribute('data-kind') === 'dir';
    return isDirRow ? only : parentOf(only);
  };
  const inField = (e: React.SyntheticEvent): boolean => (e.target as HTMLElement).tagName === 'INPUT';
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (inField(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'F2' && selectedList.length === 1 && selectedList[0] !== undefined) {
      e.preventDefault();
      actions.startRename(selectedList[0]);
    } else if ((mod && e.key === 'Backspace') || e.key === 'Delete') {
      if (selectedList.length > 0) {
        e.preventDefault();
        void actions.trash(selectedList);
      }
    } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && actions.canUndo()) {
      e.preventDefault();
      void actions.undo();
    } else if (e.key === 'Escape') {
      actions.clearSelection();
    }
  };
  const onCopy = (e: React.ClipboardEvent): void => {
    if (inField(e) || selectedList.length === 0) return;
    e.preventDefault();
    actions.copy(selectedList);
  };
  const onCut = (e: React.ClipboardEvent): void => {
    if (inField(e) || selectedList.length === 0) return;
    e.preventDefault();
    actions.cut(selectedList);
  };
  const onPaste = (e: React.ClipboardEvent): void => {
    if (inField(e)) return;
    const target = pasteTarget();
    if (target === null) return;
    e.preventDefault();
    void actions.paste(target);
  };

  // ── context menu ─────────────────────────────────────────────────────────
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

  const copyAbsolutePath = (relPath: string): void => {
    const write = (abs: string): Promise<void> => navigator.clipboard.writeText(abs);
    (relPath === '' && root ? write(root.absolutePath) : resolveAbsolutePath.mutateAsync(relPath).then(write)).catch(actions.fail);
  };

  const fileOpsFor = (target: RowMenuTarget): RowContextMenuAction[] => {
    const isDirTarget = target.kind === 'dir';
    const isAlias = multi && !target.relPath.includes('/');
    const inSelection = actions.selection.has(target.relPath);
    const subject = inSelection ? selectedList : [target.relPath];
    const dir = isDirTarget ? target.relPath : parentOf(target.relPath);
    return [
      { key: 'new-file', label: 'Novo arquivo', glyph: FilePlus, onSelect: () => actions.startCreate(dir, 'file') },
      { key: 'new-folder', label: 'Nova pasta', glyph: FolderPlus, onSelect: () => actions.startCreate(dir, 'dir') },
      ...(isAlias ? [] : [{ key: 'rename', label: 'Renomear', glyph: Pencil, shortcut: 'F2', separatorBefore: true, onSelect: () => actions.startRename(target.relPath) }]),
      ...(isAlias ? [] : [{ key: 'duplicate', label: 'Duplicar', glyph: CopyPlus, onSelect: () => void actions.duplicate(target.relPath) }]),
      { key: 'copy', label: 'Copiar', glyph: Copy, shortcut: mac ? '⌘C' : 'Ctrl+C', separatorBefore: true, onSelect: () => actions.copy(subject) },
      ...(isAlias ? [] : [{ key: 'cut', label: 'Recortar', glyph: Scissors, shortcut: mac ? '⌘X' : 'Ctrl+X', onSelect: () => actions.cut(subject) }]),
      ...(actions.clipboard
        ? [{ key: 'paste', label: 'Colar', glyph: ClipboardPaste, shortcut: mac ? '⌘V' : 'Ctrl+V', onSelect: () => void actions.paste(dir) }]
        : []),
      { key: 'copy-path', label: 'Copiar caminho', glyph: ClipboardCopy, separatorBefore: true, onSelect: () => copyAbsolutePath(target.relPath) },
    ];
  };

  const trashAction = (target: RowMenuTarget): RowContextMenuAction[] => {
    if (multi && !target.relPath.includes('/')) return [];
    const subject = actions.selection.has(target.relPath) ? selectedList : [target.relPath];
    return [{ key: 'trash', label: 'Mover para a lixeira', glyph: Trash2, shortcut: mac ? '⌘⌫' : 'Del', danger: true, onSelect: () => void actions.trash(subject) }];
  };

  const rootMenuActions = (): RowContextMenuAction[] => [
    { key: 'new-file', label: 'Novo arquivo', glyph: FilePlus, onSelect: () => actions.startCreate('', 'file') },
    { key: 'new-folder', label: 'Nova pasta', glyph: FolderPlus, onSelect: () => actions.startCreate('', 'dir') },
    ...(actions.clipboard ? [{ key: 'paste', label: 'Colar', glyph: ClipboardPaste, shortcut: mac ? '⌘V' : 'Ctrl+V', onSelect: () => void actions.paste('') }] : []),
    { key: 'copy-path', label: 'Copiar caminho', glyph: ClipboardCopy, separatorBefore: true, onSelect: () => copyAbsolutePath('') },
    {
      key: 'reveal',
      label: 'Revelar no Finder',
      glyph: FolderSearch,
      onSelect: () => {
        callIpc('openWith.revealWorkspace', {}).catch(actions.fail);
      },
    },
    ...(onOpenTerminalHere ? [{ key: 'open-terminal-here', label: 'Abrir terminal aqui', glyph: TerminalSquare, onSelect: () => onOpenTerminalHere('') }] : []),
  ];

  const rowMenuActions: RowContextMenuAction[] = rowMenuTarget?.removed
    ? gitActionsFor(rowMenuTarget)
    : rowMenuTarget?.relPath === ''
    ? rootMenuActions()
    : rowMenuTarget
    ? [
        ...gitActionsFor(rowMenuTarget),
        ...fileOpsFor(rowMenuTarget),
        ...(rowMenuTarget.kind === 'file'
          ? [{ key: 'preview', label: 'Preview', glyph: Eye, separatorBefore: true, onSelect: () => onPreviewFile?.(rowMenuTarget.relPath) }]
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
        ...(onOpenTerminalHere
          ? [
              {
                key: 'open-terminal-here',
                label: 'Abrir terminal aqui',
                glyph: TerminalSquare,
                onSelect: () => onOpenTerminalHere(rowMenuTarget.kind === 'dir' ? rowMenuTarget.relPath : parentDir(rowMenuTarget.relPath)),
              },
            ]
          : []),
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
        ...trashAction(rowMenuTarget),
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

  const creatingAtRoot = actions.editing?.kind === 'create' && actions.editing.parentDir === '' && !multi;
  const entries = (depth: number): React.ReactNode =>
    (rootEntries ?? []).map((entry) => (
      <TreeNode
        key={entry.name}
        entry={entry}
        relPath={entry.name}
        depth={depth}
        onSelectFile={onSelectFile}
        onOpenRowMenu={rowMenu.openMenu}
        isWorkspaceRoot={isWorkspaceRoot}
        decorations={decorations}
        git={git}
        rootInfo={rootInfo?.[entry.name]}
      />
    ));

  return (
    <TreeContext.Provider value={{ actions, drag, multi, sessionMarks, dirtyFiles }}>
      <Box
        ref={containerRef}
        tabIndex={0}
        data-testid="folder-tree-focus"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onDragOver={(e) => drag.over(e, '')}
        onDrop={(e) => drag.drop(e, '')}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropTarget(null);
            setCopyHint(null);
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) actions.clearSelection();
        }}
        sx={{ outline: 'none', minHeight: '100%' }}
      >
        <List disablePadding data-testid="folder-tree">
          {root ? (
            <>
              <TreeRow
                testId="tree-root"
                pl={1.5}
                chevron={rootExpanded ? 'expanded' : 'collapsed'}
                glyph={FolderRoot}
                glyphTone="azul"
                dropState={dropTarget === '' ? 'valid' : undefined}
                rowProps={{
                  'data-relpath': '',
                  'data-kind': 'dir',
                  onDragOver: (e: React.DragEvent) => drag.over(e, ''),
                  onDrop: (e: React.DragEvent) => drag.drop(e, ''),
                }}
                primary={<Box component="span" sx={{ fontWeight: 600 }}>{root.label}</Box>}
                badge={root.meta}
                onClick={() => setRootExpanded((v) => !v)}
                onContextMenu={(e) => rowMenu.openMenu(e, { relPath: '', kind: 'dir' })}
              />
              <Collapse in={rootExpanded} unmountOnExit>
                <List disablePadding>
                  {creatingAtRoot && actions.editing?.kind === 'create' && <CreateRow depth={1} type={actions.editing.type} actions={actions} />}
                  {entries(1)}
                </List>
              </Collapse>
            </>
          ) : (
            entries(0)
          )}
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
      </Box>
      {copyHint && (
        <Box
          data-testid="tree-copy-hint"
          sx={(theme) => ({
            position: 'fixed', left: copyHint.x, top: copyHint.y, zIndex: theme.zIndex.tooltip, pointerEvents: 'none',
            px: 0.75, borderRadius: `${theme.ogs.radius.xs}px`, bgcolor: 'secondary.main', color: 'secondary.contrastText', fontSize: '0.7rem', fontWeight: 600,
          })}
        >
          + copiar
        </Box>
      )}
      <RowContextMenu state={rowMenu.state} onClose={closeRowAndSubmenu} actions={rowMenuActions} />
      <OpenWithMenu
        anchorEl={openWithAnchor}
        target={openWithTarget}
        onClose={() => setOpenWithAnchor(null)}
        onDone={closeRowAndSubmenu}
        onError={(message) => setToast({ variant: 'error', message })}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <Toast toast={actions.toast} onDismiss={() => actions.setToast(null)} durationMs={8000} />
    </TreeContext.Provider>
  );
}
