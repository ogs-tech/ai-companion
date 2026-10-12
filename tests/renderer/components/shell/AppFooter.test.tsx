import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppFooter } from '../../../../src/renderer/components/shell/AppFooter.js';
import {
  getBrowserTabsSnapshot,
  resetBrowserTabsForTests,
} from '../../../../src/renderer/lib/browser-tabs-store.js';
import { registerAreaOpener } from '../../../../src/renderer/lib/workspace-area-store.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const DEFAULT_WORKSPACE = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const SETTINGS = {
  ui: { theme: 'light' },
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },
  language: 'off',
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return ok(DEFAULT_WORKSPACE);
    if (method === 'browser.openTab') return ok({ tabId: 'tab-1' });
    if (method === 'settings.get') return ok(SETTINGS);
    return ok(null);
  });
});

afterEach(() => {
  resetBrowserTabsForTests();
  registerAreaOpener(null);
});

describe('AppFooter', () => {
  it('carries the OGS Tech brand line with link', () => {
    renderWithShell(<AppFooter />);
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /OGS Tech/i });
    expect(link).toHaveAttribute('href', 'https://www.useogs.com/');
  });

  it('clicking the brand link opens it in the integrated browser instead of navigating away', async () => {
    const user = userEvent.setup();
    renderWithShell(<AppFooter />);

    await user.click(screen.getByRole('link', { name: /OGS Tech/i }));

    expect(call).toHaveBeenCalledWith('browser.openTab', { url: 'https://www.useogs.com/' });
    expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'tab-1', url: 'https://www.useogs.com/' }]);
  });

  it('renders the sync entry with the health severity and its label', () => {
    renderWithShell(<AppFooter healthSeverity="warning" />);
    const sync = screen.getByTestId('status-pill-sync');
    expect(sync).toHaveAttribute('data-variant', 'warning');
    expect(sync).toHaveTextContent('atenção');
  });

  it('hides the sync entry when there is no health severity yet', () => {
    renderWithShell(<AppFooter />);
    expect(screen.queryByTestId('status-pill-sync')).not.toBeInTheDocument();
  });

  it('clicking the sync entry opens the Diagnóstico Workbench tab', async () => {
    const opener = vi.fn();
    registerAreaOpener(opener);
    renderWithShell(<AppFooter healthSeverity="error" />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    await userEvent.click(screen.getByTestId('status-pill-sync'));

    expect(opener).toHaveBeenCalledWith('diagnostico');
  });

  it('renders one adapter entry per harness, ✓ when enabled and — when not', async () => {
    renderWithShell(<AppFooter />);
    expect(await screen.findByTestId('status-adapter-claude')).toHaveTextContent('Claude ✓');
    expect(screen.getByTestId('status-adapter-cursor')).toHaveTextContent('Cursor —');
  });
});
