import { describe, it, expect, vi } from 'vitest';
import type { WritableFileSystemPort } from '../../../../src/main/application/ports/writable-filesystem-port.js';
import { EmbeddedBrowserAdapter } from '../../../../src/main/infrastructure/browser/embedded-browser-adapter.js';

const { MockWebContentsView } = vi.hoisted(() => {
  class MockWebContents {
    loadURL = vi.fn().mockResolvedValue(undefined);
    getURL = vi.fn().mockReturnValue('about:blank');
    isDestroyed = vi.fn().mockReturnValue(false);
    close = vi.fn();
  }

  class MockWebContentsView {
    webContents = new MockWebContents();
    setBounds = vi.fn();
  }

  return { MockWebContentsView };
});

vi.mock('electron', () => ({
  WebContentsView: MockWebContentsView,
}));

function fakeMainWindow() {
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  };
}

function fakeFs() {
  const written: Array<{ path: string; content: string }> = [];
  const removed: string[] = [];
  let counter = 0;
  const fs = {
    makeTempDir: vi.fn(async (prefix: string) => {
      counter += 1;
      return `/tmp/${prefix}${counter}`;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      written.push({ path, content });
    }),
    remove: vi.fn(async (path: string) => {
      removed.push(path);
    }),
  } as unknown as WritableFileSystemPort;
  return { fs, written, removed };
}

const setup = () => {
  const mainWindow = fakeMainWindow();
  const { fs, written, removed } = fakeFs();
  const adapter = new EmbeddedBrowserAdapter({
    getMainWindow: () => mainWindow as never,
    fs,
    playwrightMcpBin: '/app/node_modules/.bin/playwright-mcp',
    cdpPort: 9333,
  });
  return { adapter, mainWindow, fs, written, removed };
};

