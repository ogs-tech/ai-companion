import { beforeEach, describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigPage } from '../../../../src/renderer/screens/config/ConfigPage.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const render = (ui: React.ReactElement) => renderWithShell(ui);
import type { Settings } from '../../../../src/shared/settings.js';
import type { SyncResult } from '../../../../src/shared/sync-result.js';

const baseSettings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },  ui: { theme: 'system' },
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
    return Promise.resolve(ok(undefined));
  });
};

describe('<HarnessPage> — adapters section toggle-on (AC#15)', () => {
  it('toggling claude on calls adapter.setEnabled with enabled:true', async () => {
    const user = userEvent.setup();
    const initial: Settings = {
      ...baseSettings,
      adapters: { claude: { enabled: false }, cursor: { enabled: false } },
    };
    call.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve(ok(initial));
      if (method === 'repo.list') return Promise.resolve(ok([]));
      if (method === 'adapter.setEnabled') return Promise.resolve(ok({ syncReport: [stubSyncResult] }));
      if (method === 'adapter.countDestinations') return Promise.resolve(ok({ count: 0 }));
      return Promise.resolve(ok(undefined));
    });
    render(<ConfigPage page="harness:claude" />);

    const toggle = await screen.findByLabelText('Claude');
    await user.click(toggle);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('adapter.setEnabled', expect.objectContaining({ adapterId: 'claude', enabled: true })),
    );
  });
});

describe('<HarnessPage> — adapters section toggle-off (AC#14)', () => {
  it('toggling claude off opens ConfirmDisableModal', async () => {
    const user = userEvent.setup();
    setupRoute();
    render(<ConfigPage page="harness:claude" />);

    const toggle = await screen.findByLabelText('Claude');
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
    render(<ConfigPage page="harness:claude" />);

    const toggle = await screen.findByLabelText('Claude');
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

describe('<HarnessPage> — cursor adapter toggle', () => {
  it('renders a Cursor checkbox reflecting settings.adapters.cursor.enabled', async () => {
    setupRoute();
    render(<ConfigPage page="harness:cursor" />);
    const toggle = (await screen.findByLabelText('Cursor')) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('toggling cursor on calls adapter.setEnabled with adapterId:"cursor"', async () => {
    const user = userEvent.setup();
    setupRoute();
    render(<ConfigPage page="harness:cursor" />);

    const toggle = await screen.findByLabelText('Cursor');
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
          ok({ ...baseSettings, adapters: { claude: { enabled: true }, cursor: { enabled: true } } }),
        );
      if (method === 'repo.list') return Promise.resolve(ok([]));
      if (method === 'adapter.countDestinations') return Promise.resolve(ok({ count: 3 }));
      return Promise.resolve(ok(undefined));
    });
    render(<ConfigPage page="harness:cursor" />);

    const toggle = await screen.findByLabelText('Cursor');
    await user.click(toggle);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('adapter.countDestinations', { adapterId: 'cursor' }),
    );
    expect(await screen.findByTestId('confirm-disable-modal')).toBeInTheDocument();
  });
});
