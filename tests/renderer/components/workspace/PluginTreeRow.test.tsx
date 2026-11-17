import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginTreeRow } from '../../../../src/renderer/components/workspace/PluginTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { PluginListItemIpc } from '../../../../src/shared/plugin-ipc-types.js';

const plugin: PluginListItemIpc = {
  id: 'local-plugin', origin: 'imported', scope: 'project', enabled: true, installedAt: '2026-05-01T00:00:00Z', installedRef: { kind: 'branch', value: 'main' },
};
const itemOf = (p: PluginListItemIpc, opts: { disabled?: boolean; origin?: 'local' | 'global' } = {}) =>
  treeItem({ kind: 'plugin', value: p }, { urn: `urn:plugin:${p.id}`, name: p.id, ...opts });

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

  it('clicking the row expands it inline with what the plugin provides, one level deeper', async () => {
    const item = itemOf(plugin);
    renderWithShell(<PluginTreeRow item={item} />);
    await userEvent.setup().click(screen.getByTestId(rowId(item)));
    const child = await screen.findByTestId('tree-plugin-local-plugin-skill:brainstorm');
    expect(screen.getByTestId('tree-plugin-local-plugin-hooks')).toHaveTextContent('Hooks · 2');
    expect(screen.getByTestId('tree-plugin-local-plugin-mcp')).toBeInTheDocument();
    const indent = (el: Element): number => parseFloat(getComputedStyle(el).paddingLeft);
    expect(indent(child)).toBeGreaterThan(indent(screen.getByTestId(rowId(item))));
  });

  it('removes a plugin from the row menu after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const item = itemOf(plugin);
    renderWithShell(<PluginTreeRow item={item} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await userEvent.setup().click(await screen.findByText('Remover'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(call).toHaveBeenCalledWith('plugin.remove', { id: 'local-plugin', scope: 'project' }));
    confirmSpy.mockRestore();
  });

  it('a disabled plugin reads desativado', () => {
    const item = itemOf({ ...plugin, enabled: false }, { disabled: true });
    renderWithShell(<PluginTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).toHaveTextContent('desativado');
  });
});
