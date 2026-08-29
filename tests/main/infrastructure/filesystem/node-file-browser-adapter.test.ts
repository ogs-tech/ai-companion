import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';

let dir: string;
const adapter = new NodeFileBrowserAdapter();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'file-browser-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('NodeFileBrowserAdapter.listDir', () => {
  it('lists directories before files, both alphabetically, skipping dotfiles', async () => {
    await mkdir(join(dir, 'zeta'));
    await mkdir(join(dir, 'alpha'));
    await writeFile(join(dir, 'b.txt'), 'b');
    await writeFile(join(dir, 'a.txt'), 'a');
    await writeFile(join(dir, '.hidden'), 'x');
    const entries = await adapter.listDir(dir);
    expect(entries.map((e) => e.name)).toEqual(['alpha', 'zeta', 'a.txt', 'b.txt']);
    expect(entries.find((e) => e.name === 'a.txt')?.kind).toBe('file');
    expect(entries.find((e) => e.name === 'alpha')?.kind).toBe('dir');
  });

  it('includes size for files', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const entries = await adapter.listDir(dir);
    expect(entries[0]).toMatchObject({ name: 'a.txt', kind: 'file', size: 5 });
  });

  it('throws not_found for a missing directory', async () => {
    await expect(adapter.listDir(join(dir, 'nope'))).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('NodeFileBrowserAdapter.readFile', () => {
  it('returns previewable content for a small text file', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello world');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({ previewable: true, content: 'hello world', truncated: false });
  });

  it('throws not_found for a missing file', async () => {
    await expect(adapter.readFile(join(dir, 'nope.txt'))).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('treats a file containing a NUL byte as not previewable', async () => {
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    const preview = await adapter.readFile(join(dir, 'bin.dat'));
    expect(preview.previewable).toBe(false);
  });

  it('treats a file over 5MB as not previewable without reading its content', async () => {
    await writeFile(join(dir, 'big.txt'), Buffer.alloc(6 * 1024 * 1024, 'a'));
    const preview = await adapter.readFile(join(dir, 'big.txt'));
    expect(preview).toEqual({ previewable: false, reason: expect.stringContaining('large') });
  });

  it('truncates a previewable file larger than 256KB, marking truncated:true', async () => {
    const content = 'x'.repeat(300 * 1024);
    await writeFile(join(dir, 'medium.txt'), content);
    const preview = await adapter.readFile(join(dir, 'medium.txt'));
    if (!preview.previewable) throw new Error('expected previewable');
    expect(preview.truncated).toBe(true);
    expect(preview.content.length).toBe(256 * 1024);
  });
});

describe('NodeFileBrowserAdapter.writeFile', () => {
  it('overwrites an existing file in place', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    await adapter.writeFile(join(dir, 'a.txt'), 'goodbye');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({ previewable: true, content: 'goodbye', truncated: false });
  });

  it('accepts writing an empty string', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    await adapter.writeFile(join(dir, 'a.txt'), '');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({ previewable: true, content: '', truncated: false });
  });

  it('throws not_found for a file that does not exist yet (never creates a new file)', async () => {
    await expect(adapter.writeFile(join(dir, 'nope.txt'), 'x')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws validation when the target is a directory', async () => {
    await mkdir(join(dir, 'sub'));
    await expect(adapter.writeFile(join(dir, 'sub'), 'x')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('throws validation when content exceeds the 5MB write cap', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const big = 'x'.repeat(6 * 1024 * 1024);
    await expect(adapter.writeFile(join(dir, 'a.txt'), big)).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('NodeFileBrowserAdapter.realpath', () => {
  it('resolves a symlink to its real target', async () => {
    await mkdir(join(dir, 'real'));
    await symlink(join(dir, 'real'), join(dir, 'link'));
    const resolved = await adapter.realpath(join(dir, 'link'));
    expect(resolved).toBe(await adapter.realpath(join(dir, 'real')));
  });

  it('throws not_found for a path that does not exist', async () => {
    await expect(adapter.realpath(join(dir, 'nope'))).rejects.toMatchObject({ kind: 'not_found' });
  });
});
