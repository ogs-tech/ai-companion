import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { registerUnsavedTabsGuard } from '../../../../src/renderer/lib/workspace-tabs-guard.js';
import { WorkspaceManagementList } from '../../../../src/renderer/components/workspace/WorkspaceManagementList.js';
import { renderWithQuery } from '../../test-utils.js';

const renderList = (appAreaRows?: React.ReactNode) =>
  renderWithQuery(<WorkspaceManagementList {...(appAreaRows !== undefined ? { appAreaRows } : {})} />, { client: queryClient });

const workspaces = [
  { id: 'w2', name: 'Bravo', rootPath: '/repos/bravo', createdAt: '' },
  { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '' },
];

const mockIpc = (overrides: Record<string, unknown> = {}) =>
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method in overrides) {
      const value = overrides[method];
      if (value instanceof Error) throw value;
      return value;
    }
    if (method === 'workspace.list') return workspaces;
    if (method === 'workspace.getActive') return null;
    return undefined;
  });

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  mockIpc();
});

afterEach(() => {
  registerUnsavedTabsGuard(null);
});

describe('WorkspaceManagementList', () => {
  it('lists the workspaces alphabetically under a "Workspaces" section', async () => {
    renderList();
    expect(await screen.findByTestId('workspace-list-row-w1')).toHaveTextContent('Acme');
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^workspace-list-row-/);
    expect(rows.map((r) => r.textContent)).toEqual(['Acme', 'Bravo']);
  });

  it('renders the app rows under an "App" section', async () => {
    renderList(<div data-testid="app-rows-slot">Diagnóstico</div>);
    expect(await screen.findByTestId('app-rows-slot')).toBeInTheDocument();
    expect(screen.getByText('App')).toBeInTheDocument();
  });

  it('has no always-visible delete action on a row', async () => {
    renderList();
    await screen.findByTestId('workspace-list-row-w1');
    expect(screen.queryByTestId('workspace-list-delete-w1')).not.toBeInTheDocument();
  });

  it('switches to a workspace on row click', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' }));
  });

  it('does not switch when the unsaved-tabs guard declines', async () => {
    const user = userEvent.setup();
    registerUnsavedTabsGuard(() => false);
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w1'));
    expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });

  describe('row context menu', () => {
    it('"Abrir" switches to the workspace', async () => {
      renderList();
      fireEvent.contextMenu(await screen.findByTestId('workspace-list-row-w1'));
      fireEvent.click(await screen.findByTestId('row-context-menu-open'));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' }));
    });

    it('"Revelar no Finder" reveals the workspace root by id', async () => {
      renderList();
      fireEvent.contextMenu(await screen.findByTestId('workspace-list-row-w1'));
      fireEvent.click(await screen.findByTestId('row-context-menu-reveal'));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('openWith.revealWorkspace', { id: 'w1' }));
    });

    it('"Remover…" asks for confirmation before deleting', async () => {
      const user = userEvent.setup();
      renderList();
      fireEvent.contextMenu(await screen.findByTestId('workspace-list-row-w1'));
      fireEvent.click(await screen.findByTestId('row-context-menu-remove'));
      expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.delete', expect.anything());
      await user.click(await screen.findByRole('button', { name: /remover/i }));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.delete', { id: 'w1' }));
    });
  });

  describe('"Abrir pasta"', () => {
    it('picks a folder, then opens it as a workspace', async () => {
      const user = userEvent.setup();
      mockIpc({
        'dialog.selectFolder': { canceled: false, path: '/repos/charlie' },
        'workspace.open': { id: 'w3', name: 'charlie', rootPath: '/repos/charlie', createdAt: '' },
      });
      renderList();
      await user.click(await screen.findByTestId('workspace-list-open-folder'));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.open', { path: '/repos/charlie' }));
    });

    it('does nothing when the picker is canceled', async () => {
      const user = userEvent.setup();
      mockIpc({ 'dialog.selectFolder': { canceled: true } });
      renderList();
      await user.click(await screen.findByTestId('workspace-list-open-folder'));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('dialog.selectFolder', {}));
      expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.open', expect.anything());
    });

    it('shows an error toast when opening fails', async () => {
      const user = userEvent.setup();
      mockIpc({ 'dialog.selectFolder': { canceled: false, path: '/home/u' }, 'workspace.open': new Error('home dir') });
      renderList();
      await user.click(await screen.findByTestId('workspace-list-open-folder'));
      expect(await screen.findByTestId('toast')).toHaveTextContent('home dir');
    });

    it('is the empty state\'s action when there are no workspaces', async () => {
      mockIpc({ 'workspace.list': [] });
      renderList();
      expect(await screen.findByTestId('empty-state-workspace-management-empty')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-list-empty-open-folder')).toBeInTheDocument();
    });
  });
});
