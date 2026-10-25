import { describe, it, expect, vi } from 'vitest';
import { FileBrowserService } from '../../../../src/main/application/services/file-browser-service.js';
import type { FileBrowserPort } from '../../../../src/main/application/ports/file-browser-port.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const ROOT = '/repos/acme';

function fakePort(overrides: Partial<FileBrowserPort> = {}): FileBrowserPort {
  return {
    listDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue({ previewable: true, kind: 'text', content: 'x', truncated: false }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    realpath: vi.fn(async (p: string) => p),
    ...overrides,
  };
}

describe('FileBrowserService', () => {
  it('listDir("") resolves to the root and delegates to the port', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('');
    expect(port.listDir).toHaveBeenCalledWith(ROOT, { showHidden: false });
  });

  it('listDir forwards showHidden to the port', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('', true);
    expect(port.listDir).toHaveBeenCalledWith(ROOT, { showHidden: true });
  });

  it('listDir("sub/dir") joins onto the root', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('sub/dir');
    expect(port.listDir).toHaveBeenCalledWith('/repos/acme/sub/dir', { showHidden: false });
  });

  it('readFile delegates the resolved absolute path', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.readFile('a.txt');
    expect(port.readFile).toHaveBeenCalledWith('/repos/acme/a.txt');
  });

  it('writeFile delegates the resolved absolute path and content', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.writeFile('a.txt', 'new content');
    expect(port.writeFile).toHaveBeenCalledWith('/repos/acme/a.txt', 'new content');
  });

  it('writeFile rejects a path escaping the root, without calling the port', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await expect(service.writeFile('../secrets', 'x')).rejects.toMatchObject({ kind: 'validation' });
    expect(port.writeFile).not.toHaveBeenCalled();
  });

  it('rejects an absolute path', async () => {
    const service = new FileBrowserService(fakePort(), ROOT);
    await expect(service.listDir('/etc/passwd')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('rejects a path with a .. segment', async () => {
    const service = new FileBrowserService(fakePort(), ROOT);
    await expect(service.listDir('../secrets')).rejects.toMatchObject({ kind: 'validation' });
    await expect(service.listDir('sub/../../secrets')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('rejects a path whose realpath escapes the root (symlink escape)', async () => {
    const port = fakePort({
      realpath: vi.fn(async (p: string) => (p === ROOT ? ROOT : '/etc/escaped')),
    });
    const service = new FileBrowserService(port, ROOT);
    await expect(service.listDir('link-out')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('does not fail the request when the target does not exist yet (lets listDir/readFile 404 naturally)', async () => {
    const port = fakePort({
      realpath: vi.fn(async (p: string) => {
        if (p === ROOT) return ROOT;
        throw new DomainError('not_found', 'not found');
      }),
    });
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('does-not-exist-yet');
    expect(port.listDir).toHaveBeenCalledWith('/repos/acme/does-not-exist-yet', { showHidden: false });
  });

  it('resolveAbsolutePath returns the same guarded path without calling listDir/readFile', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    expect(await service.resolveAbsolutePath('sub')).toBe('/repos/acme/sub');
    expect(port.listDir).not.toHaveBeenCalled();
    expect(port.readFile).not.toHaveBeenCalled();
  });

  describe('listFolders', () => {
    const tree: Record<string, Array<{ name: string; kind: 'file' | 'dir' }>> = {
      '/repos/acme': [{ name: 'apps', kind: 'dir' }, { name: 'node_modules', kind: 'dir' }, { name: 'README.md', kind: 'file' }],
      '/repos/acme/apps': [{ name: 'console', kind: 'dir' }, { name: 'index.ts', kind: 'file' }],
      '/repos/acme/apps/console': [{ name: 'src', kind: 'dir' }],
    };
    const listing = fakePort({ listDir: vi.fn(async (p: string) => tree[p] ?? []) });

    it('lists folders breadth-first as root-relative paths, skipping files and node_modules', async () => {
      const folders = await new FileBrowserService(listing, ROOT).listFolders();
      expect(folders).toEqual(['apps', 'apps/console', 'apps/console/src']);
    });

    it('tolerates a folder that cannot be listed', async () => {
      const flaky = fakePort({
        listDir: vi.fn(async (p: string) => {
          if (p === '/repos/acme/apps') throw new Error('EACCES');
          return tree[p] ?? [];
        }),
      });
      expect(await new FileBrowserService(flaky, ROOT).listFolders()).toEqual(['apps']);
    });
  });
});
