import { describe, it, expect, vi } from 'vitest';
import { buildOpenWithHandlers } from '../../../src/main/ipc/open-with-handlers.js';
import { FileBrowserService } from '../../../src/main/application/services/file-browser-service.js';
import type { FileBrowserPort } from '../../../src/main/application/ports/file-browser-port.js';
import type { OpenWithService } from '../../../src/main/application/services/open-with-service.js';
import type { ProjectService } from '../../../src/main/application/services/project-service.js';
import type { DialogPort } from '../../../src/main/application/ports/dialog-port.js';
import { FakeEmbeddedBrowserPort } from '../../../src/main/application/services/__fixtures__/fake-embedded-browser-port.js';

const WORKSPACE_ROOT = '/home/user';
const PROJECT_ROOT = '/repos/acme';

const fileBrowserPort = (): FileBrowserPort => ({
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  realpath: vi.fn(async (p: string) => p),
});

interface Harness {
  handlers: ReturnType<typeof buildOpenWithHandlers>;
  openWithService: {
    suggest: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    openByPath: ReturnType<typeof vi.fn>;
    openDefault: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
  };
  dialogPort: { selectFolder: ReturnType<typeof vi.fn>; selectApplication: ReturnType<typeof vi.fn> };
  embeddedBrowser: FakeEmbeddedBrowserPort;
}

function harness(selectApplicationResult: { canceled: boolean; path?: string } = { canceled: true }): Harness {
  const openWithService = {
    suggest: vi.fn().mockResolvedValue({ primary: [], more: [] }),
    open: vi.fn().mockResolvedValue(undefined),
    openByPath: vi.fn().mockResolvedValue(undefined),
    openDefault: vi.fn().mockResolvedValue(undefined),
    reveal: vi.fn().mockResolvedValue(undefined),
  };
  const dialogPort = {
    selectFolder: vi.fn(),
    selectApplication: vi.fn().mockResolvedValue(selectApplicationResult),
  };
  const port = fileBrowserPort();
  const embeddedBrowser = new FakeEmbeddedBrowserPort();
  const handlers = buildOpenWithHandlers({
    openWithService: openWithService as unknown as OpenWithService,
    workspaceBrowser: new FileBrowserService(port, WORKSPACE_ROOT),
    projectService: { get: vi.fn().mockResolvedValue({ id: 'p1', name: 'acme', path: PROJECT_ROOT }) } as unknown as ProjectService,
    fileBrowserPort: port,
    dialogPort: dialogPort as unknown as DialogPort,
    embeddedBrowser,
  });
  return { handlers, openWithService, dialogPort, embeddedBrowser };
}

describe('openWith.suggest', () => {
  it('resolves the relative path against the workspace root', async () => {
    const { handlers, openWithService } = harness();

    await handlers['openWith.suggest']!({ path: 'notes/README.md', kind: 'file' });

    expect(openWithService.suggest).toHaveBeenCalledWith('/home/user/notes/README.md', 'file');
  });

  it('resolves against the project root when a projectId is given', async () => {
    const { handlers, openWithService } = harness();

    await handlers['openWith.suggest']!({ path: 'src', projectId: 'p1', kind: 'dir' });

    expect(openWithService.suggest).toHaveBeenCalledWith('/repos/acme/src', 'dir');
  });

  it('resolves the root itself when the row IS the project folder', async () => {
    const { handlers, openWithService } = harness();

    await handlers['openWith.suggest']!({ path: '', projectId: 'p1', kind: 'dir' });

    expect(openWithService.suggest).toHaveBeenCalledWith('/repos/acme', 'dir');
  });

  it('refuses a path that escapes the root', async () => {
    const { handlers, openWithService } = harness();

    await expect(
      handlers['openWith.suggest']!({ path: '../../etc/passwd', kind: 'file' }),
    ).rejects.toThrow(/escapes the workspace root/);
    expect(openWithService.suggest).not.toHaveBeenCalled();
  });

  it('refuses an absolute path, which would bypass the root entirely', async () => {
    const { handlers, openWithService } = harness();

    await expect(handlers['openWith.suggest']!({ path: '/etc/passwd', kind: 'file' })).rejects.toThrow();
    expect(openWithService.suggest).not.toHaveBeenCalled();
  });

  it('refuses a kind that is neither file nor dir', async () => {
    const { handlers } = harness();

    await expect(handlers['openWith.suggest']!({ path: 'README.md', kind: 'symlink' })).rejects.toThrow(/kind/);
  });
});

