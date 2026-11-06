import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalFileService } from '../../../../src/main/application/services/external-file-service.js';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';
import { NodeFileOperationsAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-operations-adapter.js';
import type { DialogPort } from '../../../../src/main/application/ports/dialog-port.js';

let dir: string;
let picked: string[];
const dialog = (): DialogPort => ({
  selectFolder: vi.fn(),
  selectApplication: vi.fn(),
  selectFiles: vi.fn(async () => (picked.length === 0 ? { canceled: true, paths: [] } : { canceled: false, paths: picked })),
});
const make = () => new ExternalFileService(dialog(), new NodeFileBrowserAdapter(), new NodeFileOperationsAdapter());

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'ext-')));
  await fs.writeFile(join(dir, 'a.txt'), 'hello');
  picked = [];
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ExternalFileService', () => {
  it('rejects read and write for paths that were never granted', async () => {
    const svc = make();
    await expect(svc.read(join(dir, 'a.txt'))).rejects.toMatchObject({ kind: 'validation' });
    await expect(svc.write(join(dir, 'a.txt'), 'x')).rejects.toMatchObject({ kind: 'validation' });
    expect(await fs.readFile(join(dir, 'a.txt'), 'utf8')).toBe('hello');
  });

  it('grants through the picker and then reads and writes', async () => {
    const svc = make();
    expect(await svc.pick()).toEqual([]);
    picked = [join(dir, 'a.txt')];
    expect(await svc.pick()).toEqual(picked);
    expect(await svc.read(picked[0]!)).toMatchObject({ previewable: true, content: 'hello' });
    await svc.write(picked[0]!, 'changed');
    expect(await fs.readFile(picked[0]!, 'utf8')).toBe('changed');
    expect(svc.isGranted(join(dir, 'other.txt'))).toBe(false);
  });

  it('grantDropped only accepts existing absolute files or directories', async () => {
    const svc = make();
    const accepted = await svc.grantDropped([join(dir, 'a.txt'), dir, join(dir, 'ghost.txt'), 'relative.txt']);
    expect(accepted).toEqual([join(dir, 'a.txt'), dir]);
    expect(svc.isGranted(join(dir, 'ghost.txt'))).toBe(false);
  });
});
