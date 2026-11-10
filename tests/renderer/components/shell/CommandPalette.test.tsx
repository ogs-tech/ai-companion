import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../../../../src/renderer/components/shell/CommandPalette.js';
import { registerAreaOpener } from '../../../../src/renderer/lib/workspace-area-store.js';
import { registerPaletteActions } from '../../../../src/renderer/lib/palette-actions-store.js';
import { registerWorkspaceShellCommands } from '../../../../src/renderer/lib/workspace-shell-store.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
const OTHER_WORKSPACE = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '' };

const noop = () => undefined;
let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

afterEach(() => {
  registerAreaOpener(null);
  registerWorkspaceShellCommands(null);
  registerPaletteActions(null);
});

const SESSION = {
  sessionId: 's1',
  harness: 'claude',
  conversationId: 'c1',
  anchor: { kind: 'personal' },
  cwd: '/home',
  label: 'Header e novo footer UI/UX',
  status: 'running',
  activity: 'needs-input',
  activitySince: 1,
  attention: { kind: 'question' },
  scopeId: null,
};
const SKILL = { urn: 'urn:skill:header-review', kind: 'skill', name: 'header-review', description: 'Reviews the app header', scopes: ['personal'], metadata: {} };

/** A mock where the lists the unified search reads are populated. */
function mockSearchData(extra: Record<string, unknown> = {}): void {
  call.mockImplementation(async (method: string) => {
    if (method in extra) return ok(extra[method]);
    if (method === 'session.list') return ok([SESSION]);
    if (method === 'skill.list') return ok([SKILL]);
    if (method === 'agent.list') return ok([]);
    if (method === 'session.availableHarnesses') return ok(['claude']);
    return ok(null);
  });
}

