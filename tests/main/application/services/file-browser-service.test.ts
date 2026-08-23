import { describe, it, expect, vi } from 'vitest';
import { FileBrowserService } from '../../../../src/main/application/services/file-browser-service.js';
import type { FileBrowserPort } from '../../../../src/main/application/ports/file-browser-port.js';

const ROOT = '/repos/acme';

function fakePort(overrides: Partial<FileBrowserPort> = {}): FileBrowserPort {
  return {
    listDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue({ previewable: true, content: 'x', truncated: false }),
    realpath: vi.fn(async (p: string) => p),
    ...overrides,
  };
}

describe('FileBrowserService', () => {
  it('listDir("") resolves to the root and delegates to the port', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('');
    expect(port.listDir).toHaveBeenCalledWith(ROOT);
  });

  it('listDir("sub/dir") joins onto the root', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('sub/dir');
    expect(port.listDir).toHaveBeenCalledWith('/repos/acme/sub/dir');
  });

  it('readFile delegates the resolved absolute path', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.readFile('a.txt');
    expect(port.readFile).toHaveBeenCalledWith('/repos/acme/a.txt');
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
        const err = Object.assign(new Error('not found'), { kind: 'not_found' });
        throw err;
      }),
    });
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('does-not-exist-yet');
    expect(port.listDir).toHaveBeenCalledWith('/repos/acme/does-not-exist-yet');
  });

  it('resolveAbsolutePath returns the same guarded path without calling listDir/readFile', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    expect(await service.resolveAbsolutePath('sub')).toBe('/repos/acme/sub');
    expect(port.listDir).not.toHaveBeenCalled();
    expect(port.readFile).not.toHaveBeenCalled();
  });
});
