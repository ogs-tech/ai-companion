import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserSection } from '../../../../src/renderer/components/workspace/BrowserSection.js';
import {
  getBrowserTabsSnapshot,
  registerBrowserWorkbenchOpener,
  registerSessionTab,
  resetBrowserTabsForTests,
} from '../../../../src/renderer/lib/browser-tabs-store.js';
import { mockApi, ok, renderWithTheme, type CallSpy } from '../../test-utils.js';

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
  resetBrowserTabsForTests();
});
afterEach(() => resetBrowserTabsForTests());

describe('BrowserSection', () => {
  it('shows an empty hint when no page is open', () => {
    renderWithTheme(<BrowserSection activeWorkbenchTabId={null} onError={vi.fn()} />);
    expect(screen.getByTestId('browser-empty')).toBeInTheDocument();
  });

  it('lists open pages, marks the focused one and focuses its Workbench tab on click', async () => {
    const opener = vi.fn();
    registerBrowserWorkbenchOpener(opener);
    act(() => registerSessionTab('s1'));
    renderWithTheme(<BrowserSection activeWorkbenchTabId="browser:s1" onError={vi.fn()} />);

    const row = screen.getByTestId('browser-row-s1');
    expect(row).toHaveAttribute('aria-current', 'true');
    await userEvent.click(row);
    expect(opener).toHaveBeenCalledWith('s1');
  });

  it('opens a new page from the header "+"', async () => {
    call.mockImplementation(async (method: string) => ok(method === 'browser.openTab' ? { tabId: 'tab-1' } : null));
    renderWithTheme(<BrowserSection activeWorkbenchTabId={null} onError={vi.fn()} />);

    await userEvent.click(screen.getByTestId('browser-new'));

    await waitFor(() => expect(call).toHaveBeenCalledWith('browser.openTab', {}));
    expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'tab-1', url: '' }]);
  });
});
