import { describe, expect, it } from 'vitest';
import {
  addedFileDiff,
  DIFF_MAX_BYTES,
  parseFileDiff,
} from '../../../../../src/main/infrastructure/git/parsers/diff.js';

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  'index 111..222 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,3 +1,3 @@ function x() {',
  ' keep',
  '-old',
  '+new',
  ' tail',
  '@@ -10 +10,2 @@',
  ' ten',
  '+eleven',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('parseFileDiff', () => {
  it('parses hunks with line numbers per side', () => {
    const diff = parseFileDiff(DIFF, 'a.ts');
    expect(diff.kind).toBe('text');
    if (diff.kind !== 'text') return;
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 });
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: 'context', text: 'keep', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'old', oldNo: 2 },
      { kind: 'add', text: 'new', newNo: 2 },
      { kind: 'context', text: 'tail', oldNo: 3, newNo: 3 },
    ]);
  });

  it('defaults an omitted hunk count to 1 and skips the no-newline marker', () => {
    const diff = parseFileDiff(DIFF, 'a.ts');
    if (diff.kind !== 'text') throw new Error('expected text');
    expect(diff.hunks[1]).toMatchObject({ oldStart: 10, oldLines: 1, newStart: 10, newLines: 2 });
    expect(diff.hunks[1]?.lines.map((l) => l.kind)).toEqual(['context', 'add']);
  });

  it('reports binary files', () => {
    const out =
      'diff --git a/i.png b/i.png\nindex 1..2 100644\nBinary files a/i.png and b/i.png differ\n';
    expect(parseFileDiff(out, 'i.png')).toEqual({ kind: 'binary', path: 'i.png' });
  });

  it('yields no hunks for a mode-only change or empty output', () => {
    const modeOnly = 'diff --git a/s.sh b/s.sh\nold mode 100644\nnew mode 100755\n';
    expect(parseFileDiff(modeOnly, 's.sh')).toEqual({ kind: 'text', path: 's.sh', hunks: [] });
    expect(parseFileDiff('', 's.sh')).toEqual({ kind: 'text', path: 's.sh', hunks: [] });
  });

  it('records the old path of a rename', () => {
    const out =
      'diff --git a/o.ts b/n.ts\nsimilarity index 100%\nrename from o.ts\nrename to n.ts\n';
    expect(parseFileDiff(out, 'n.ts')).toEqual({
      kind: 'text',
      path: 'n.ts',
      oldPath: 'o.ts',
      hunks: [],
    });
  });

  it('reports too-large output instead of parsing it', () => {
    const huge = 'x'.repeat(DIFF_MAX_BYTES + 1);
    expect(parseFileDiff(huge, 'big.txt')).toEqual({
      kind: 'too-large',
      path: 'big.txt',
      bytes: DIFF_MAX_BYTES + 1,
    });
  });
});

describe('addedFileDiff', () => {
  it('renders an untracked file as all-added lines', () => {
    const diff = addedFileDiff(Buffer.from('one\ntwo\n'), 'n.txt');
    if (diff.kind !== 'text') throw new Error('expected text');
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: 'add', text: 'one', newNo: 1 },
      { kind: 'add', text: 'two', newNo: 2 },
    ]);
  });

  it('treats a NUL byte as binary and an empty file as no hunks', () => {
    expect(addedFileDiff(Buffer.from([1, 0, 2]), 'b')).toEqual({ kind: 'binary', path: 'b' });
    expect(addedFileDiff(Buffer.alloc(0), 'e')).toEqual({ kind: 'text', path: 'e', hunks: [] });
  });
});
