/**
 * Wire types for the Explorer's file operations, project search and external
 * files (docs/superpowers/specs/2026-11-05-ide-basics-design.md). Every path is
 * workspace-relative with `/` separators — with several folders it starts with
 * the folder alias — except `externalFile.*` and external transfer sources,
 * which are absolute.
 */

export type TransferMode = 'move' | 'copy';

/** What to do with one colliding target; keyed by the target's workspace-relative path. */
export type ConflictResolution = 'replace' | 'keep-both' | 'skip';

export interface TransferConflict {
  /** The source path (workspace-relative, or absolute for an external import). */
  source: string;
  /** The workspace-relative path that already exists. */
  target: string;
  sourceKind: 'file' | 'dir';
  targetKind: 'file' | 'dir';
}

export interface TransferRequest {
  /** Workspace-relative paths, or absolute ones when `external` is true. */
  sources: string[];
  /** Workspace-relative destination folder; `''` is the workspace root (single folder only). */
  targetDir: string;
  mode: TransferMode;
  /** True for files dropped from outside the workspace; sources are absolute and must have been granted. Always copies. */
  external?: boolean;
  /** Answers for the conflicts `workspace.planTransfer` reported. An unanswered conflict is skipped. */
  resolutions?: Record<string, ConflictResolution>;
}

/** One finished item — enough to undo it. */
export interface TransferRecord {
  mode: TransferMode;
  /** Workspace-relative source; absolute when it came from outside. */
  from: string;
  /** Workspace-relative path it now lives at. */
  to: string;
  /** True when it overwrote an existing file (the old one went to the OS trash). */
  replaced: boolean;
}

export interface TransferFailure {
  path: string;
  /** Plain pt-BR message (mapped through `operation-error`). */
  message: string;
}

export interface TransferResult {
  done: TransferRecord[];
  failed: TransferFailure[];
}

export interface UndoTransferResult {
  undone: number;
  failed: TransferFailure[];
}

export interface TrashResult {
  failed: TransferFailure[];
}

/** `workspace.search` */
export interface SearchRequest {
  /** Renderer-chosen id so a newer query can cancel an older one (`workspace.cancelSearch`). */
  requestId: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchMatch {
  /** Workspace-relative path (alias-prefixed with several folders). */
  path: string;
  /** 1-based. */
  line: number;
  /** 0-based column range of the match inside `text`. */
  start: number;
  end: number;
  /** The matching line, trimmed to a sane length. */
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  fileCount: number;
  /** True when the cap (2000 matches) cut the search short. */
  truncated: boolean;
  /** True when a newer query cancelled this one; `matches` is then empty. */
  cancelled: boolean;
}

export const SEARCH_MATCH_CAP = 2000;
export const SEARCH_MAX_FILE_BYTES = 1024 * 1024;
/** Folders skipped by the tree watcher, quick open and project search. */
export const DEFAULT_IGNORED_DIRS = ['node_modules', '.git', 'bin', 'obj'] as const;

/** Push event: the workspace tree changed on disk outside the app's own operations. */
export const WORKSPACE_TREE_CHANGED_CHANNEL = 'workspace:tree-changed';
export interface WorkspaceTreeChangedEvent {
  /** Workspace-relative directories whose listing changed (`''` = root). */
  dirs: string[];
}
