import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DomainError } from '../../../../src/main/domain/errors.js';

const execFileMock = vi.hoisted(() => vi.fn());
const getFileIconMock = vi.hoisted(() => vi.fn());
const openPathMock = vi.hoisted(() => vi.fn());
const showItemInFolderMock = vi.hoisted(() => vi.fn());

// `promisify(execFile)` reads the custom-promisified symbol off the callback
// API, so the mock has to carry it — otherwise promisify wraps the bare mock
// and every call hangs waiting for a callback that never comes.
vi.mock('node:child_process', () => {
  const execFile = execFileMock as unknown as { [k: symbol]: unknown };
  execFile[Symbol.for('nodejs.util.promisify.custom')] = execFileMock;
  return { execFile };
});

vi.mock('electron', () => ({
  app: { getFileIcon: getFileIconMock },
  shell: { openPath: openPathMock, showItemInFolder: showItemInFolderMock },
}));

const { MacAppLauncher } = await import('../../../../src/main/infrastructure/app-launcher/mac-app-launcher.js');

const pngIcon = (dataUrl: string) => ({ isEmpty: () => false, toDataURL: () => dataUrl });

beforeEach(() => {
  vi.clearAllMocks();
  execFileMock.mockResolvedValue({ stdout: '{"candidates":[]}', stderr: '' });
  getFileIconMock.mockResolvedValue(pngIcon('data:image/png;base64,AAA'));
  openPathMock.mockResolvedValue('');
});

describe('MacAppLauncher.listApplicationsFor', () => {
  it('passes the target path as an argument, never inside the script text', async () => {
    await new MacAppLauncher().listApplicationsFor('/repos/acme/a "quote".md');

    const [command, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(command).toBe('osascript');
    expect(args.at(-1)).toBe('/repos/acme/a "quote".md');
    expect(args.slice(0, -1).join(' ')).not.toContain('a "quote".md');
  });

  it('returns the applications the script reported', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({
        defaultAppId: 'com.apple.TextEdit',
        candidates: [{ id: 'com.apple.TextEdit', name: 'TextEdit', path: '/System/Applications/TextEdit.app' }],
      }),
      stderr: '',
    });

    const result = await new MacAppLauncher().listApplicationsFor('/repos/acme/README.md');

    expect(result.defaultAppId).toBe('com.apple.TextEdit');
    expect(result.candidates).toHaveLength(1);
  });

  it('degrades to no applications when osascript fails, so the menu still opens', async () => {
    execFileMock.mockRejectedValue(new Error('timed out'));

    await expect(new MacAppLauncher().listApplicationsFor('/repos/acme/README.md')).resolves.toEqual({
      candidates: [],
    });
  });
});

describe('MacAppLauncher.identify', () => {
  it('reads the bundle identifier of the given application', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify({ id: 'dev.zed.Zed', name: 'Zed', path: '/Applications/Zed.app' }),
      stderr: '',
    });

    await expect(new MacAppLauncher().identify('/Applications/Zed.app')).resolves.toMatchObject({
      id: 'dev.zed.Zed',
    });
  });

  it('returns undefined when the bundle cannot be read', async () => {
    execFileMock.mockRejectedValue(new Error('no such bundle'));

    await expect(new MacAppLauncher().identify('/Applications/Gone.app')).resolves.toBeUndefined();
  });
});

describe('MacAppLauncher.iconFor', () => {
  it('reads the icon once per bundle and serves the rest from cache', async () => {
    const launcher = new MacAppLauncher();

    const first = await launcher.iconFor('/Applications/Zed.app');
    const second = await launcher.iconFor('/Applications/Zed.app');

    expect(first).toBe('data:image/png;base64,AAA');
    expect(second).toBe(first);
    expect(getFileIconMock).toHaveBeenCalledTimes(1);
  });

  it('caches the absence of an icon too, rather than retrying every menu', async () => {
    getFileIconMock.mockRejectedValue(new Error('no icon'));
    const launcher = new MacAppLauncher();

    await expect(launcher.iconFor('/Applications/Broken.app')).resolves.toBeUndefined();
    await launcher.iconFor('/Applications/Broken.app');

    expect(getFileIconMock).toHaveBeenCalledTimes(1);
  });

  it('reports no icon when the bundle has an empty one', async () => {
    getFileIconMock.mockResolvedValue({ isEmpty: () => true, toDataURL: () => 'data:,' });

    await expect(new MacAppLauncher().iconFor('/Applications/Blank.app')).resolves.toBeUndefined();
  });
});

describe('MacAppLauncher launching', () => {
  it('opens the path with the chosen application', async () => {
    await new MacAppLauncher().openWith('/repos/acme/README.md', '/Applications/Zed.app');

    expect(execFileMock).toHaveBeenCalledWith(
      'open',
      ['-a', '/Applications/Zed.app', '/repos/acme/README.md'],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('reports a failed launch as an io error the renderer can surface', async () => {
    execFileMock.mockRejectedValue(new Error('Unable to find application'));

    const error = await new MacAppLauncher()
      .openWith('/repos/acme/README.md', '/Applications/Gone.app')
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).kind).toBe('io');
  });

  it('reports a refused default-handler launch as an io error', async () => {
    openPathMock.mockResolvedValue('no handler for this file type');

    const error = await new MacAppLauncher().openDefault('/repos/acme/README.md').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).kind).toBe('io');
  });

  it('stays silent when the default handler accepts the path', async () => {
    await expect(new MacAppLauncher().openDefault('/repos/acme/README.md')).resolves.toBeUndefined();
  });

  it('reveals the path in the file manager', async () => {
    await new MacAppLauncher().reveal('/repos/acme/README.md');

    expect(showItemInFolderMock).toHaveBeenCalledWith('/repos/acme/README.md');
  });
});