describe('openWith.open', () => {
  it('opens the resolved path with the chosen application', async () => {
    const { handlers, openWithService } = harness();

    await handlers['openWith.open']!({
      path: 'notes/README.md',
      kind: 'file',
      appId: 'com.microsoft.VSCode',
      appPath: '/Applications/Visual Studio Code.app',
    });

    expect(openWithService.open).toHaveBeenCalledWith('/home/user/notes/README.md', 'file', {
      id: 'com.microsoft.VSCode',
      path: '/Applications/Visual Studio Code.app',
    });
  });

  it('refuses a request with no application path', async () => {
    const { handlers } = harness();

    await expect(
      handlers['openWith.open']!({ path: 'README.md', kind: 'file', appId: 'com.microsoft.VSCode' }),
    ).rejects.toThrow(/appPath/);
  });
});

describe('openWith.chooseApp', () => {
  it('opens and reports the application the user picked', async () => {
    const { handlers, openWithService } = harness({ canceled: false, path: '/Applications/Zed.app' });

    const result = await handlers['openWith.chooseApp']!({ path: 'notes/README.md', kind: 'file' });

    expect(openWithService.openByPath).toHaveBeenCalledWith(
      '/home/user/notes/README.md',
      'file',
      '/Applications/Zed.app',
    );
    expect(result).toEqual({ canceled: false });
  });

  it('opens nothing when the user cancels the picker', async () => {
    const { handlers, openWithService } = harness({ canceled: true });

    const result = await handlers['openWith.chooseApp']!({ path: 'notes/README.md', kind: 'file' });

    expect(openWithService.openByPath).not.toHaveBeenCalled();
    expect(result).toEqual({ canceled: true });
  });
});

describe('openWith.openDefault and openWith.reveal', () => {
  it('openDefault hands the resolved path to the service', async () => {
    const { handlers, openWithService } = harness();

    await handlers['openWith.openDefault']!({ path: 'notes/README.md' });

    expect(openWithService.openDefault).toHaveBeenCalledWith('/home/user/notes/README.md');
  });

  it('reveal resolves the root itself for an empty path', async () => {
    const { handlers, openWithService } = harness();

    await handlers['openWith.reveal']!({ path: '', projectId: 'p1' });

    expect(openWithService.reveal).toHaveBeenCalledWith('/repos/acme');
  });

  it('reveal hands the resolved path to the service', async () => {
    const { handlers, openWithService } = harness();

    await handlers['openWith.reveal']!({ path: 'notes', projectId: 'p1' });

    expect(openWithService.reveal).toHaveBeenCalledWith('/repos/acme/notes');
  });
});

describe('openWith.openInBrowser', () => {
  it('opens the resolved workspace path as a file:// URL in a new manual tab', async () => {
    const { handlers, embeddedBrowser } = harness();

    const result = await handlers['openWith.openInBrowser']!({ path: 'notes/README.md' });

    expect(embeddedBrowser.openTabCalls).toEqual(['file:///home/user/notes/README.md']);
    expect(result).toEqual({ tabId: 'tab-1' });
  });

  it('resolves against the project root when a projectId is given', async () => {
    const { handlers, embeddedBrowser } = harness();

    await handlers['openWith.openInBrowser']!({ path: 'notes/README.md', projectId: 'p1' });

    expect(embeddedBrowser.openTabCalls).toEqual(['file:///repos/acme/notes/README.md']);
  });

  it('refuses a path that escapes the root, without opening a tab', async () => {
    const { handlers, embeddedBrowser } = harness();

    await expect(
      handlers['openWith.openInBrowser']!({ path: '../../etc/passwd' }),
    ).rejects.toThrow(/escapes the workspace root/);
    expect(embeddedBrowser.openTabCalls).toEqual([]);
  });
});
