import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBrowserService } from '../../../../src/main/application/services/file-browser-service.js';
import { ProjectSearchService } from '../../../../src/main/application/services/project-search-service.js';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';
import { NodeFileOperationsAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-operations-adapter.js';
import { SEARCH_MATCH_CAP, SEARCH_MAX_FILE_BYTES, type SearchRequest } from '../../../../src/shared/file-ops.js';

let root: string;
const make = (folders: string[] = [root]) =>
  new ProjectSearchService(new FileBrowserService(new NodeFileBrowserAdapter(), folders[0]!, folders), new NodeFileOperationsAdapter());
const req = (query: string, extra: Partial<SearchRequest> = {}): SearchRequest => ({
  requestId: 'r1',
  query,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...extra,
});
const write = async (rel: string, content: string | Buffer) => {
  await fs.mkdir(join(root, rel, '..'), { recursive: true });
  await fs.writeFile(join(root, rel), content);
};

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'search-')));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('ProjectSearchService', () => {
  it('finds literal matches with line and column; escapes regex chars unless regex', async () => {
    await write('a.ts', 'one\n  foo.bar(1)\nFOO.bar');
    const result = await make().search(req('foo.bar'));
    expect(result.matches).toEqual([
      { path: 'a.ts', line: 2, start: 0, end: 7, text: 'foo.bar(1)' },
      { path: 'a.ts', line: 3, start: 0, end: 7, text: 'FOO.bar' },
    ]);
    expect(result.fileCount).toBe(1);
    expect((await make().search(req('fo.\\.bar', { regex: true }))).matches).toHaveLength(2);
    expect((await make().search(req('fo.bar'))).matches).toHaveLength(0);
  });

  it('honours case and whole-word flags', async () => {
    await write('a.txt', 'cat concat Cat');
    expect((await make().search(req('cat', { caseSensitive: true }))).matches).toHaveLength(2);
    expect((await make().search(req('cat', { wholeWord: true }))).matches.map((m) => m.start)).toEqual([0, 11]);
  });

  it('rejects an invalid regex with a pt-BR validation error', async () => {
    await expect(make().search(req('(', { regex: true }))).rejects.toMatchObject({ kind: 'validation', message: expect.stringContaining('Expressão regular inválida') });
  });

  it('skips binary, oversized and ignored files', async () => {
    await write('bin.dat', Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]));
    await write('big.txt', `needle${'x'.repeat(SEARCH_MAX_FILE_BYTES)}`);
    await write('node_modules/p/i.js', 'needle');
    await write('.git/config', 'needle');
    await write('ok/.hidden/n.txt', 'needle');
    const result = await make().search(req('needle'));
    expect(result.matches.map((m) => m.path)).toEqual(['ok/.hidden/n.txt']);
  });

  it('stops at the cap and flags truncated', async () => {
    await write('many.txt', 'x\n'.repeat(SEARCH_MATCH_CAP + 50));
    const result = await make().search(req('x'));
    expect(result.matches).toHaveLength(SEARCH_MATCH_CAP);
    expect(result.truncated).toBe(true);
  });

  it('trims long lines around the match and adjusts the columns', async () => {
    await write('long.txt', `${'a'.repeat(500)}TARGET${'b'.repeat(500)}`);
    const [match] = (await make().search(req('TARGET'))).matches;
    expect(match!.text.length).toBeLessThanOrEqual(300);
    expect(match!.text.slice(match!.start, match!.end)).toBe('TARGET');
  });

  it('prefixes aliases with several folders', async () => {
    const other = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'search2-')));
    try {
      await write('a.txt', 'hit');
      await fs.writeFile(join(other, 'b.txt'), 'hit');
      const paths = (await make([root, other]).search(req('hit'))).matches.map((m) => m.path);
      expect(paths).toHaveLength(2);
      expect(paths.every((p) => /^[^/]+\/[ab]\.txt$/.test(p))).toBe(true);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('a newer request cancels the older one', async () => {
    for (let i = 0; i < 60; i++) await write(`f${i}.txt`, 'hit');
    const service = make();
    const first = service.search(req('hit', { requestId: 'old' }));
    const second = service.search(req('hit', { requestId: 'new' }));
    expect(await first).toEqual({ matches: [], fileCount: 0, truncated: false, cancelled: true });
    expect((await second).cancelled).toBe(false);
  });

  it('cancelSearch cancels by id', async () => {
    for (let i = 0; i < 60; i++) await write(`f${i}.txt`, 'hit');
    const service = make();
    const pending = service.search(req('hit', { requestId: 'x' }));
    service.cancel('x');
    expect((await pending).cancelled).toBe(true);
  });
});