describe('CommandPalette', () => {
  it('is hidden when closed', () => {
    call.mockImplementation(async () => ok(null));
    renderWithShell(<CommandPalette open={false} onClose={noop} />);
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('filters commands by query and opens the Marketplaces Workbench tab on select', async () => {
    call.mockImplementation(async () => ok(null));
    const opener = vi.fn();
    registerAreaOpener(opener);
    const onClose = vi.fn();
    renderWithShell(<CommandPalette open onClose={onClose} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    const input = screen.getByTestId('command-palette-input');
    await userEvent.type(input, 'marketplaces');
    await userEvent.click(screen.getByTestId('command-go-marketplaces'));

    expect(opener).toHaveBeenCalledWith('marketplaces');
    expect(onClose).toHaveBeenCalled();
  });

  it('jumps back to the Início via its "Início" quick-jump entry', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(OTHER_WORKSPACE);
      if (method === 'workspace.goHome') return ok(undefined);
      return ok(undefined);
    });
    renderWithShell(<CommandPalette open onClose={noop} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    await userEvent.type(screen.getByTestId('command-palette-input'), 'Início');
    await userEvent.click(screen.getByText('Ir para Início'));

    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.goHome', {}));
  });

  it('"Visão geral" focuses the overview tab', async () => {
    call.mockImplementation(async () => ok(null));
    const focusOverview = vi.fn();
    registerWorkspaceShellCommands({ focusOverview, togglePanel: vi.fn() });
    renderWithShell(<CommandPalette open onClose={noop} />);

    await userEvent.click(await screen.findByTestId('command-overview'));

    expect(focusOverview).toHaveBeenCalled();
  });

  it('"Abrir pasta…" picks a folder and opens it as a workspace', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'dialog.selectFolder') return ok({ canceled: false, path: '/repos/acme' });
      if (method === 'workspace.open') return ok(OTHER_WORKSPACE);
      return ok(null);
    });
    renderWithShell(<CommandPalette open onClose={noop} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    await userEvent.click(screen.getByTestId('command-open-folder'));

    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.open', { path: '/repos/acme' }));
  });

  it('"Ir para workspace…" lists the workspaces and switches to the chosen one', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return ok([OTHER_WORKSPACE]);
      if (method === 'workspace.switchTo') return ok(OTHER_WORKSPACE);
      return ok(null);
    });
    const onClose = vi.fn();
    renderWithShell(<CommandPalette open onClose={onClose} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    await userEvent.click(screen.getByTestId('command-go-to-workspace'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByTestId('command-workspace-w1'));

    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' }));
    expect(onClose).toHaveBeenCalled();
  });
  describe('unified search', () => {
    it('shows live sessions and the prefix hints when nothing is typed', async () => {
      mockSearchData();
      renderWithShell(<CommandPalette open onClose={noop} />);

      expect(await screen.findByTestId('palette-session-s1')).toBeInTheDocument();
      expect(screen.getByText('Em andamento')).toBeInTheDocument();
      expect(screen.getByTestId('palette-prefix-hints')).toBeInTheDocument();
      expect(screen.queryByTestId('palette-ask-ai')).toBeNull();
    });

    it('groups sessions and customizations for a term and ends with the ask-AI row', async () => {
      mockSearchData();
      renderWithShell(<CommandPalette open onClose={noop} />);
      await screen.findByTestId('palette-session-s1');

      await userEvent.type(screen.getByTestId('command-palette-input'), 'header');

      expect(await screen.findByTestId('palette-entity-urn:skill:header-review')).toBeInTheDocument();
      expect(screen.getByTestId('palette-session-s1')).toBeInTheDocument();
      expect(screen.getByTestId('palette-ask-ai')).toHaveTextContent('Perguntar ao Claude: “header”');
    });

    it('opens a session through the registered action when its row is clicked', async () => {
      mockSearchData();
      const openSession = vi.fn();
      registerPaletteActions({ openSession, openEntity: vi.fn(), startSession: vi.fn() });
      const onClose = vi.fn();
      renderWithShell(<CommandPalette open onClose={onClose} />);

      await userEvent.click(await screen.findByTestId('palette-session-s1'));

      expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', scopeId: null }));
      expect(onClose).toHaveBeenCalled();
    });

    it('opens a skill through the registered action', async () => {
      mockSearchData();
      const openEntity = vi.fn();
      registerPaletteActions({ openSession: vi.fn(), openEntity, startSession: vi.fn() });
      renderWithShell(<CommandPalette open onClose={noop} />);
      await screen.findByTestId('palette-session-s1');

      await userEvent.type(screen.getByTestId('command-palette-input'), 'header-review');
      await userEvent.click(await screen.findByTestId('palette-entity-urn:skill:header-review'));

      expect(openEntity).toHaveBeenCalledWith('skill', expect.objectContaining({ name: 'header-review' }));
    });

    it('Enter on free text with no direct match asks the AI', async () => {
      mockSearchData();
      const startSession = vi.fn();
      registerPaletteActions({ openSession: vi.fn(), openEntity: vi.fn(), startSession });
      const onClose = vi.fn();
      renderWithShell(<CommandPalette open onClose={onClose} />);
      await screen.findByTestId('palette-session-s1');

      await userEvent.type(screen.getByTestId('command-palette-input'), 'zzqq como faço deploy{Enter}');

      expect(startSession).toHaveBeenCalledWith({ prompt: 'zzqq como faço deploy', channel: 'claude' });
      expect(onClose).toHaveBeenCalled();
    });

    it('Ctrl+Enter asks the AI even when a result is selected', async () => {
      mockSearchData();
      const startSession = vi.fn();
      const openSession = vi.fn();
      registerPaletteActions({ openSession, openEntity: vi.fn(), startSession });
      renderWithShell(<CommandPalette open onClose={noop} />);
      await screen.findByTestId('palette-session-s1');

      await userEvent.type(screen.getByTestId('command-palette-input'), 'header{Control>}{Enter}{/Control}');

      expect(startSession).toHaveBeenCalledWith({ prompt: 'header', channel: 'claude' });
      expect(openSession).not.toHaveBeenCalled();
    });

    it('arrow keys move the selection and Enter runs the selected row', async () => {
      mockSearchData();
      const openSession = vi.fn();
      const openEntity = vi.fn();
      registerPaletteActions({ openSession, openEntity, startSession: vi.fn() });
      renderWithShell(<CommandPalette open onClose={noop} />);
      await screen.findByTestId('palette-session-s1');

      await userEvent.type(screen.getByTestId('command-palette-input'), 'header{ArrowDown}{Enter}');

      // Sessions come first (selected by default), so one ArrowDown lands on the skill.
      expect(openEntity).toHaveBeenCalledWith('skill', expect.objectContaining({ name: 'header-review' }));
      expect(openSession).not.toHaveBeenCalled();
    });

    it('the "#" prefix narrows the search to sessions only', async () => {
      mockSearchData();
      renderWithShell(<CommandPalette open onClose={noop} />);
      await screen.findByTestId('palette-session-s1');

      await userEvent.type(screen.getByTestId('command-palette-input'), '#header');

      expect(screen.getByTestId('palette-session-s1')).toBeInTheDocument();
      expect(screen.queryByTestId('palette-entity-urn:skill:header-review')).toBeNull();
      expect(screen.queryByTestId('palette-ask-ai')).toBeNull();
    });

    it('a prefix chip fills the prefix into the input', async () => {
      mockSearchData();
      renderWithShell(<CommandPalette open onClose={noop} />);

      await userEvent.click(await screen.findByRole('button', { name: 'Filtrar por sessões' }));

      expect(screen.getByTestId('command-palette-input')).toHaveValue('#');
    });

    it('names where the question goes in the context chip', async () => {
      mockSearchData({ 'workspace.getActive': OTHER_WORKSPACE });
      renderWithShell(<CommandPalette open onClose={noop} />);

      await waitFor(() => expect(screen.getByTestId('palette-context-chip')).toHaveTextContent('Acme · Claude'));
    });
  });
});
