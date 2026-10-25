import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../../../../src/renderer/components/shell/AppShell.js';
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
  it('renders TopNav, the given children, and the global footer', () => {
    renderWithShell(
      <AppShell onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('screen')).toBeInTheDocument();
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /OGS Tech/i })).toBeInTheDocument();
  });

  it('opens settings via TopNav', async () => {
    const onOpenSettings = vi.fn();
    renderWithShell(
      <AppShell onOpenSettings={onOpenSettings}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId('nav-settings'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('opens the command palette on ⌘K', async () => {
    renderWithShell(
      <AppShell onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.keyboard('{Meta>}k{/Meta}');
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
      <AppShell onOpenSettings={() => undefined}>
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
