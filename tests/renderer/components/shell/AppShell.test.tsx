import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../../../../src/renderer/components/shell/AppShell.js';
import { dispatchMenuCommand } from '../../../../src/renderer/lib/menu-commands.js';
import { registerConfigOpener } from '../../../../src/renderer/lib/workspace-area-store.js';
import { openManualTab } from '../../../../src/renderer/lib/browser-tabs-store.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

vi.mock('../../../../src/renderer/lib/browser-tabs-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/renderer/lib/browser-tabs-store.js')>()),
  openManualTab: vi.fn(async () => {}),
}));

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.list') return ok([]);
    if (method === 'workspace.getActive') return ok(undefined);
    return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
  });
});

describe('AppShell', () => {
  it('renders TopNav, the given children, and the global status bar', () => {
    renderWithShell(
      <AppShell>
        <div data-testid="screen" />
      </AppShell>,
    );
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('screen')).toBeInTheDocument();
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('opens the Config view via TopNav and the open-settings menu command', async () => {
    const opener = vi.fn();
    registerConfigOpener(opener);
    renderWithShell(
      <AppShell>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId('nav-settings'));
    expect(opener).toHaveBeenCalledOnce();
    act(() => dispatchMenuCommand('open-settings'));
    expect(opener).toHaveBeenCalledTimes(2);
    registerConfigOpener(null);
  });

  it('opens the command palette when the menu asks for it', async () => {
    renderWithShell(
      <AppShell>
        <div data-testid="screen" />
      </AppShell>,
    );
    act(() => dispatchMenuCommand('command-palette'));
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });
});

describe('AppShell external links', () => {
  it('opens a URL pushed by main in the embedded browser and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn();
    let push: (url: string) => void = () => undefined;
    (window.api.externalLink.onOpen as ReturnType<typeof vi.fn>).mockImplementation((listener: (url: string) => void) => {
      push = listener;
      return unsubscribe;
    });
    const { unmount } = renderWithShell(
      <AppShell>
        <div />
      </AppShell>,
    );
    push('https://login.test/oauth');
    push('file:///etc/passwd');
    expect(openManualTab).toHaveBeenCalledTimes(1);
    expect(openManualTab).toHaveBeenCalledWith('https://login.test/oauth');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
