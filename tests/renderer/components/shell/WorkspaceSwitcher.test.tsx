import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { WorkspaceSwitcher } from '../../../../src/renderer/components/shell/WorkspaceSwitcher.js';

const renderSwitcher = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSwitcher />
    </QueryClientProvider>,
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
    if (method === 'workspace.getActive') return workspaces[0];
    return undefined;
  });
});

describe('WorkspaceSwitcher', () => {
  it('shows the active workspace name as the trigger label', async () => {
    renderSwitcher();
    await waitFor(() =>
      expect(screen.getByTestId('workspace-switcher-trigger')).toHaveTextContent('Default'),
    );
  });

  it('lists every other workspace with a switch action, opened via the trigger', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    expect(await screen.findByTestId('workspace-switch-w1')).toHaveTextContent('Acme');
  });

  it('clicking a non-active workspace calls workspace.switchTo', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    await user.click(await screen.findByTestId('workspace-switch-w1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' }));
  });

  it('does not render a delete action for the active workspace', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    await screen.findByTestId('workspace-switch-w1');
    expect(screen.queryByTestId('workspace-delete-default')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-delete-w1')).toBeInTheDocument();
  });

  it('"Novo workspace" opens the folder picker and creates a workspace named after the folder', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return workspaces;
      if (method === 'workspace.getActive') return workspaces[0];
      if (method === 'dialog.selectFolder') return { canceled: false, path: '/repos/client-x' };
      if (method === 'workspace.create') return { id: 'w2', name: 'client-x', rootPath: '/repos/client-x', isDefault: false, createdAt: '' };
      return undefined;
    });
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    await user.click(await screen.findByTestId('workspace-new'));
    await waitFor(() =>
      expect(ipc.callIpc).toHaveBeenCalledWith('workspace.create', { name: 'client-x', rootPath: '/repos/client-x' }),
    );
  });
});
