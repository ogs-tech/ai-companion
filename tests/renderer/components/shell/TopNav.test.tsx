import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopNav } from '../../../../src/renderer/components/shell/TopNav.js';
import {
  pushWorkspaceHistoryEntry,
  registerWorkspaceHistoryApplier,
  resetWorkspaceHistoryForTests,
} from '../../../../src/renderer/lib/workspace-history-store.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.list') return ok([]);
    if (method === 'workspace.getActive') return ok(undefined);
    return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
  });
});

afterEach(() => {
  resetWorkspaceHistoryForTests();
});

const noop = () => undefined;

describe('TopNav', () => {
  it('renders the four primary area tabs', () => {
    renderWithShell(<TopNav active="starter-pack" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.getByTestId('nav-starter-pack')).toBeInTheDocument();
    expect(screen.getByTestId('nav-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('nav-marketplaces')).toBeInTheDocument();
    expect(screen.getByTestId('nav-diagnostico')).toBeInTheDocument();
  });
  it('selects an area on click', async () => {
    const onSelectArea = vi.fn();
    renderWithShell(<TopNav active="starter-pack" onSelectArea={onSelectArea} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    await userEvent.click(screen.getByTestId('nav-workspace'));
    expect(onSelectArea).toHaveBeenCalledWith('workspace');
  });
  it('calls onSelectArea even when clicking the already-active tab (MUI mutes Tabs.onChange there, so each Tab needs its own onClick — this is what lets the Workspace tab act as a "go home" gesture from any of its sub-screens)', async () => {
    const onSelectArea = vi.fn();
    renderWithShell(<TopNav active="workspace" onSelectArea={onSelectArea} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    await userEvent.click(screen.getByTestId('nav-workspace'));
    expect(onSelectArea).toHaveBeenCalledWith('workspace');
  });
  it('opens settings and the command palette via their controls', async () => {
    const onOpenSettings = vi.fn();
    const onOpenCommandPalette = vi.fn();
    renderWithShell(<TopNav active="starter-pack" onSelectArea={noop} onOpenSettings={onOpenSettings} onOpenCommandPalette={onOpenCommandPalette} />);
    await userEvent.click(screen.getByTestId('nav-settings'));
    await userEvent.click(screen.getByTestId('command-palette-trigger'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });
  it('marks only the active area tab as selected (the CSS underline anchor)', () => {
    renderWithShell(<TopNav active="marketplaces" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.getByTestId('nav-marketplaces')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('nav-starter-pack')).toHaveAttribute('aria-selected', 'false');
  });
  it('no longer renders the OGS brand line (moved to the footer)', () => {
    renderWithShell(<TopNav active="starter-pack" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.queryByText(/TECNOLOGIA BRASIL/i)).not.toBeInTheDocument();
  });
  it('shows the sync StatusPill carrying the health severity', () => {
    renderWithShell(<TopNav active="starter-pack" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} healthSeverity="error" />);
    expect(screen.getByTestId('status-pill-sync')).toHaveAttribute('data-variant', 'error');
  });
  it('clicking the sync StatusPill navigates to Diagnóstico', async () => {
    const onSelectArea = vi.fn();
    renderWithShell(<TopNav active="starter-pack" onSelectArea={onSelectArea} onOpenSettings={noop} onOpenCommandPalette={noop} healthSeverity="error" />);
    await userEvent.click(screen.getByTestId('status-pill-sync'));
    expect(onSelectArea).toHaveBeenCalledWith('diagnostico');
  });
  it('toggles the theme through useThemeMode', async () => {
    renderWithShell(<TopNav active="starter-pack" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    await userEvent.click(screen.getByTestId('theme-toggle'));
    expect(call).toHaveBeenCalledWith('settings.merge', expect.objectContaining({ ui: expect.any(Object) }));
  });

  describe('history back/forward', () => {
    it('renders both buttons disabled when there is no Workbench history', () => {
      renderWithShell(<TopNav active="workspace" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
      expect(screen.getByTestId('nav-history-back')).toBeDisabled();
      expect(screen.getByTestId('nav-history-forward')).toBeDisabled();
    });

    it('enables back once the history store has an earlier entry to go to', () => {
      registerWorkspaceHistoryApplier(vi.fn());
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', projectId: null, activeTabId: null });
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', projectId: null, activeTabId: 'a1' });
      renderWithShell(<TopNav active="workspace" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
      expect(screen.getByTestId('nav-history-back')).toBeEnabled();
      expect(screen.getByTestId('nav-history-forward')).toBeDisabled();
    });

    it('stays disabled while no WorkspaceScreen applier is registered, even outside the Workspace area', () => {
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', projectId: null, activeTabId: null });
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', projectId: null, activeTabId: 'a1' });
      renderWithShell(<TopNav active="starter-pack" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
      expect(screen.getByTestId('nav-history-back')).toBeDisabled();
    });

    it('clicking back calls the registered applier with the previous entry', async () => {
      const applier = vi.fn().mockResolvedValue('applied');
      registerWorkspaceHistoryApplier(applier);
      const scopeEntry = { workspaceId: 'w1', projectId: null, activeTabId: null };
      pushWorkspaceHistoryEntry(scopeEntry);
      pushWorkspaceHistoryEntry({ workspaceId: 'w1', projectId: null, activeTabId: 'a1' });
      renderWithShell(<TopNav active="workspace" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
      await userEvent.click(screen.getByTestId('nav-history-back'));
      expect(applier).toHaveBeenCalledWith(scopeEntry);
    });
  });
});
