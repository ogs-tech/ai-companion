import type { GitChange, GitFileChange } from '../../../../shared/git.js';

export interface ChangeGroups {
  /** Files with an index-side change, opened as the HEAD → index diff. */
  staged: GitFileChange[];
  /** Files with a worktree-side change (untracked included) or a conflict, opened as the index → worktree diff. */
  changes: GitFileChange[];
}

/**
 * Splits status into the two groups. A file with both staged and unstaged
 * edits appears in both. Conflicted files only appear under "changes" —
 * their index columns describe the merge stages, not something the user staged.
 */
export function groupChanges(files: GitFileChange[]): ChangeGroups {
  return {
    staged: files.filter((f) => !f.conflicted && f.index !== 'unmodified' && f.index !== 'untracked'),
    changes: files.filter((f) => f.conflicted || f.worktree !== 'unmodified'),
  };
}

export const LETTER: Record<GitChange, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  unmodified: '',
};

export const COLOR: Partial<Record<GitChange, string>> = {
  modified: 'warning.main',
  added: 'success.main',
  untracked: 'success.main',
  deleted: 'error.main',
  renamed: 'info.main',
  copied: 'info.main',
};

export interface GitDecoration {
  /** One letter per side that changed, joined with `·` when both do (e.g. `M·M`); `!` for a conflict. */
  letters: string;
  /** Theme palette path for the row's badge and text. */
  color: string;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  file: GitFileChange;
}

export interface GitDecorations {
  byPath: Map<string, GitDecoration>;
  /** Every ancestor directory of every changed path (root-relative, no trailing slash). */
  dirtyDirs: Set<string>;
  /** What a folder's descendants offer: any staged side to unstage, any unstaged side to stage. */
  dirState: Map<string, { staged: boolean; unstaged: boolean }>;
  /** Files deleted in the worktree or index — absent from the directory listing. */
  deleted: GitFileChange[];
}

export const EMPTY_GIT_DECORATIONS: GitDecorations = {
  byPath: new Map(),
  dirtyDirs: new Set(),
  dirState: new Map(),
  deleted: [],
};

function decorate(file: GitFileChange): GitDecoration {
  const { staged, changes } = groupChanges([file]);
  const isStaged = staged.length > 0;
  const isUnstaged = changes.length > 0;
  if (file.conflicted) {
    return { letters: '!', color: 'error.main', staged: false, unstaged: true, conflicted: true, file };
  }
  const indexLetter = isStaged ? LETTER[file.index] : '';
  const worktreeLetter = isUnstaged ? LETTER[file.worktree] : '';
  const letters = [indexLetter, worktreeLetter].filter((l) => l !== '').join('·');
  const dominant = isUnstaged ? file.worktree : file.index;
  return {
    letters,
    color: COLOR[dominant] ?? 'text.secondary',
    staged: isStaged,
    unstaged: isUnstaged,
    conflicted: false,
    file,
  };
}

/** Pure projection of `git.status` files into what the file tree needs to decorate its rows. */
export function buildGitDecorations(files: GitFileChange[]): GitDecorations {
  const byPath = new Map<string, GitDecoration>();
  const dirtyDirs = new Set<string>();
  const dirState = new Map<string, { staged: boolean; unstaged: boolean }>();
  const deleted: GitFileChange[] = [];

  for (const file of files) {
    const decoration = decorate(file);
    byPath.set(file.path, decoration);
    const segments = file.path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const dir = segments.slice(0, i).join('/');
      dirtyDirs.add(dir);
      const state = dirState.get(dir) ?? { staged: false, unstaged: false };
      dirState.set(dir, {
        staged: state.staged || decoration.staged,
        unstaged: state.unstaged || decoration.unstaged,
      });
    }
    if (file.worktree === 'deleted' || (file.index === 'deleted' && file.worktree === 'unmodified')) deleted.push(file);
  }
  return { byPath, dirtyDirs, dirState, deleted };
}
