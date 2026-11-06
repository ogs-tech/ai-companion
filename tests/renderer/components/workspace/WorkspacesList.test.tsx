import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { registerUnsavedTabsGuard } from '../../../../src/renderer/lib/workspace-tabs-guard.js';
import { WorkspacesList } from '../../../../src/renderer/components/workspace/WorkspacesList.js';
import { renderWithQuery } from '../../test-utils.js';

const onOpenWorkspaces = vi.fn();

const renderList = (limit?: number) =>
  renderWithQuery(<WorkspacesList onOpenWorkspaces={onOpenWorkspaces} {...(limit !== undefined ? { limit } : {})} />, { client: queryClient });

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

describe('WorkspacesList', () => {
  it('lists workspaces newest first with their relative time', async () => {
    renderList();
    await screen.findByTestId('workspace-list-row-w2');
    const rows = screen.getAllByTestId(/^workspace-list-row-/);
    ['Bravo', 'Charlie', 'Acme', 'Delta'].forEach((name, i) => expect(rows[i]).toHaveTextContent(name));
    expect(screen.getByTestId('workspace-list-time-w2').textContent).not.toBe('');
  });

  it('caps the list and offers "Ver todos (n)…" that opens the Workspaces page', async () => {
    const user = userEvent.setup();
    renderList(3);
    await screen.findByTestId('workspace-list-row-w2');
    expect(screen.getAllByTestId(/^workspace-list-row-/)).toHaveLength(3);
    await user.click(screen.getByTestId('workspaces-see-all'));
    expect(screen.getByTestId('workspaces-see-all')).toHaveTextContent('Ver todos (4)…');
    expect(onOpenWorkspaces).toHaveBeenCalledOnce();
  });

  it('searches across every workspace, past the cap', async () => {
    const user = userEvent.setup();
    renderList(2);
    await screen.findByTestId('workspace-list-row-w2');
    await user.type(screen.getByTestId('workspaces-search'), 'delt');
    expect(screen.getAllByTestId(/^workspace-list-row-/)).toHaveLength(1);
    expect(screen.getByTestId('workspace-list-row-w4')).toBeInTheDocument();
    expect(screen.queryByTestId('workspaces-see-all')).not.toBeInTheDocument();
  });

  it('shows an empty message when nothing matches', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByTestId('workspace-list-row-w2');
    await user.type(screen.getByTestId('workspaces-search'), 'zzz');
    expect(screen.getByTestId('workspaces-empty')).toBeInTheDocument();
  });

  it('has no app destinations in the body — those live in the rail', async () => {
    renderList();
    await screen.findByTestId('workspace-list-row-w2');
    expect(screen.queryByTestId('explorer-area-workspaces')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('switches to a workspace on click', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w2'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w2' }));
  });

  it('does not switch when the unsaved-tabs guard declines', async () => {
    const user = userEvent.setup();
    registerUnsavedTabsGuard(async () => false);
    renderList();
    await user.click(await screen.findByTestId('workspace-list-row-w2'));
    expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });
});
