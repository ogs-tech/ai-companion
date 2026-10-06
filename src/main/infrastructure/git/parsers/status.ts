import type { GitBranchHead, GitChange, GitFileChange } from '../../../../shared/git.js';

export interface ParsedStatus {
  head: GitBranchHead;
  files: GitFileChange[];
}

const CHANGE_BY_CODE: Record<string, GitChange> = {
  '.': 'unmodified',
  M: 'modified',
  T: 'typechange',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  // `U` only appears in unmerged records, which also set `conflicted`.
  U: 'modified',
};

function toChange(code: string | undefined): GitChange {
  return (code !== undefined ? CHANGE_BY_CODE[code] : undefined) ?? 'unmodified';
}

/** Splits `line` on single spaces into `count` fields; the last one keeps any remaining spaces (paths). */
function fields(line: string, count: number): string[] {
  const out: string[] = [];
  let rest = line;
  for (let i = 0; i < count - 1; i++) {
    const at = rest.indexOf(' ');
    if (at === -1) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  out.push(rest);
  return out;
}

/**
 * Parses `git status --porcelain=v2 --branch -z`. With `-z` every record —
 * headers included — is NUL-terminated and paths are never quoted; a rename
 * (`2`) record is followed by its original path as a separate NUL field.
 */
export function parseStatus(output: string): ParsedStatus {
  const head: GitBranchHead = { name: null, oid: null, ahead: 0, behind: 0 };
  const files: GitFileChange[] = [];
  const records = output.split('\0');

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === undefined || record.length === 0) continue;

    if (record.startsWith('# ')) {
      const [key, ...rest] = record.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') head.oid = value === '(initial)' ? null : value;
      else if (key === 'branch.head') head.name = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') head.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          head.ahead = Number(match[1]);
          head.behind = Number(match[2]);
        }
      }
      continue;
    }

    const type = record[0];
    if (type === '1') {
      const f = fields(record, 9);
      const xy = f[1] ?? '..';
      files.push({
        path: f[8] ?? '',
        index: toChange(xy[0]),
        worktree: toChange(xy[1]),
        conflicted: false,
      });
    } else if (type === '2') {
      const f = fields(record, 10);
      const xy = f[1] ?? '..';
      const origPath = records[++i] ?? '';
      files.push({
        path: f[9] ?? '',
        origPath,
        index: toChange(xy[0]),
        worktree: toChange(xy[1]),
        conflicted: false,
      });
    } else if (type === 'u') {
      const f = fields(record, 11);
      const xy = f[1] ?? '..';
      files.push({
        path: f[10] ?? '',
        index: toChange(xy[0]),
        worktree: toChange(xy[1]),
        conflicted: true,
      });
    } else if (type === '?') {
      files.push({
        path: record.slice(2),
        index: 'untracked',
        worktree: 'untracked',
        conflicted: false,
      });
    }
    // `!` (ignored) records are not requested and skipped if present.
  }

  return { head, files };
}
