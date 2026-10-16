import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextSwitcher } from '../../../../src/renderer/components/shell/ContextSwitcher.js';
import { registerWorkspaceShellCommands } from '../../../../src/renderer/lib/workspace-shell-store.js';
import { registerUnsavedTabsGuard } from '../../../../src/renderer/lib/workspace-tabs-guard.js';
import { recentWorkspaces } from '../../../../src/renderer/hooks/use-context-navigation.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { Workspace } from '../../../../src/shared/workspace.js';

const ACME: Workspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '', lastOpenedAt: '2026-10-10T10:00:00.000Z' };
const BRAVO: Workspace = { id: 'w2', name: 'Bravo', rootPath: '/repos/bravo', createdAt: '', lastOpenedAt: '2026-10-11T10:00:00.000Z' };
const CHARLIE: Workspace = { id: 'w3', name: 'Charlie', rootPath: '/repos/charlie', createdAt: '' };

let call: CallSpy;

const setup = (active: Workspace | null, extra: Record<string, unknown> = {}) => {
  call.mockImplementation(async (method: string) => {
    if (method in extra) return ok(extra[method]);
    if (method === 'workspace.list') return ok([ACME, BRAVO, CHARLIE]);
    if (method === 'workspace.getActive') return ok(active);
    return ok(undefined);
  });
  renderWithShell(<ContextSwitcher />);
};

const openMenu = async (user: ReturnType<typeof userEvent.setup>, label: RegExp): Promise<HTMLElement> => {
  await user.click(await screen.findByRole('button', { name: label }));
  return screen.findByTestId('context-switcher-menu');
};

beforeEach(() => {
  call = mockApi();
});

afterEach(() => {
  registerWorkspaceShellCommands(null);
  registerUnsavedTabsGuard(null);
});

describe('recentWorkspaces', () => {
  it('orders by lastOpenedAt, newest first, never-opened last, excluding the current one', () => {
    expect(recentWorkspaces([ACME, CHARLIE, BRAVO], null).map((w) => w.id)).toEqual(['w2', 'w1', 'w3']);
    expect(recentWorkspaces([ACME, CHARLIE, BRAVO], 'w2').map((w) => w.id)).toEqual(['w1', 'w3']);
  });

  it('caps the list', () => {
    expect(recentWorkspaces([ACME, BRAVO, CHARLIE], null, 2)).toHaveLength(2);
  });
});

describe('ContextSwitcher', () => {
  it('shows "Início" at Início', async () => {
    setup(null);
    expect(await screen.findByRole('button', { name: /Contexto: Início/ })).toBeInTheDocument();
  });

  it("shows the open workspace's name", async () => {
    setup(ACME);
    expect(await screen.findByRole('button', { name: /Contexto: Acme/ })).toBeInTheDocument();
  });

  it('lists recents by lastOpenedAt, excluding the current workspace', async () => {
    const user = userEvent.setup();
    setup(ACME);
    const menu = await openMenu(user, /Contexto: Acme/);
    const recents = within(menu).getAllByTestId(/^context-switcher-recent-/);
    expect(recents.map((r) => r.getAttribute('data-testid'))).toEqual(['context-switcher-recent-w2', 'context-switcher-recent-w3']);
  });

  it('switches to a recent workspace through the unsaved-tabs guard', async () => {
    const user = userEvent.setup();
    const guard = vi.fn(() => true);
    registerUnsavedTabsGuard(guard);
    setup(null, { 'workspace.switchTo': BRAVO });
    await openMenu(user, /Contexto: Início/);
    await user.click(await screen.findByTestId('context-switcher-recent-w2'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'w2' }));
    expect(guard).toHaveBeenCalled();
  });

  it('does not switch when the guard declines', async () => {
    const user = userEvent.setup();
    registerUnsavedTabsGuard(() => false);
    setup(null);
    await openMenu(user, /Contexto: Início/);
    await user.click(await screen.findByTestId('context-switcher-recent-w2'));
    expect(call).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });

  it('lists every workspace alphabetically in the "Todos os workspaces" submenu', async () => {
    const user = userEvent.setup();
    setup(null);
    await openMenu(user, /Contexto: Início/);
    await user.click(screen.getByTestId('context-switcher-all'));
    const submenu = await screen.findByTestId('context-switcher-all-menu');
    expect(within(submenu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Acme', 'Bravo', 'Charlie']);
  });

  it('"Abrir pasta…" picks a folder, then opens it', async () => {
    const user = userEvent.setup();
    setup(null, { 'dialog.selectFolder': { canceled: false, path: '/repos/delta' }, 'workspace.open': ACME });
    await openMenu(user, /Contexto: Início/);
    await user.click(screen.getByTestId('context-switcher-open-folder'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.open', { path: '/repos/delta' }));
  });

  it('"Abrir pasta…" canceled is a no-op', async () => {
    const user = userEvent.setup();
    setup(null, { 'dialog.selectFolder': { canceled: true } });
    await openMenu(user, /Contexto: Início/);
    await user.click(screen.getByTestId('context-switcher-open-folder'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('dialog.selectFolder', {}));
    expect(call).not.toHaveBeenCalledWith('workspace.open', expect.anything());
  });

  it('"Abrir pasta…" shows the error toast when opening is rejected', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return ok([]);
      if (method === 'workspace.getActive') return ok(null);
      if (method === 'dialog.selectFolder') return ok({ canceled: false, path: '/home/u' });
      if (method === 'workspace.open') return { ok: false, error: { kind: 'validation', message: 'home dir is Global' } };
      return ok(undefined);
    });
    renderWithShell(<ContextSwitcher />);
    await openMenu(user, /Contexto: Início/);
    await user.click(screen.getByTestId('context-switcher-open-folder'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('home dir is Global');
  });

  it('offers no remove action at Início', async () => {
    const user = userEvent.setup();
    setup(null);
    await openMenu(user, /Contexto: Início/);
    expect(screen.queryByTestId('context-switcher-remove')).not.toBeInTheDocument();
  });

  it('removes the open workspace only after the confirm dialog', async () => {
    const user = userEvent.setup();
    setup(ACME);
    await openMenu(user, /Contexto: Acme/);
    await user.click(screen.getByTestId('context-switcher-remove'));
    expect(call).not.toHaveBeenCalledWith('workspace.delete', expect.anything());
    await user.click(await screen.findByRole('button', { name: /^remover$/i }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.delete', { id: 'w1' }));
  });

  it('clicking the context already open focuses its Visão geral instead of switching', async () => {
    const user = userEvent.setup();
    const focusOverview = vi.fn();
    registerWorkspaceShellCommands({ focusOverview, togglePanel: vi.fn() });
    setup(null);
    await openMenu(user, /Contexto: Início/);
    await user.click(screen.getByTestId('context-switcher-home'));
    expect(focusOverview).toHaveBeenCalled();
    expect(call).not.toHaveBeenCalledWith('workspace.goHome', expect.anything());
  });
});
