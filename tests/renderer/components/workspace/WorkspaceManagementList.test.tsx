import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { WorkspaceManagementList } from '../../../../src/renderer/components/workspace/WorkspaceManagementList.js';
import { renderWithQuery } from '../../test-utils.js';

const renderList = (beforeSwitch?: () => boolean, instructionRow?: React.ReactNode) =>
  renderWithQuery(
    <WorkspaceManagementList
      {...(beforeSwitch ? { beforeSwitch } : {})}
      {...(instructionRow !== undefined ? { instructionRow } : {})}
    />,
    { client: queryClient },
  );

const workspaces = [
  { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' },
  { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' },
];

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method === 'workspace.list') return workspaces;
    return undefined;
  });
});

describe('WorkspaceManagementList', () => {
  it('lists project workspaces up front, with no menu to open first', async () => {
    renderList();
    expect(await screen.findByTestId('workspace-list-row-w1')).toHaveTextContent('Acme');
  });

  it('renders the instructionRow slot pinned above the workspace list', async () => {
    renderList(undefined, <div data-testid="instruction-row-slot">Instructions</div>);
    expect(await screen.findByTestId('instruction-row-slot')).toBeInTheDocument();
    expect(await screen.findByTestId('workspace-list-row-w1')).toBeInTheDocument();
  });

  it('renders the instructionRow slot even when there are no other workspaces (empty state)', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return [workspaces[0]];
      return undefined;
    });
    renderList(undefined, <div data-testid="instruction-row-slot">Instructions</div>);
    expect(await screen.findByTestId('instruction-row-slot')).toBeInTheDocument();
    expect(await screen.findByTestId('empty-state-workspace-management-empty')).toBeInTheDocument();
  });

  it('never lists the default/global workspace — the screen around it already shows that', async () => {
    renderList();
    await screen.findByTestId('workspace-list-row-w1');
    expect(screen.queryByTestId('workspace-list-row-default')).not.toBeInTheDocument();
  });

  it('clicking a row switches to it', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' }));
  });

  it('does not switch when beforeSwitch declines', async () => {
    const user = userEvent.setup();
    const beforeSwitch = vi.fn().mockReturnValue(false);
    renderList(beforeSwitch);
    await user.click(await screen.findByTestId('workspace-list-row-w1'));
    expect(beforeSwitch).toHaveBeenCalled();
    expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });

  it('switches when beforeSwitch allows it', async () => {
    const user = userEvent.setup();
    const beforeSwitch = vi.fn().mockReturnValue(true);
    renderList(beforeSwitch);
    await user.click(await screen.findByTestId('workspace-list-row-w1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' }));
  });

  it('clicking the delete action removes a workspace', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByTestId('workspace-list-delete-w1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.delete', { id: 'w1' }));
  });

  it('"Novo workspace" opens the folder picker and creates a workspace named after the folder', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return workspaces;
      if (method === 'dialog.selectFolder') return { canceled: false, path: '/repos/client-x' };
      if (method === 'workspace.create') return { id: 'w2', name: 'client-x', rootPath: '/repos/client-x', isDefault: false, createdAt: '' };
      return undefined;
    });
    renderList();
    await user.click(await screen.findByTestId('workspace-list-new'));
    await waitFor(() =>
      expect(ipc.callIpc).toHaveBeenCalledWith('workspace.create', { name: 'client-x', rootPath: '/repos/client-x' }),
    );
  });

  it('shows an error toast when creating a workspace fails', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return workspaces;
      if (method === 'dialog.selectFolder') return { canceled: false, path: '/repos/client-x' };
      if (method === 'workspace.create') throw new Error('disk full');
      return undefined;
    });
    renderList();
    await user.click(await screen.findByTestId('workspace-list-new'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('disk full');
  });

  it('shows an EmptyState with the create action when there are no other workspaces', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return [workspaces[0]];
      return undefined;
    });
    renderList();
    expect(await screen.findByTestId('empty-state-workspace-management-empty')).toHaveTextContent('Nenhum outro workspace');
    expect(screen.getByTestId('workspace-list-new')).toBeInTheDocument();
  });

  it('shows a running-session badge on a workspace row with an active session', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return workspaces;
      if (method === 'session.list') {
        return [
          {
            sessionId: 'workspace:w1',
            anchor: { kind: 'workspace', workspaceId: 'w1' },
            cwd: '/repos/acme',
            label: 'Acme',
            status: 'running',
          },
        ];
      }
      return undefined;
    });
    renderList();
    const row = await screen.findByTestId('workspace-list-row-w1');
    await waitFor(() => expect(row).toHaveTextContent('Ativa'));
  });

  it('shows an error toast when switching fails', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return workspaces;
      if (method === 'workspace.switchTo') throw new Error('boom');
      return undefined;
    });
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w1'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
  });
});
