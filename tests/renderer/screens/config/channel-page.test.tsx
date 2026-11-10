import { beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigPage } from '../../../../src/renderer/screens/config/ConfigPage.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

// xterm needs a real browser (matchMedia, canvas); the dialog only hosts it.
vi.mock('../../../../src/renderer/components/workspace/TerminalPanel.js', () => ({ TerminalPanel: () => null }));

const render = (ui: React.ReactElement) => renderWithShell(ui);
import type { Settings } from '../../../../src/shared/settings.js';
import type { SyncResult } from '../../../../src/shared/sync-result.js';

const baseSettings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: false }, lmstudio: { enabled: false } },  ui: { theme: 'system' },
  language: 'off',
};

const stubSyncResult: SyncResult = { adapter: 'claude', destination: '/dest', status: 'ok' };

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

const setupRoute = (overrides: Record<string, unknown> = {}): void => {
  call.mockImplementation((method: string) => {
    if (method in overrides) return Promise.resolve(overrides[method]);
    if (method === 'settings.get') return Promise.resolve(ok(baseSettings));
    if (method === 'repo.list') return Promise.resolve(ok([]));
    if (method === 'adapter.setEnabled') return Promise.resolve(ok({ syncReport: [stubSyncResult] }));
    if (method === 'adapter.countDestinations') return Promise.resolve(ok({ count: 5 }));
    if (method === 'adapter.removeAll') return Promise.resolve(ok([]));
    if (method === 'channelSetup.status') return Promise.resolve(ok({ channelId: 'claude', installed: true, version: '1.0', signedIn: true }));
    return Promise.resolve(ok(undefined));
  });
};

describe('<ChannelPage> — adapters section toggle-on (AC#15)', () => {
  it('toggling claude on calls adapter.setEnabled with enabled:true', async () => {
    const user = userEvent.setup();
    const initial: Settings = {
      ...baseSettings,
      adapters: { claude: { enabled: false }, cursor: { enabled: false }, lmstudio: { enabled: false } },
    };
    call.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve(ok(initial));
      if (method === 'repo.list') return Promise.resolve(ok([]));
      if (method === 'adapter.setEnabled') return Promise.resolve(ok({ syncReport: [stubSyncResult] }));
      if (method === 'adapter.countDestinations') return Promise.resolve(ok({ count: 0 }));
      if (method === 'channelSetup.status') return Promise.resolve(ok({ channelId: 'claude', installed: true, version: '1.0', signedIn: true }));
      return Promise.resolve(ok(undefined));
    });
    render(<ConfigPage page="channel:claude" />);

    const toggle = await screen.findByLabelText('Ativar Claude');
    await user.click(toggle);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('adapter.setEnabled', expect.objectContaining({ adapterId: 'claude', enabled: true })),
    );
  });
});

describe('<ChannelPage> — adapters section toggle-off (AC#14)', () => {
  it('toggling claude off opens ConfirmDisableModal', async () => {
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

  it('clicking "Sim" calls adapter.setEnabled with removeSymlinks:true', async () => {
    const user = userEvent.setup();
    setupRoute();
    render(<ConfigPage page="channel:claude" />);

    const toggle = await screen.findByLabelText('Ativar Claude');
    await user.click(toggle);

    const confirmBtn = await screen.findByTestId('confirm-remove-btn');
    await user.click(confirmBtn);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'adapter.setEnabled',
        expect.objectContaining({ adapterId: 'claude', enabled: false, removeSymlinks: true }),
      ),
    );
  });
});

describe('<ChannelPage> — cursor adapter toggle', () => {
  it('renders a Cursor checkbox reflecting settings.adapters.cursor.enabled', async () => {
    setupRoute();
    render(<ConfigPage page="channel:cursor" />);
    const toggle = (await screen.findByLabelText('Ativar Cursor')) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('toggling cursor on calls adapter.setEnabled with adapterId:"cursor"', async () => {
    const user = userEvent.setup();
    setupRoute();
    render(<ConfigPage page="channel:cursor" />);

    const toggle = await screen.findByLabelText('Ativar Cursor');
    await user.click(toggle);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        'adapter.setEnabled',
        expect.objectContaining({ adapterId: 'cursor', enabled: true }),
      ),
    );
  });

  it('toggling cursor off (when enabled) opens the disable modal for Cursor', async () => {
    const user = userEvent.setup();
    call.mockImplementation((method: string) => {
      if (method === 'settings.get')
        return Promise.resolve(
          ok({ ...baseSettings, adapters: { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: false } } }),
        );
      if (method === 'repo.list') return Promise.resolve(ok([]));
      if (method === 'adapter.countDestinations') return Promise.resolve(ok({ count: 3 }));
      if (method === 'channelSetup.status') return Promise.resolve(ok({ channelId: 'claude', installed: true, version: '1.0', signedIn: true }));
      return Promise.resolve(ok(undefined));
    });
    render(<ConfigPage page="channel:cursor" />);

    const toggle = await screen.findByLabelText('Ativar Cursor');
    await user.click(toggle);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('adapter.countDestinations', { adapterId: 'cursor' }),
    );
    expect(await screen.findByTestId('confirm-disable-modal')).toBeInTheDocument();
  });
});

describe('<ChannelPage> — install and sign-in steps', () => {
  it('offers only Instalar when the channel is not installed, and hides the enable switch', async () => {
    setupRoute({ 'channelSetup.status': ok({ channelId: 'cursor', installed: false, signedIn: false }) });
    render(<ConfigPage page="channel:cursor" />);
    expect(await screen.findByRole('button', { name: 'Instalar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ativar Cursor')).not.toBeInTheDocument();
  });

  it('offers Entrar when installed but signed out', async () => {
    setupRoute({ 'channelSetup.status': ok({ channelId: 'cursor', installed: true, version: '1.0', signedIn: false }) });
    render(<ConfigPage page="channel:cursor" />);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Ativar Cursor')).not.toBeInTheDocument();
  });

  it('starts the install through channelSetup.start', async () => {
    const user = userEvent.setup();
    setupRoute({
      'channelSetup.status': ok({ channelId: 'cursor', installed: false, signedIn: false }),
      'channelSetup.start': ok({ kind: 'terminal', terminalId: 't1', title: 'Instalar Cursor' }),
      'channelSetup.terminal': ok(null),
    });
    render(<ConfigPage page="channel:cursor" />);
    await user.click(await screen.findByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('channelSetup.start', { channelId: 'cursor', action: 'install' }));
    expect(await screen.findByTestId('channel-setup-dialog')).toBeInTheDocument();
  });

  it('shows no sign-in step for LM Studio and offers the app download', async () => {
    setupRoute({ 'channelSetup.status': ok({ channelId: 'lmstudio', installed: false, signedIn: null }) });
    render(<ConfigPage page="channel:lmstudio" />);
    expect(await screen.findByRole('button', { name: 'Baixar LM Studio' })).toBeInTheDocument();
    expect(screen.queryByText('Entrar na conta')).not.toBeInTheDocument();
  });
});
