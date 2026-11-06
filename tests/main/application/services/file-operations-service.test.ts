import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBrowserService } from '../../../../src/main/application/services/file-browser-service.js';
import { FileOperationsService } from '../../../../src/main/application/services/file-operations-service.js';
import type { ExternalFileService } from '../../../../src/main/application/services/external-file-service.js';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';
import { NodeFileOperationsAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-operations-adapter.js';
import type { TrashPort } from '../../../../src/main/application/ports/trash-port.js';

let base: string;
let a: string;
let b: string;
const trashed: string[] = [];

const trashPort: TrashPort = {
  trash: async (abs) => {
    await fs.rm(abs, { recursive: true });
    trashed.push(abs);
  },
};

const granted = new Set<string>();
const external = { isGranted: (p: string) => granted.has(p) } as unknown as ExternalFileService;

function build(folders: string[]) {
  const browser = new FileBrowserService(new NodeFileBrowserAdapter(), folders[0]!, folders);
  return new FileOperationsService(browser, new NodeFileOperationsAdapter(), trashPort, external);
}

const write = async (p: string, content = 'x') => {
  await fs.mkdir(join(p, '..'), { recursive: true });
  await fs.writeFile(join(p), content);
};
const exists = (p: string) => fs.stat(p).then(() => true, () => false);

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'fileops-')));
  a = join(base, 'a');
  b = join(base, 'b');
  await fs.mkdir(a);
  await fs.mkdir(b);
  trashed.length = 0;
  granted.clear();
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('create / rename / duplicate', () => {
  it('creates files and folders and rejects existing or invalid names', async () => {
    const svc = build([a]);
    await svc.createFile('n.txt');
    await svc.createDir('sub');
    expect(await exists(join(a, 'n.txt'))).toBe(true);
    await expect(svc.createFile('n.txt')).rejects.toMatchObject({ kind: 'validation' });
    await expect(svc.createDir('sub')).rejects.toMatchObject({ kind: 'validation' });
    await expect(svc.createFile('missing/x.txt')).rejects.toMatchObject({ kind: 'validation' });
    await expect(svc.createFile('..')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('renames and returns the new relative path; rejects bad names and clashes', async () => {
    const svc = build([a]);
    await write(join(a, 'd', 'old.txt'));
    await write(join(a, 'd', 'taken.txt'));
    expect(await svc.rename('d/old.txt', 'new.txt')).toEqual({ path: 'd/new.txt' });
    expect(await exists(join(a, 'd', 'new.txt'))).toBe(true);
    for (const bad of ['', '.', '..', 'x/y']) {
      await expect(svc.rename('d/new.txt', bad)).rejects.toMatchObject({ kind: 'validation' });
    }
    await expect(svc.rename('d/new.txt', 'taken.txt')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('names duplicates "copy", "copy 2" and copies folders recursively', async () => {
    const svc = build([a]);
    await write(join(a, 'doc.md'), 'hi');
    await write(join(a, 'dir', 'inner.txt'), 'in');
    expect(await svc.duplicate('doc.md')).toEqual({ path: 'doc copy.md' });
    expect(await svc.duplicate('doc.md')).toEqual({ path: 'doc copy 2.md' });
    expect(await svc.duplicate('dir')).toEqual({ path: 'dir copy' });
    expect(await fs.readFile(join(a, 'dir copy', 'inner.txt'), 'utf8')).toBe('in');
    expect(await svc.duplicate('doc copy.md')).toEqual({ path: 'doc copy copy.md' });
  });

  it('refuses to touch the workspace root', async () => {
    await expect(build([a]).rename('', 'x')).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('trash', () => {
  it('trashes what it can and reports the failures', async () => {
    const svc = build([a]);
    await write(join(a, 'x.txt'));
    const result = await svc.trash(['x.txt', '../escape', 'nope.txt']);
    expect(trashed).toEqual([join(a, 'x.txt')]);
    expect(result.failed.map((f) => f.path).sort()).toEqual(['../escape', 'nope.txt']);
    expect(result.failed.every((f) => f.message.length > 0)).toBe(true);
  });
});

describe('transfer', () => {
  it('moves a file and records it; undo moves it back', async () => {
    const svc = build([a]);
    await write(join(a, 'f.txt'));
    await fs.mkdir(join(a, 'dest'));
    const result = await svc.transfer({ sources: ['f.txt'], targetDir: 'dest', mode: 'move' });
    expect(result.done).toEqual([{ mode: 'move', from: 'f.txt', to: 'dest/f.txt', replaced: false }]);
    expect(await exists(join(a, 'f.txt'))).toBe(false);
    expect(await svc.undoTransfer(result.done)).toEqual({ undone: 1, failed: [] });
    expect(await exists(join(a, 'f.txt'))).toBe(true);
  });

  it('plans file conflicts and applies replace (old goes to trash), keep-both and skip', async () => {
    const svc = build([a]);
    await write(join(a, 'logo.png'), 'new');
    await write(join(a, 'dest', 'logo.png'), 'old');
    const req = { sources: ['logo.png'], targetDir: 'dest', mode: 'copy' as const };
    expect((await svc.planTransfer(req)).conflicts).toEqual([
      { source: 'logo.png', target: 'dest/logo.png', sourceKind: 'file', targetKind: 'file' },
    ]);

    // unanswered conflict is skipped
    expect((await svc.transfer(req)).done).toEqual([]);

    const both = await svc.transfer({ ...req, resolutions: { 'dest/logo.png': 'keep-both' } });
    expect(both.done[0]!.to).toBe('dest/logo 2.png');
    const both2 = await svc.transfer({ ...req, resolutions: { 'dest/logo.png': 'keep-both' } });
    expect(both2.done[0]!.to).toBe('dest/logo 3.png');

    const replaced = await svc.transfer({ ...req, resolutions: { 'dest/logo.png': 'replace' } });
    expect(replaced.done).toEqual([{ mode: 'copy', from: 'logo.png', to: 'dest/logo.png', replaced: true }]);
    expect(trashed).toEqual([join(a, 'dest', 'logo.png')]);
    expect(await fs.readFile(join(a, 'dest', 'logo.png'), 'utf8')).toBe('new');
  });

  it('merges a dir dropped on a same-named dir and reports conflicts only per file', async () => {
    const svc = build([a]);
    await write(join(a, 'src', 'same.txt'), 'S');
    await write(join(a, 'src', 'only.txt'), 'O');
    await write(join(a, 'to', 'src', 'same.txt'), 'T');
    await fs.mkdir(join(a, 'to'), { recursive: true });
    const req = { sources: ['src'], targetDir: 'to', mode: 'move' as const };
    expect((await svc.planTransfer(req)).conflicts).toEqual([
      { source: 'src/same.txt', target: 'to/src/same.txt', sourceKind: 'file', targetKind: 'file' },
    ]);
    const result = await svc.transfer({ ...req, resolutions: { 'to/src/same.txt': 'skip' } });
    expect(result.done.map((r) => r.to)).toEqual(['to/src/only.txt']);
    expect(await exists(join(a, 'src', 'same.txt'))).toBe(true); // skipped file (and so its folder) stays
    expect(await fs.readFile(join(a, 'to', 'src', 'same.txt'), 'utf8')).toBe('T');
  });

  it('removes the emptied source dir after a full merge move', async () => {
    const svc = build([a]);
    await write(join(a, 'src', 'x.txt'));
    await fs.mkdir(join(a, 'to', 'src'), { recursive: true });
    await svc.transfer({ sources: ['src'], targetDir: 'to', mode: 'move' });
    expect(await exists(join(a, 'src'))).toBe(false);
    expect(await exists(join(a, 'to', 'src', 'x.txt'))).toBe(true);
  });

  it('rejects replace for a file-vs-dir clash but allows keep-both', async () => {
    const svc = build([a]);
    await write(join(a, 'thing'), 'file');
    await write(join(a, 'to', 'thing', 'inner.txt'));
    const req = { sources: ['thing'], targetDir: 'to', mode: 'copy' as const };
    expect((await svc.planTransfer(req)).conflicts[0]).toMatchObject({ sourceKind: 'file', targetKind: 'dir' });
    const replace = await svc.transfer({ ...req, resolutions: { 'to/thing': 'replace' } });
    expect(replace.done).toEqual([]);
    expect(replace.failed).toHaveLength(1);
    expect(trashed).toEqual([]);
    const keep = await svc.transfer({ ...req, resolutions: { 'to/thing': 'keep-both' } });
    expect(keep.done[0]!.to).toBe('to/thing 2');
  });

  it('rejects moving or copying a folder into itself or its subfolder', async () => {
    const svc = build([a]);
    await write(join(a, 'p', 'c', 'x.txt'));
    for (const mode of ['move', 'copy'] as const) {
      for (const targetDir of ['p', 'p/c']) {
        const result = await svc.transfer({ sources: ['p'], targetDir, mode });
        expect(result.done).toEqual([]);
        expect(result.failed[0]!.path).toBe('p');
      }
    }
  });

  it('forces a copy between two workspace folders and prefixes paths with the alias', async () => {
    const svc = build([a, b]);
    await write(join(a, 'f.txt'));
    const result = await svc.transfer({ sources: ['a/f.txt'], targetDir: 'b', mode: 'move' });
    expect(result.done).toEqual([{ mode: 'copy', from: 'a/f.txt', to: 'b/f.txt', replaced: false }]);
    expect(await exists(join(a, 'f.txt'))).toBe(true);
    expect(await svc.undoTransfer(result.done)).toEqual({ undone: 1, failed: [] });
    expect(trashed).toEqual([join(b, 'f.txt')]);
  });

  it('copies external granted sources and refuses ungranted ones', async () => {
    const svc = build([a]);
    const outside = join(base, 'outside.txt');
    await write(outside, 'ext');
    const req = { sources: [outside], targetDir: '', mode: 'move' as const, external: true };
    expect((await svc.transfer(req)).failed).toHaveLength(1);
    granted.add(outside);
    const result = await svc.transfer(req);
    expect(result.done).toEqual([{ mode: 'copy', from: outside, to: 'outside.txt', replaced: false }]);
    expect(await exists(outside)).toBe(true);
  });

  it('fails undo clearly when the state changed', async () => {
    const svc = build([a]);
    await write(join(a, 'f.txt'));
    await fs.mkdir(join(a, 'd'));
    const { done } = await svc.transfer({ sources: ['f.txt'], targetDir: 'd', mode: 'move' });
    await write(join(a, 'f.txt'), 'someone else');
    const undo = await svc.undoTransfer(done);
    expect(undo.undone).toBe(0);
    expect(undo.failed[0]!.message).toContain('f.txt');
    await fs.rm(join(a, 'd', 'f.txt'));
    expect((await svc.undoTransfer(done)).failed[0]!.message).toContain('d/f.txt');
  });
});

describe('listFiles', () => {
  it('lists files, skipping ignored dirs but not hidden ones, with aliases in multi-folder', async () => {
    await write(join(a, 'src', 'x.ts'));
    await write(join(a, '.github', 'ci.yml'));
    await write(join(a, 'node_modules', 'm', 'i.js'));
    await write(join(a, '.git', 'HEAD'));
    expect((await build([a]).listFiles()).sort()).toEqual(['.github/ci.yml', 'src/x.ts']);
    await write(join(b, 'y.ts'));
    expect((await build([a, b]).listFiles()).sort()).toEqual(['a/.github/ci.yml', 'a/src/x.ts', 'b/y.ts']);
  });
});
