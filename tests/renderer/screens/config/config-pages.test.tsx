import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigPage } from '../../../../src/renderer/screens/config/ConfigPage.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { LanguagePreference, Settings } from '../../../../src/shared/settings.js';

const render = (ui: React.ReactElement) => renderWithShell(ui);

const baseSettings: Settings = {
  adapters: {
    claude: { enabled: true },
    cursor: { enabled: false }, lmstudio: { enabled: false },
  },  ui: { theme: 'system' },
  language: 'off',
};

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

const setupRoute = (
  initial: Settings = baseSettings,
  overrides: Record<string, unknown> = {},
) => {
  call.mockImplementation((method: string) => {
    if (method in overrides) return Promise.resolve(overrides[method]);
    if (method === 'settings.get') return Promise.resolve(ok(initial));
    if (method === 'repo.list') return Promise.resolve(ok([]));
    if (method === 'settings.merge') return Promise.resolve(ok(initial));
    if (method === 'settings.setLanguage')
      return Promise.resolve(ok({ settings: initial, syncReport: [] }));
    if (method === 'adapter.setEnabled') return Promise.resolve(ok({ syncReport: [] }));
    if (method === 'adapter.countDestinations') return Promise.resolve(ok({ count: 0 }));
    if (method === 'adapter.syncAll' || method === 'adapter.removeAll') return Promise.resolve(ok([]));
    if (method === 'channelSetup.status') return Promise.resolve(ok({ channelId: 'claude', installed: true, version: '1.0', signedIn: true }));
    return Promise.resolve(ok(undefined));
  });
};

describe('<ConfigPage> — toggles', () => {
  it('toggling claude off calls adapter.countDestinations and opens modal', async () => {
    const user = userEvent.setup();
    setupRoute();
    render(<ConfigPage page="channel:claude" />);

    const toggle = await screen.findByLabelText('Ativar Claude');
    await user.click(toggle);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('adapter.countDestinations', { adapterId: 'claude' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('confirm-disable-modal')).toBeInTheDocument(),
    );
  });

  it('toggling claude on calls adapter.setEnabled with enabled:true', async () => {
    const user = userEvent.setup();
    const initial: Settings = {
      ...baseSettings,
      adapters: {
        claude: { enabled: false },
        cursor: { enabled: false }, lmstudio: { enabled: false },
      },
    };
    setupRoute(initial);
    render(<ConfigPage page="channel:claude" />);

    const toggle = await screen.findByLabelText('Ativar Claude');
    await user.click(toggle);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('adapter.setEnabled', expect.objectContaining({ adapterId: 'claude', enabled: true })),
    );
  });
});

describe('<ConfigPage> — no per-adapter default scope', () => {
  it('does not render a default scope <select> for any adapter', async () => {
    setupRoute();
    render(<ConfigPage page="channel:claude" />);

    await screen.findByLabelText('Ativar Claude');

    expect(screen.queryByLabelText(/default scope/i)).toBeNull();
  });

  it('toggling adapters never sends defaultScope to adapter.setEnabled', async () => {
    const user = userEvent.setup();
    const initial: Settings = {
      ...baseSettings,
      adapters: { claude: { enabled: false }, cursor: { enabled: false }, lmstudio: { enabled: false } },
    };
    setupRoute(initial);
    render(<ConfigPage page="channel:claude" />);

    await user.click(await screen.findByLabelText('Ativar Claude'));

    await waitFor(() =>
      expect(
        call.mock.calls.find((c) => c[0] === 'adapter.setEnabled'),
      ).toBeDefined(),
    );
    for (const c of call.mock.calls) {
      if (c[0] !== 'adapter.setEnabled') continue;
      const payload = c[1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('defaultScope');
    }
  });
});

describe('<ConfigPage> — language selector', () => {
  it('renders the language select with current value from settings', async () => {
    setupRoute({ ...baseSettings, language: 'pt-BR' as LanguagePreference });
    render(<ConfigPage page="language" />);

    const select = await screen.findByLabelText('Language');
    expect(select).toHaveTextContent('Português (pt-BR)');
  });

  it('defaults to Off when language is off', async () => {
    setupRoute();
    render(<ConfigPage page="language" />);

    const select = await screen.findByLabelText('Language');
    expect(select).toHaveTextContent('Off');
  });

  it('calls settings.setLanguage when selection changes', async () => {
    const user = userEvent.setup();
    setupRoute();
    render(<ConfigPage page="language" />);

    const select = await screen.findByLabelText('Language');
    await user.click(select);
    const option = await screen.findByRole('option', { name: 'English' });
    await user.click(option);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'settings.setLanguage',
        expect.objectContaining({ language: 'en' }),
      ),
    );
  });

  it('shows info note when language is not off', async () => {
    setupRoute({ ...baseSettings, language: 'en' as LanguagePreference });
    render(<ConfigPage page="language" />);

    await waitFor(() =>
      expect(
        screen.getByText(/code, comments, and test descriptions are always written in English/i),
      ).toBeInTheDocument(),
    );
  });

  it('hides info note when language is off', async () => {
    setupRoute();
    render(<ConfigPage page="language" />);

    await screen.findByLabelText('Language');

    expect(
      screen.queryByText(/code, comments, and test descriptions are always written in English/i),
    ).not.toBeInTheDocument();
  });
});

