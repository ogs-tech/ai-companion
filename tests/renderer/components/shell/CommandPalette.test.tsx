import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../../../../src/renderer/components/shell/CommandPalette.js';
import { registerAreaOpener } from '../../../../src/renderer/lib/workspace-area-store.js';
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
});

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
    await userEvent.click(screen.getByText(/Marketplaces/i));

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
});
