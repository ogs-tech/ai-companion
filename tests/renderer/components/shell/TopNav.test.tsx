import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopNav } from '../../../../src/renderer/components/shell/TopNav.js';
import {
  pushWorkspaceHistoryEntry,
  registerWorkspaceHistoryApplier,
  resetWorkspaceHistoryForTests,
} from '../../../../src/renderer/lib/workspace-history-store.js';
import { getBrowserTabsSnapshot, resetBrowserTabsForTests } from '../../../../src/renderer/lib/browser-tabs-store.js';
import { publishWorkspacePanels, registerWorkspaceShellCommands } from '../../../../src/renderer/lib/workspace-shell-store.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.list') return ok([]);
    if (method === 'workspace.getActive') return ok(null);
    return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
  });
});

afterEach(() => {
  registerWorkspaceShellCommands(null);
  publishWorkspacePanels({ explorerCollapsed: false, controlCollapsed: false });
  resetWorkspaceHistoryForTests();
  resetBrowserTabsForTests();
});

const noop = () => undefined;

describe('TopNav', () => {
  it('renders the context switcher', async () => {
    renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(await screen.findByTestId('context-switcher')).toHaveTextContent('Início');
  });

  it('toggles the side panels through the registered shell commands and reflects their state', async () => {
    const user = userEvent.setup();
    const togglePanel = vi.fn();
    registerWorkspaceShellCommands({ focusOverview: vi.fn(), togglePanel });
    renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);

    await user.click(screen.getByTestId('workspace-toggle-files'));
    await user.click(screen.getByTestId('workspace-toggle-customizations'));
    expect(togglePanel.mock.calls).toEqual([['explorer'], ['control']]);

    act(() => publishWorkspacePanels({ explorerCollapsed: true, controlCollapsed: false }));
    expect(screen.getByTestId('workspace-toggle-files')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('workspace-toggle-customizations')).toHaveAttribute('data-collapsed', 'false');
  });

  it('opens settings and the command palette via their controls', async () => {
    const onOpenSettings = vi.fn();
    const onOpenCommandPalette = vi.fn();
    renderWithShell(<TopNav onOpenSettings={onOpenSettings} onOpenCommandPalette={onOpenCommandPalette} />);
    await userEvent.click(screen.getByTestId('nav-settings'));
    await userEvent.click(screen.getByTestId('command-palette-trigger'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });
  it('no longer renders the OGS brand line (moved to the footer)', () => {
    renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.queryByText(/TECNOLOGIA BRASIL/i)).not.toBeInTheDocument();
  });
  it('no longer renders the sync pill (moved to the status bar)', () => {
    renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.queryByTestId('status-pill-sync')).not.toBeInTheDocument();
  });
  it('renders the ⌘K trigger as a search field', () => {
    renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.getByTestId('command-palette-trigger')).toHaveTextContent('Buscar ou ir para…⌘K');
  });
  it('toggles the theme through useThemeMode', async () => {
    renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
    await userEvent.click(screen.getByTestId('theme-toggle'));
    expect(call).toHaveBeenCalledWith('settings.merge', expect.objectContaining({ ui: expect.any(Object) }));
  });

  describe('global browser button', () => {
    it('opens a blank browser tab via IPC and registers it in the store', async () => {
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.list') return ok([]);
        if (method === 'workspace.getActive') return ok(null);
        if (method === 'browser.openTab') return ok({ tabId: 'tab-1' });
        return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
      });
      renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);

      await userEvent.click(screen.getByTestId('nav-browser-toggle'));

      await waitFor(() => expect(call).toHaveBeenCalledWith('browser.openTab', {}));
      expect(getBrowserTabsSnapshot().tabs).toEqual([{ tabId: 'tab-1', url: '' }]);
    });
  });

  describe('history back/forward', () => {
    it('renders both buttons disabled when there is no Workbench history', () => {
      renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
      expect(screen.getByTestId('nav-history-back')).toBeDisabled();
      expect(screen.getByTestId('nav-history-forward')).toBeDisabled();
    });

    it('enables back once the history store has an earlier entry to go to', () => {
      registerWorkspaceHistoryApplier(vi.fn());
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', activeTabId: null });
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', activeTabId: 'a1' });
      renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
      expect(screen.getByTestId('nav-history-back')).toBeEnabled();
      expect(screen.getByTestId('nav-history-forward')).toBeDisabled();
    });

    it('clicking back calls the registered applier with the previous entry', async () => {
      const applier = vi.fn().mockResolvedValue('applied');
      registerWorkspaceHistoryApplier(applier);
      const scopeEntry = { workspaceId: 'w1', activeTabId: null };
      pushWorkspaceHistoryEntry(scopeEntry);
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', activeTabId: 'a1' });
      renderWithShell(<TopNav onOpenSettings={noop} onOpenCommandPalette={noop} />);
      await userEvent.click(screen.getByTestId('nav-history-back'));
      expect(applier).toHaveBeenCalledWith(scopeEntry);
    });
  });
});
