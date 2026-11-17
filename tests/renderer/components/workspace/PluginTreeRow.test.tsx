import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginTreeRow } from '../../../../src/renderer/components/workspace/PluginTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { PluginListItemIpc } from '../../../../src/shared/plugin-ipc-types.js';
import { UndoableDeleteContext } from '../../../../src/renderer/hooks/use-undoable-delete.js';
import { clearDiagnosticsFocus, useDiagnosticsFocus } from '../../../../src/renderer/lib/diagnostics-focus.js';

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

  it('expands on click to one collapsed sub-header per kind; each opens to its items, two levels deeper', async () => {
    const child = treeItem({ kind: 'skill', value: { name: 'brainstorm' } as never }, { urn: 'urn:skill:brainstorm', name: 'brainstorm' });
    const item = treeItem({ kind: 'plugin', value: plugin, items: [child] }, { urn: `urn:plugin:${plugin.id}`, name: plugin.id });
    const renderChild = vi.fn((c: typeof child, depth: number) => <div key={c.key} data-testid={`child-${c.name}-${depth}`} />);
    renderWithShell(<PluginTreeRow item={item} depth={1} renderChild={renderChild} />);
    const rowEl = screen.getByTestId(rowId(item));
    expect(screen.queryByTestId('child-brainstorm-3')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(rowEl);
    const skills = screen.getByTestId('tree-plugin-kind-local-plugin-skill');
    expect(skills).toHaveTextContent('Skills1');
    expect(screen.queryByTestId('tree-plugin-kind-local-plugin-agent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('child-brainstorm-3')).not.toBeInTheDocument();
    await user.click(skills);
    expect(screen.getByTestId('child-brainstorm-3')).toBeInTheDocument();
    await user.click(skills);
    expect(screen.queryByTestId('child-brainstorm-3')).not.toBeInTheDocument();
  });

  it('a plugin with nothing to list keeps the chevron column, so it lines up with the ones that expand', () => {
    const item = itemOf(plugin);
    renderWithShell(<PluginTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item)).querySelector('[data-testid="tree-row-chevron-spacer"]')).not.toBeNull();
  });

  it('forceOpen lists its items without a click', () => {
    const child = treeItem({ kind: 'skill', value: { name: 'brainstorm' } as never }, { urn: 'urn:skill:brainstorm', name: 'brainstorm' });
    const item = treeItem({ kind: 'plugin', value: plugin, items: [child] }, { urn: `urn:plugin:${plugin.id}`, name: plugin.id });
    renderWithShell(<PluginTreeRow item={item} forceOpen renderChild={(c) => <div key={c.key} data-testid={`child-${c.name}`} />} />);
    expect(screen.getByTestId('child-brainstorm')).toBeInTheDocument();
  });

  it('the row says only name and version: no ativo, no installed-by, no tooltip', async () => {
    const item = itemOf({ ...plugin, installedBy: 'both', version: '4.2.0' });
    renderWithShell(<PluginTreeRow item={item} />);
    const rowEl = screen.getByTestId(rowId(item));
    expect(screen.getByTestId('tree-plugin-version-local-plugin')).toHaveTextContent('4.2.0');
    expect(rowEl).not.toHaveTextContent(/ativo|App \+ Claude/);
    await userEvent.setup().hover(rowEl);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('Atualizar on the row runs plugin.update without expanding it, then confirms in a toast', async () => {
    const child = treeItem({ kind: 'skill', value: { name: 'brainstorm' } as never }, { urn: 'urn:skill:brainstorm', name: 'brainstorm' });
    const item = treeItem({ kind: 'plugin', value: plugin, items: [child] }, { urn: `urn:plugin:${plugin.id}`, name: plugin.id });
    renderWithShell(<PluginTreeRow item={item} renderChild={(c) => <div key={c.key} data-testid={`child-${c.name}`} />} />);
    await userEvent.setup().click(screen.getByTestId('tree-plugin-update-local-plugin'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('plugin.update', { id: 'local-plugin', scope: 'project' }));
    expect(await screen.findByText('Plugin "local-plugin" atualizado')).toBeInTheDocument();
    expect(screen.queryByTestId('child-brainstorm')).not.toBeInTheDocument();
  });

  it('no Atualizar for a plugin that cannot be pulled (owned, tag ref, or only Claude installed)', () => {
    for (const p of [
      { ...plugin, origin: 'owned' as const },
      { ...plugin, installedRef: { kind: 'tag' as const, value: 'v1' } },
      { ...plugin, installedBy: 'claude' as const },
    ]) {
      const { unmount } = renderWithShell(<PluginTreeRow item={itemOf(p)} />);
      expect(screen.queryByTestId('tree-plugin-update-local-plugin')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('a plugin only Claude installed opens a read-only menu that says why', async () => {
    const item = itemOf({ ...plugin, installedBy: 'claude' });
    renderWithShell(<PluginTreeRow item={item} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    expect(await screen.findByTestId('tree-plugin-claude-note-local-plugin')).toHaveTextContent('/plugin');
    expect(screen.getByTestId('tree-plugin-toggle-local-plugin')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('tree-plugin-remove-local-plugin')).toHaveAttribute('aria-disabled', 'true');
  });

  it('menu: Desativar, Remover — Atualizar lives on the row', async () => {
    const item = itemOf({ ...plugin, drift: { kind: 'diverged' } as never });
    renderWithShell(<PluginTreeRow item={item} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    const { within } = await import('@testing-library/react');
    const labels = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
    expect(labels).toEqual(['Desativar', 'Remover']);
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

  it('a disabled plugin reads muted, with no desativado text', () => {
    const item = itemOf({ ...plugin, enabled: false }, { disabled: true });
    renderWithShell(<PluginTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).not.toHaveTextContent('Desativado');
  });

  it('its ⚠ opens Diagnósticos on the plugin and on what it ships, where the error was reported', async () => {
    clearDiagnosticsFocus();
    const server = treeItem({ kind: 'mcp', value: { name: 'context7' } as never }, { urn: 'urn:mcp:context7', name: 'context7', problems: ['claude'] });
    const item = treeItem({ kind: 'plugin', value: plugin, items: [server] }, { urn: `urn:plugin:${plugin.id}`, name: plugin.id, problems: ['claude'] });
    function FocusProbe(): React.ReactElement {
      const focus = useDiagnosticsFocus();
      return <div data-testid="focus">{focus?.urns.join(',') ?? ''}</div>;
    }
    renderWithShell(
      <>
        <PluginTreeRow item={item} />
        <FocusProbe />
      </>,
    );
    await userEvent.setup().click(screen.getByTestId('channel-warning'));
    expect(screen.getByTestId('focus')).toHaveTextContent('urn:plugin:local-plugin,urn:mcp:context7');
    clearDiagnosticsFocus();
  });
});