describe('EmbeddedBrowserAdapter', () => {
  it('create adds a WebContentsView as a child of the main window and writes an ephemeral mcp config pointing at the CDP port', async () => {
    const { adapter, mainWindow, written } = setup();

    const { mcpConfigPath } = await adapter.create('sess-1');

    expect(mainWindow.contentView.addChildView).toHaveBeenCalledTimes(1);
    expect(mcpConfigPath).toBe('/tmp/browser-mcp-1/config.json');
    expect(written).toHaveLength(1);
    const parsedConfig = JSON.parse(written[0]!.content);
    expect(parsedConfig).toEqual({
      mcpServers: {
        playwright: {
          command: '/app/node_modules/.bin/playwright-mcp',
          args: ['--cdp-endpoint', 'ws://127.0.0.1:9333/'],
        },
      },
    });
  });

  it('create is idempotent for an already-created sessionId — returns the same path, creates no second view', async () => {
    const { adapter, mainWindow } = setup();

    const first = await adapter.create('sess-1');
    const second = await adapter.create('sess-1');

    expect(second).toEqual(first);
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledTimes(1);
  });

  it('create throws when the main window does not exist yet', async () => {
    const { fs } = fakeFs();
    const adapter = new EmbeddedBrowserAdapter({
      getMainWindow: () => null,
      fs,
      playwrightMcpBin: '/app/node_modules/.bin/playwright-mcp',
      cdpPort: 9333,
    });

    await expect(adapter.create('sess-1')).rejects.toThrow();
  });

  it('destroy removes the view from the main window and deletes the temp dir', async () => {
    const { adapter, mainWindow, removed } = setup();
    await adapter.create('sess-1');

    await adapter.destroy('sess-1');

    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledTimes(1);
    expect(removed).toEqual(['/tmp/browser-mcp-1']);
  });

  it('destroy on an unknown sessionId is a no-op', async () => {
    const { adapter, mainWindow, removed } = setup();
    await expect(adapter.destroy('nope')).resolves.toBeUndefined();
    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
  });

  it('a session destroyed once cannot be destroyed again (state is forgotten)', async () => {
    const { adapter, mainWindow } = setup();
    await adapter.create('sess-1');
    await adapter.destroy('sess-1');
    await adapter.destroy('sess-1');
    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledTimes(1);
  });

  it('destroyAll tears down every live session', async () => {
    const { adapter, mainWindow, removed } = setup();
    await adapter.create('sess-1');
    await adapter.create('sess-2');

    await adapter.destroyAll();

    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledTimes(2);
    expect(removed.slice().sort()).toEqual(['/tmp/browser-mcp-1', '/tmp/browser-mcp-2']);
    expect(adapter.status('sess-1')).toBeNull();
    expect(adapter.status('sess-2')).toBeNull();
  });

  it('navigate loads the URL in that session’s view; no-ops for an unknown sessionId', async () => {
    const { adapter } = setup();
    await adapter.create('sess-1');

    await adapter.navigate('sess-1', 'https://example.com');
    await expect(adapter.navigate('nope', 'https://example.com')).resolves.toBeUndefined();

    expect(adapter.status('sess-1')).toEqual({ url: 'about:blank' });
  });

  it('setBounds positions that session’s view; no-ops for an unknown sessionId', async () => {
    const { adapter } = setup();
    await adapter.create('sess-1');

    expect(() => adapter.setBounds('sess-1', { x: 1, y: 2, width: 300, height: 400 })).not.toThrow();
    expect(() => adapter.setBounds('nope', { x: 0, y: 0, width: 0, height: 0 })).not.toThrow();
  });

  it('status returns null for a sessionId that was never created', () => {
    const { adapter } = setup();
    expect(adapter.status('nope')).toBeNull();
  });

  describe('manual tabs', () => {
    it('openTab adds a view as a child of the main window, navigated to the given url, and mints a fresh tabId per call', async () => {
      const { adapter, mainWindow } = setup();

      const first = await adapter.openTab('https://example.com');
      const second = await adapter.openTab();

      expect(first.tabId).not.toBe(second.tabId);
      expect(mainWindow.contentView.addChildView).toHaveBeenCalledTimes(2);
      expect(mainWindow.contentView.addChildView.mock.calls[0]![0].webContents.loadURL).toHaveBeenCalledWith(
        'https://example.com',
      );
      expect(mainWindow.contentView.addChildView.mock.calls[1]![0].webContents.loadURL).toHaveBeenCalledWith(
        'about:blank',
      );
    });

    it('closeTab tears the view down and forgets it; no-ops for an unknown tabId', async () => {
      const { adapter, mainWindow } = setup();
      const { tabId } = await adapter.openTab();

      await adapter.closeTab(tabId);
      await expect(adapter.closeTab('nope')).resolves.toBeUndefined();

      expect(mainWindow.contentView.removeChildView).toHaveBeenCalledTimes(1);
      expect(adapter.status(tabId)).toBeNull();
    });

    it('closeTab refuses to tear down a session tab — only destroy does', async () => {
      const { adapter, mainWindow } = setup();
      await adapter.create('sess-1');

      await adapter.closeTab('sess-1');

      expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
      expect(adapter.status('sess-1')).not.toBeNull();
    });

    it('navigate and setBounds and status all work against a manual tabId the same as a sessionId', async () => {
      const { adapter } = setup();
      const { tabId } = await adapter.openTab();

      await adapter.navigate(tabId, 'https://example.com');
      expect(() => adapter.setBounds(tabId, { x: 1, y: 2, width: 300, height: 400 })).not.toThrow();
      expect(adapter.status(tabId)).toEqual({ url: 'about:blank' });
    });

    it('destroyAll tears down manual tabs alongside session tabs', async () => {
      const { adapter, mainWindow } = setup();
      await adapter.create('sess-1');
      const { tabId } = await adapter.openTab();

      await adapter.destroyAll();

      expect(mainWindow.contentView.removeChildView).toHaveBeenCalledTimes(2);
      expect(adapter.status('sess-1')).toBeNull();
      expect(adapter.status(tabId)).toBeNull();
    });
  });
});
