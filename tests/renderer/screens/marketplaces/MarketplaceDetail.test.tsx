import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarketplaceDetail } from '../../../../src/renderer/screens/marketplaces/MarketplaceDetail.js';
import {
  getBrowserTabsSnapshot,
  resetBrowserTabsForTests,
} from '../../../../src/renderer/lib/browser-tabs-store.js';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../../test-utils.js';

let call: CallSpy;

const marketplace = {
  id: 'official',
  source: { kind: 'github' as const, repo: 'anthropics/claude-plugins-official' },
  manifest: {
    name: 'Official',
    description: 'Official Claude plugins',
    plugins: [
      {
        name: 'plugin-alpha',
        description: 'Alpha helper',
        author: { name: 'Anthropic' },
        category: 'productivity',
        source: 'a',
      },
      {
        name: 'plugin-bravo',
        description: 'Bravo helper',
        author: { name: 'Community' },
        category: 'devtools',
        source: 'b',
      },
    ],
  },
};

beforeEach(() => {
  call = mockApi();
  call.mockImplementation((method: string) => {
    if (method === 'plugin.list') return Promise.resolve(ok([]));
    if (method === 'browser.openTab') return Promise.resolve(ok({ tabId: 'tab-1' }));
    return Promise.resolve(ok(undefined));
  });
});

afterEach(() => {
  resetBrowserTabsForTests();
});

describe('<MarketplaceDetail>', () => {
  it('renders plugins via the entity grid with install buttons', async () => {
    renderWithQuery(<MarketplaceDetail marketplace={marketplace} />);

    expect(
      await screen.findByTestId('entity-grid-card-marketplace-plugin-plugin-alpha'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('entity-grid-card-marketplace-plugin-plugin-bravo'),
    ).toBeInTheDocument();

    expect(
      screen.getByTestId('marketplace-plugin-install-plugin-alpha'),
    ).toHaveTextContent('Instalar');

    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });

  it('clicking the source link opens it in the integrated browser instead of navigating away', async () => {
    const user = userEvent.setup();
    renderWithQuery(<MarketplaceDetail marketplace={marketplace} />);

    const link = await screen.findByRole('link', { name: 'anthropics/claude-plugins-official' });
    await user.click(link);

    expect(call).toHaveBeenCalledWith('browser.openTab', {
      url: 'https://github.com/anthropics/claude-plugins-official',
    });
    expect(getBrowserTabsSnapshot().tabs).toEqual([
      { tabId: 'tab-1', url: 'https://github.com/anthropics/claude-plugins-official' },
    ]);
  });

  it('filters plugins through the grid search input', async () => {
    const user = userEvent.setup();
    renderWithQuery(<MarketplaceDetail marketplace={marketplace} />);

    await screen.findByTestId('entity-grid-card-marketplace-plugin-plugin-alpha');
    await user.type(
      screen.getByTestId('entity-grid-search-marketplace-plugin'),
      'bravo',
    );

    expect(
      screen.queryByTestId('entity-grid-card-marketplace-plugin-plugin-alpha'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('entity-grid-card-marketplace-plugin-plugin-bravo'),
    ).toBeInTheDocument();
  });

  it('marks already-installed plugins as Installed', async () => {
    call.mockImplementation((method: string) => {
      if (method === 'plugin.list')
        return Promise.resolve(ok([{ id: 'plugin-alpha' }]));
      return Promise.resolve(ok(undefined));
    });

    renderWithQuery(<MarketplaceDetail marketplace={marketplace} />);

    await waitFor(() => {
      expect(
        screen.getByTestId('marketplace-plugin-install-plugin-alpha'),
      ).toHaveTextContent('Instalado');
    });
    expect(
      screen.getByTestId('marketplace-plugin-install-plugin-bravo'),
    ).toHaveTextContent('Instalar');
  });

  it('opens the install preview dialog when Install is clicked', async () => {
    const user = userEvent.setup();
    renderWithQuery(<MarketplaceDetail marketplace={marketplace} />);

    const button = await screen.findByTestId(
      'marketplace-plugin-install-plugin-alpha',
    );
    await user.click(button);

    expect(
      await screen.findByTestId('plugin-install-preview-dialog'),
    ).toBeInTheDocument();
  });

  it('shows an empty state when the marketplace has no plugins', async () => {
    renderWithQuery(
      <MarketplaceDetail
        marketplace={{
          ...marketplace,
          manifest: { ...marketplace.manifest, plugins: [] },
        }}
      />,
    );

    expect(
      await screen.findByText(/Nenhum plugin listado neste marketplace/i),
    ).toBeInTheDocument();
  });

  it('renders the official badge for the official marketplace', async () => {
    renderWithQuery(<MarketplaceDetail marketplace={marketplace} />);
    expect(
      await screen.findByTestId('marketplace-official-badge'),
    ).toBeInTheDocument();
  });

  it('shows a manifest warning when the manifest is missing', () => {
    renderWithQuery(
      <MarketplaceDetail
        marketplace={{ id: 'broken', source: marketplace.source }}
      />,
    );
    expect(
      screen.getByText(/O manifesto do marketplace não pôde ser carregado/i),
    ).toBeInTheDocument();
  });

  it('renders the install error inline when install fails', async () => {
    const user = userEvent.setup();
    call.mockImplementation((method: string) => {
      if (method === 'plugin.list') return Promise.resolve(ok([]));
      if (method === 'plugin.previewFromMarketplace')
        return Promise.resolve(
          ok({
            id: 'plugin-alpha',
            version: '1.0.0',
            description: 'Alpha helper',
            artifacts: {
              skills: [],
              agents: [],
              commands: [],
              hooks: 0,
              mcp: false,
              lsp: false,
            },
          }),
        );
      if (method === 'plugin.installFromMarketplace')
        return Promise.resolve({
          ok: false,
          error: { kind: 'install-failed', message: 'boom' },
        });
      return Promise.resolve(ok(undefined));
    });

    renderWithQuery(<MarketplaceDetail marketplace={marketplace} />);

    await user.click(
      await screen.findByTestId('marketplace-plugin-install-plugin-alpha'),
    );
    const confirm = await screen.findByTestId('plugin-install-confirm');
    await waitFor(() => expect(confirm).not.toBeDisabled());
    await user.click(confirm);

    const errorEl = await screen.findByTestId(
      'marketplace-plugin-error-plugin-alpha',
    );
    expect(within(errorEl.parentElement!).getByText(/boom/)).toBeInTheDocument();
  });
});
