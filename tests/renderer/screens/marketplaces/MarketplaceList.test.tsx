import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarketplaceList } from '../../../../src/renderer/screens/marketplaces/MarketplaceList.js';
import {
  getBrowserTabsSnapshot,
  resetBrowserTabsForTests,
} from '../../../../src/renderer/lib/browser-tabs-store.js';
import {
  mockApi,
  ok,
  renderWithQuery,
  type CallSpy,
} from '../../test-utils.js';

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

afterEach(() => {
  resetBrowserTabsForTests();
});

describe('<MarketplaceList>', () => {
  it('renders empty state when no marketplaces', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'marketplace.list') return Promise.resolve(ok([]));
      return Promise.resolve(ok(undefined));
    });
    renderWithQuery(<MarketplaceList />);
    expect(
      await screen.findByText(/Nada por aqui ainda/i),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('import-marketplace-button'),
    ).toBeInTheDocument();
  });

  it('renders marketplace items with manifest info', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'marketplace.list')
        return Promise.resolve(
          ok([
            {
              id: 'claude-plugins-official',
              source: { kind: 'directory', path: '/tmp/cpo' },
              manifest: {
                name: 'Claude Plugins Official',
                description: 'official catalog',
                plugins: [{ name: 'p1', description: 'plugin 1', source: 'a' }],
              },
            },
          ]),
        );
      return Promise.resolve(ok(undefined));
    });
    renderWithQuery(<MarketplaceList />);

    expect(
      await screen.findByTestId(
        'entity-grid-card-marketplace-claude-plugins-official',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Claude Plugins Official'),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 plugin/)).toBeInTheDocument();
  });

  it('clicking a GitHub-sourced item’s link opens it in the integrated browser instead of navigating away', async () => {
    const user = userEvent.setup();
    call.mockImplementation((method: string) => {
      if (method === 'marketplace.list')
        return Promise.resolve(
          ok([
            {
              id: 'official',
              source: { kind: 'github', repo: 'anthropics/claude-plugins-official' },
              manifest: {
                name: 'Official',
                description: 'official catalog',
                plugins: [{ name: 'p1', description: 'plugin 1', source: 'a' }],
              },
            },
          ]),
        );
      if (method === 'browser.openTab') return Promise.resolve(ok({ tabId: 'tab-1' }));
      return Promise.resolve(ok(undefined));
    });
    renderWithQuery(<MarketplaceList />);

    const link = await screen.findByRole('link', { name: 'anthropics/claude-plugins-official' });
    await user.click(link);

    expect(call).toHaveBeenCalledWith('browser.openTab', {
      url: 'https://github.com/anthropics/claude-plugins-official',
    });
    expect(getBrowserTabsSnapshot().tabs).toEqual([
      { tabId: 'tab-1', url: 'https://github.com/anthropics/claude-plugins-official' },
    ]);
  });

  it('opens import dialog when Import from URL clicked', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'marketplace.list') return Promise.resolve(ok([]));
      return Promise.resolve(ok(undefined));
    });
    const user = userEvent.setup();
    renderWithQuery(<MarketplaceList />);
    await screen.findByText(/Nada por aqui ainda/i);
    await user.click(screen.getByTestId('import-marketplace-button'));
    expect(
      screen.getByTestId('marketplace-import-dialog'),
    ).toBeInTheDocument();
  });

  it('opens marketplace detail drawer when a card is clicked', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'marketplace.list')
        return Promise.resolve(
          ok([
            {
              id: 'cpo',
              source: { kind: 'directory', path: '/tmp/cpo' },
              manifest: {
                name: 'Catalog',
                description: 'desc',
                plugins: [{ name: 'p1', description: 'plugin 1', source: 'a' }],
              },
            },
          ]),
        );
      if (method === 'plugin.list') return Promise.resolve(ok([]));
      return Promise.resolve(ok(undefined));
    });
    const user = userEvent.setup();
    renderWithQuery(<MarketplaceList />);

    // List remains on screen
    const card = await screen.findByTestId('entity-grid-card-marketplace-cpo');
    await user.click(card);

    // Drawer opens; list still mounted
    expect(await screen.findByTestId('detail-drawer-marketplace')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-list')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-detail')).toBeInTheDocument();

    // Close drawer
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId('marketplace-detail')).not.toBeInTheDocument();
  });
});
