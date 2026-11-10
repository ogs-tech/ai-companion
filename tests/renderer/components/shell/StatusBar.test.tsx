import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBar } from '../../../../src/renderer/components/shell/StatusBar.js';
import { resetBrowserTabsForTests } from '../../../../src/renderer/lib/browser-tabs-store.js';
import { onMenuCommand } from '../../../../src/renderer/lib/menu-commands.js';
import { publishShellStatus, resetShellStatus } from '../../../../src/renderer/lib/shell-status-store.js';
import { registerAreaOpener } from '../../../../src/renderer/lib/workspace-area-store.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
const SETTINGS = {
  ui: { theme: 'light' },
  adapters: { claude: { enabled: true }, cursor: { enabled: false }, lmstudio: { enabled: false } },
  language: 'off',
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return ok(null);
    if (method === 'browser.openTab') return ok({ tabId: 'tab-1' });
    if (method === 'settings.get') return ok(SETTINGS);
    return ok(null);
  });
});

afterEach(() => {
  resetBrowserTabsForTests();
  resetShellStatus();
  registerAreaOpener(null);
});

describe('StatusBar', () => {
  it('renders as the global status bar', () => {
    renderWithShell(<StatusBar />);
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('shows the workspace name, and nothing on the left at Início', async () => {
    renderWithShell(<StatusBar />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));
    expect(screen.queryByTestId('status-workspace')).not.toBeInTheDocument();
  });

  it('flags unsaved changes of the active file, then the time it was saved', () => {
    publishShellStatus({ tab: { title: 'a.md', dirty: true, editable: true, savedAt: null } });
    const { unmount } = renderWithShell(<StatusBar />);
    expect(screen.getByTestId('status-save-state')).toHaveTextContent('Alterações não salvas');
    act(() => publishShellStatus({ tab: { title: 'a.md', dirty: false, editable: true, savedAt: Date.now() } }));
    expect(screen.getByTestId('status-save-state')).toHaveTextContent(/^Salvo às \d{2}:\d{2}$/);
    unmount();
  });

  it('shows the cursor position only when an editor published one', () => {
    renderWithShell(<StatusBar />);
    expect(screen.queryByTestId('status-cursor')).not.toBeInTheDocument();
    act(() => publishShellStatus({ cursor: { line: 3, column: 12 } }));
    expect(screen.getByTestId('status-cursor')).toHaveTextContent('Ln 3, Col 12');
  });

  it('counts sessions that need the user and jumps to the first on click', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(null);
      if (method === 'settings.get') return ok(SETTINGS);
      if (method === 'session.list') return ok([{ sessionId: 's1', status: 'running', activity: 'needs-input' }]);
      return ok(null);
    });
    const handler = vi.fn();
    const off = onMenuCommand('go-needs-attention', handler);
    renderWithShell(<StatusBar />);
    const item = await screen.findByTestId('status-needs-you');
    expect(item).toHaveTextContent('1 sessão precisa de você');
    await userEvent.click(item);
    expect(handler).toHaveBeenCalledOnce();
    off();
  });

  it('renders the sync entry with the health severity and its label', () => {
    renderWithShell(<StatusBar healthSeverity="warning" />);
    const sync = screen.getByTestId('status-pill-sync');
    expect(sync).toHaveAttribute('data-variant', 'warning');
    expect(sync).toHaveTextContent('atenção');
  });

  it('hides the sync entry when there is no health severity yet', () => {
    renderWithShell(<StatusBar />);
    expect(screen.queryByTestId('status-pill-sync')).not.toBeInTheDocument();
  });

  it('clicking the sync entry opens the Diagnóstico Workbench tab', async () => {
    const opener = vi.fn();
    registerAreaOpener(opener);
    renderWithShell(<StatusBar healthSeverity="error" />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    await userEvent.click(screen.getByTestId('status-pill-sync'));

    expect(opener).toHaveBeenCalledWith('diagnostico');
  });

  it('keeps adapters and idle sessions out of the bar', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(null);
      if (method === 'settings.get') return ok(SETTINGS);
      if (method === 'session.list') return ok([{ sessionId: 's1', status: 'running', activity: 'idle' }]);
      return ok(null);
    });
    renderWithShell(<StatusBar healthSeverity="ok" />);
    await screen.findByTestId('status-pill-sync');
    expect(screen.queryByTestId('status-adapter-claude')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-idle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-sessions')).not.toBeInTheDocument();
  });
});
