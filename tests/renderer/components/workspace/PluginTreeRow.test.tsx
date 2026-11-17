import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginTreeRow } from '../../../../src/renderer/components/workspace/PluginTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { PluginListItemIpc } from '../../../../src/shared/plugin-ipc-types.js';
import { UndoableDeleteContext } from '../../../../src/renderer/hooks/use-undoable-delete.js';

const plugin: PluginListItemIpc = {
  id: 'local-plugin', origin: 'imported', scope: 'project', enabled: true, installedAt: '2026-05-01T00:00:00Z', installedRef: { kind: 'branch', value: 'main' },
};
const itemOf = (p: PluginListItemIpc, opts: { disabled?: boolean; origin?: 'local' | 'global' } = {}) =>
  treeItem({ kind: 'plugin', value: p, items: [] }, { urn: `urn:plugin:${p.id}`, name: p.id, ...opts });

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) =>
    method === 'plugin.get'
      ? ok({ ...plugin, manifest: { id: 'local-plugin', version: '1', artifacts: { skills: ['brainstorm'], agents: [], commands: [], hooks: 2, mcp: true, lsp: false } } })
      : ok(undefined),
  );
});

describe('PluginTreeRow', () => {
  it('toggling calls plugin.toggle with the item scope', async () => {
    const item = itemOf(plugin);
    renderWithShell(<PluginTreeRow item={item} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await userEvent.setup().click(await screen.findByTestId('tree-plugin-toggle-local-plugin'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('plugin.toggle', { id: 'local-plugin', scope: 'project', enabled: false }));
  });

  it('expands on click to render what it ships one level deeper, and says ativo', async () => {
    const child = treeItem({ kind: 'skill', value: { name: 'brainstorm' } as never }, { urn: 'urn:skill:brainstorm', name: 'brainstorm' });
    const item = treeItem({ kind: 'plugin', value: plugin, items: [child] }, { urn: `urn:plugin:${plugin.id}`, name: plugin.id });
    const renderChild = vi.fn((c: typeof child, depth: number) => <div key={c.key} data-testid={`child-${c.name}-${depth}`} />);
    renderWithShell(<PluginTreeRow item={item} depth={1} renderChild={renderChild} />);
    const rowEl = screen.getByTestId(rowId(item));
    expect(rowEl).toHaveTextContent('ativo');
    expect(screen.queryByTestId('child-brainstorm-2')).not.toBeInTheDocument();
    await userEvent.setup().click(rowEl);
    expect(screen.getByTestId('child-brainstorm-2')).toBeInTheDocument();
  });

  it('forceOpen lists its items without a click', () => {
    const child = treeItem({ kind: 'skill', value: { name: 'brainstorm' } as never }, { urn: 'urn:skill:brainstorm', name: 'brainstorm' });
    const item = treeItem({ kind: 'plugin', value: plugin, items: [child] }, { urn: `urn:plugin:${plugin.id}`, name: plugin.id });
    renderWithShell(<PluginTreeRow item={item} forceOpen renderChild={(c) => <div key={c.key} data-testid={`child-${c.name}`} />} />);
    expect(screen.getByTestId('child-brainstorm')).toBeInTheDocument();
  });

  it('a disabled plugin reads desativado once', () => {
    const off = { ...plugin, enabled: false };
    const item = treeItem({ kind: 'plugin', value: off, items: [] }, { urn: `urn:plugin:${off.id}`, name: off.id, disabled: true });
    renderWithShell(<PluginTreeRow item={item} />);
    expect(screen.getAllByText(/desativado/)).toHaveLength(1);
  });

  it('menu: Atualizar, Desativar, Remover — no Reconciliar', async () => {
    const item = itemOf({ ...plugin, drift: { kind: 'diverged' } as never });
    renderWithShell(<PluginTreeRow item={item} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    const { within } = await import('@testing-library/react');
    const labels = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
    expect(labels).toEqual(['Atualizar', 'Desativar', 'Remover']);
  });

  it('Remover hands the removal to the undo window, with no confirm dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const requestDelete = vi.fn();
    const item = itemOf(plugin);
    renderWithShell(
      <UndoableDeleteContext.Provider value={requestDelete}>
        <PluginTreeRow item={item} />
      </UndoableDeleteContext.Provider>,
    );
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await userEvent.setup().click(await screen.findByText('Remover'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(requestDelete).toHaveBeenCalledWith(expect.objectContaining({ key: item.urn, message: 'Plugin "local-plugin" removido' }));
    await requestDelete.mock.calls[0]![0].commit();
    await waitFor(() => expect(call).toHaveBeenCalledWith('plugin.remove', { id: 'local-plugin', scope: 'project' }));
    confirmSpy.mockRestore();
  });

  it('a disabled plugin reads desativado', () => {
    const item = itemOf({ ...plugin, enabled: false }, { disabled: true });
    renderWithShell(<PluginTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).toHaveTextContent('desativado');
  });
});
