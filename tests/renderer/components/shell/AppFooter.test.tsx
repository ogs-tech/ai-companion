import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppFooter } from '../../../../src/renderer/components/shell/AppFooter.js';
import {
  getBrowserTabsSnapshot,
  resetBrowserTabsForTests,
} from '../../../../src/renderer/lib/browser-tabs-store.js';
import { mockApi, ok, renderWithTheme } from '../../test-utils.js';

afterEach(() => {
  resetBrowserTabsForTests();
});

describe('AppFooter', () => {
  it('carries the OGS Tech brand line with link', () => {
    renderWithTheme(<AppFooter />);
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /OGS Tech/i });
    expect(link).toHaveAttribute('href', 'https://www.useogs.com/');
  });

  it('clicking the brand link opens it in the integrated browser instead of navigating away', async () => {
    const user = userEvent.setup();
    const call = mockApi();
    call.mockImplementation(async (method: string) => {
      if (method === 'browser.openTab') return ok({ tabId: 'tab-1' });
      return ok(null);
    });
    renderWithTheme(<AppFooter />);

    await user.click(screen.getByRole('link', { name: /OGS Tech/i }));

    expect(call).toHaveBeenCalledWith('browser.openTab', { url: 'https://www.useogs.com/' });
    expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'tab-1', url: 'https://www.useogs.com/' }]);
  });
});
