import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeBrowserTab,
  closeSessionTab,
  getBrowserTabsSnapshot,
  openManualTab,
  openSessionTab,
  registerBrowserWorkbenchOpener,
  registerSessionTab,
  resetBrowserTabsForTests,
  setTabUrl,
  subscribeBrowserTabs,
} from '../../../src/renderer/lib/browser-tabs-store.js';
import { mockApi, ok, type CallSpy } from '../test-utils.js';

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async () => ok(null));
});

afterEach(() => {
  resetBrowserTabsForTests();
});

describe('browser-tabs-store', () => {
  it('starts empty', () => {
    expect(getBrowserTabsSnapshot()).toEqual({ tabs: [] });
  });

  describe('openSessionTab', () => {
    it('registers the tab and asks the registered Workbench opener to open it', () => {
      const opener = vi.fn();
      registerBrowserWorkbenchOpener(opener);

      openSessionTab('sess-1');

      expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'sess-1', sessionId: 'sess-1', url: '' }]);
      expect(opener).toHaveBeenCalledWith('sess-1');
      expect(call).not.toHaveBeenCalled();
    });

    it('is idempotent — calling it twice does not duplicate the tab, but still asks to focus it each time', () => {
      const opener = vi.fn();
      registerBrowserWorkbenchOpener(opener);

      openSessionTab('sess-1');
      openSessionTab('sess-1');

      expect(getBrowserTabsSnapshot().tabs).toHaveLength(1);
      expect(opener).toHaveBeenCalledTimes(2);
    });

    it('does not throw when no Workbench opener is registered', () => {
      expect(() => openSessionTab('sess-1')).not.toThrow();
      expect(getBrowserTabsSnapshot().tabs).toHaveLength(1);
    });
  });

  describe('registerSessionTab', () => {
    it('adds the tab without asking the Workbench opener to focus it', () => {
      const opener = vi.fn();
      registerBrowserWorkbenchOpener(opener);

      registerSessionTab('sess-1');

      expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'sess-1', sessionId: 'sess-1', url: '' }]);
      expect(opener).not.toHaveBeenCalled();
    });

    it('does not duplicate an already-registered tab', () => {
      registerSessionTab('sess-1');
      registerSessionTab('sess-1');
      expect(getBrowserTabsSnapshot().tabs).toHaveLength(1);
    });
  });

  describe('closeSessionTab', () => {
    it('removes the tab without making any IPC call — the caller already disabled it', () => {
      registerSessionTab('sess-1');

      closeSessionTab('sess-1');

      expect(getBrowserTabsSnapshot().tabs).toEqual([]);
      expect(call).not.toHaveBeenCalled();
    });

    it('is a no-op for an unknown sessionId', () => {
      closeSessionTab('nope');
      expect(getBrowserTabsSnapshot().tabs).toEqual([]);
    });
  });

  describe('openManualTab', () => {
    it('opens a tab via IPC and asks the registered Workbench opener to focus it', async () => {
      const opener = vi.fn();
      registerBrowserWorkbenchOpener(opener);
      call.mockImplementation(async (method: string) => {
        if (method === 'browser.openTab') return ok({ tabId: 'tab-1' });
        return ok(null);
      });

      await openManualTab('https://example.com');

      expect(call).toHaveBeenCalledWith('browser.openTab', { url: 'https://example.com' });
      expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'tab-1', url: 'https://example.com' }]);
      expect(opener).toHaveBeenCalledWith('tab-1');
    });

    it('opens a blank tab when no url is given', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'browser.openTab') return ok({ tabId: 'tab-1' });
        return ok(null);
      });

      await openManualTab();

      expect(call).toHaveBeenCalledWith('browser.openTab', {});
      expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'tab-1', url: '' }]);
    });
  });

  describe('closeBrowserTab', () => {
    it('closes a manual tab via browser.closeTab', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'browser.openTab') return ok({ tabId: 'tab-1' });
        return ok(null);
      });
      await openManualTab();
      call.mockClear();

      await closeBrowserTab('tab-1');

      expect(call).toHaveBeenCalledWith('browser.closeTab', { tabId: 'tab-1' });
      expect(getBrowserTabsSnapshot().tabs).toEqual([]);
    });

    it('closes a session tab via browser.disable, not browser.closeTab', async () => {
      registerSessionTab('sess-1');

      await closeBrowserTab('sess-1');

      expect(call).toHaveBeenCalledWith('browser.disable', { sessionId: 'sess-1' });
      expect(call).not.toHaveBeenCalledWith('browser.closeTab', expect.anything());
      expect(getBrowserTabsSnapshot().tabs).toEqual([]);
    });

    it('is a no-op for an unknown tabId', async () => {
      await closeBrowserTab('nope');
      expect(call).not.toHaveBeenCalled();
    });
  });

  describe('setTabUrl', () => {
    it('updates the url of a known tab without touching the rest of the snapshot', () => {
      registerSessionTab('sess-1');

      setTabUrl('sess-1', 'https://example.com/docs');

      expect(getBrowserTabsSnapshot().tabs).toEqual([
        { tabId: 'sess-1', sessionId: 'sess-1', url: 'https://example.com/docs' },
      ]);
    });

    it('is a no-op for an unknown tabId', () => {
      setTabUrl('nope', 'https://example.com');
      expect(getBrowserTabsSnapshot().tabs).toEqual([]);
    });
  });

  it('notifies subscribers on every tab list change', () => {
    const listener = vi.fn();
    subscribeBrowserTabs(listener);

    registerSessionTab('sess-1');

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
