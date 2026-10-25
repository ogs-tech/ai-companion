import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { registerUnsavedTabsGuard } from '../../../../src/renderer/lib/workspace-tabs-guard.js';
import { HomeNavList } from '../../../../src/renderer/components/workspace/HomeNavList.js';
import { renderWithQuery } from '../../test-utils.js';

const onOpenWorkspaces = vi.fn();

const renderList = (props: { workspacesActive?: boolean } = {}) =>
  renderWithQuery(
    <HomeNavList
      workspacesActive={props.workspacesActive ?? false}
      onOpenWorkspaces={onOpenWorkspaces}
      appAreaRows={<div data-testid="app-rows-slot">Diagnóstico</div>}
    />,
    { client: queryClient },
  );

const workspaces = [
  { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '', lastOpenedAt: '2026-10-01T10:00:00.000Z' },
  { id: 'w2', name: 'Bravo', rootPath: '/repos/bravo', createdAt: '', lastOpenedAt: '2026-10-03T10:00:00.000Z' },
  { id: 'w3', name: 'Charlie', rootPath: '/repos/charlie', createdAt: '', lastOpenedAt: '2026-10-02T10:00:00.000Z' },
  { id: 'w4', name: 'Delta', rootPath: '/repos/delta', createdAt: '', lastOpenedAt: '2026-09-01T10:00:00.000Z' },
];

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method === 'workspace.list') return workspaces;
    if (method === 'workspace.getActive') return null;
    return undefined;
  });
});

afterEach(() => {
  registerUnsavedTabsGuard(null);
});

describe('HomeNavList', () => {
  it('has no "App" or "Workspaces" section header — only menu rows', async () => {
    renderList();
    await screen.findByTestId('workspace-list-row-w2');
    expect(screen.queryByText('App')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-list-open-folder')).not.toBeInTheDocument();
    expect(screen.getByTestId('explorer-area-workspaces')).toHaveTextContent('Workspaces');
  });

  it('lists the 3 most recently opened workspaces, newest first', async () => {
    renderList();
    await screen.findByTestId('workspace-list-row-w2');
    const rows = screen.getAllByTestId(/^workspace-list-row-/);
    expect(rows.map((r) => r.textContent)).toEqual(['Bravo', 'Charlie', 'Acme']);
  });

  it('renders the app rows after the divider', async () => {
    renderList();
    expect(await screen.findByTestId('app-rows-slot')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('has no Início row — the overview is the pinned canvas tab', async () => {
    renderList();
    await screen.findByTestId('workspace-list-row-w2');
    expect(screen.queryByTestId('explorer-area-overview')).not.toBeInTheDocument();
  });

  it('opens the Workspaces page from its row', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByTestId('explorer-area-workspaces'));
    expect(onOpenWorkspaces).toHaveBeenCalledOnce();
  });

  it('switches to a recent workspace on click', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w2'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w2' }));
  });

  it('does not switch when the unsaved-tabs guard declines', async () => {
    const user = userEvent.setup();
    registerUnsavedTabsGuard(() => false);
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w2'));
    expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });
});
