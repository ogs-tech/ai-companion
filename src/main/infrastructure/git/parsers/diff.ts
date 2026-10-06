import type { GitDiffLine, GitFileDiff, GitHunk } from '../../../../shared/git.js';

/** Diffs beyond either limit are reported as `too-large` instead of parsed. */
export const DIFF_MAX_BYTES = 1_000_000;
export const DIFF_MAX_LINES = 20_000;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses the output of `git diff --no-color --no-ext-diff -U3 -- <path>` for a
 * single file. Empty output (no change, or a mode-only change) yields a text
 * diff with no hunks. `path` is the caller's path — header paths may be quoted
 * and are not trusted.
 */
export function parseFileDiff(output: string, path: string): GitFileDiff {
  const bytes = Buffer.byteLength(output, 'utf8');
  const lines = output.split('\n');
  if (bytes > DIFF_MAX_BYTES || lines.length > DIFF_MAX_LINES) {
    return { kind: 'too-large', path, bytes };
  }

  let oldPath: string | undefined;
  const hunks: GitHunk[] = [];
  let hunk: GitHunk | undefined;
  let oldNo = 0;
  let newNo = 0;

  for (const line of lines) {
    if (hunk === undefined) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch')
        return { kind: 'binary', path };
      if (line.startsWith('rename from ')) oldPath = line.slice('rename from '.length);
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      hunk = {
        header: line,
        oldStart: oldNo,
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newNo,
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(hunk);
      continue;
    }
    if (hunk === undefined) continue;

    const marker = line[0];
    let parsed: GitDiffLine | undefined;
    if (marker === ' ')
      parsed = { kind: 'context', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ };
    else if (marker === '+') parsed = { kind: 'add', text: line.slice(1), newNo: newNo++ };
    else if (marker === '-') parsed = { kind: 'del', text: line.slice(1), oldNo: oldNo++ };
    // `\ No newline at end of file` and the trailing empty split element carry no line.
    if (parsed) hunk.lines.push(parsed);
  }

  return { kind: 'text', path, ...(oldPath !== undefined ? { oldPath } : {}), hunks };
}

/** Builds an all-added diff for an untracked file's content (the `/dev/null → file` view). */
export function addedFileDiff(content: Buffer, path: string): GitFileDiff {
  if (content.byteLength > DIFF_MAX_BYTES)
    return { kind: 'too-large', path, bytes: content.byteLength };
  // Same heuristic git uses: a NUL in the first 8000 bytes means binary.
  if (content.subarray(0, 8000).includes(0)) return { kind: 'binary', path };

  const text = content.toString('utf8');
  if (text.length === 0) return { kind: 'text', path, hunks: [] };

  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const rows = body.split('\n');
  if (rows.length > DIFF_MAX_LINES) return { kind: 'too-large', path, bytes: content.byteLength };

  return {
    kind: 'text',
    path,
    hunks: [
      {
        header: `@@ -0,0 +1,${rows.length} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: rows.length,
        lines: rows.map((t, i) => ({ kind: 'add', text: t, newNo: i + 1 })),
      },
    ],
  };
}
