import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpTreeRow } from '../../../../src/renderer/components/workspace/McpTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { McpServer } from '../../../../src/shared/mcp.js';
import { registerMcpOpener } from '../../../../src/renderer/lib/workspace-area-store.js';

const own: McpServer = { id: 's1', name: 'github', transport: 'stdio', def: {}, scope: 'global', source: { kind: 'workspace' }, enabled: true };
const itemOf = (server: McpServer, opts: { disabled?: boolean; origin?: 'local' | 'detected' } = {}) =>
  treeItem({ kind: 'mcp', value: server }, { urn: `urn:mcp:${server.name}`, name: server.name, identity: `mcp:${server.id}`, ...opts });

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async () => ok(undefined));
});

describe('McpTreeRow', () => {
  it('toggles an own server from the row menu', async () => {
    const item = itemOf(own);
    renderWithShell(<McpTreeRow item={item} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await userEvent.setup().click(await screen.findByTestId('row-context-menu-toggle'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('entity.setEnabled', { urn: 'urn:mcp:github', enabled: false }));
  });

  it('a disabled server reads Desativado and offers Ativar', async () => {
    const item = itemOf({ ...own, enabled: false }, { disabled: true });
    renderWithShell(<McpTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).toHaveTextContent('Desativado');
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    expect(await screen.findByTestId('row-context-menu-toggle')).toHaveTextContent('Ativar');
  });

  it('says where a same-named server is configured only when asked', () => {
    const item = itemOf({ ...own, scope: 'project-shared' });
    const { rerender } = renderWithShell(<McpTreeRow item={item} showScope />);
    expect(screen.getByTestId('tree-mcp-scope-s1')).toHaveTextContent('projeto');
    rerender(<McpTreeRow item={item} />);
    expect(screen.queryByTestId('tree-mcp-scope-s1')).not.toBeInTheDocument();
  });

  it('offers Importar on an importable detected server and nothing on a read-only one', async () => {
    const importable = itemOf({ ...own, id: 'd1', scope: 'detected', source: { kind: 'detected', detectedId: 'det-1', harness: 'cursor', importable: true } }, { origin: 'detected' });
    renderWithShell(<McpTreeRow item={importable} />);
    expect(screen.getByTestId(rowId(importable))).not.toHaveTextContent('Cursor');
    fireEvent.contextMenu(screen.getByTestId(rowId(importable)));
    await userEvent.setup().click(await screen.findByTestId('row-context-menu-import'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'det-1' }));
    // Now Claude's own server: re-probed so a sign-in it needs shows as Conectar.
    await waitFor(() => expect(call).toHaveBeenCalledWith('mcp.refreshHealth', {}));
  });

  it('a detected server needing auth offers Importar, not Conectar — it signs in once it is the app’s', async () => {
    const synced = itemOf(
      { ...own, id: 'd2', name: 'atlassian', transport: 'http', scope: 'detected', source: { kind: 'detected', detectedId: 'det-2', harness: 'claude', importable: true }, health: { state: 'needs-auth' } },
      { origin: 'detected' },
    );
    renderWithShell(<McpTreeRow item={synced} />);
    expect(screen.queryByTestId('channel-warning')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId(rowId(synced)));
    expect(await screen.findByTestId('row-context-menu-import')).toBeInTheDocument();
    expect(screen.queryByTestId('row-context-menu-authenticate')).not.toBeInTheDocument();
  });

  it('sign-in pending reads as an error on Claude, and Conectar leads the menu', async () => {
    const connector: McpServer = { id: 'c1', name: 'context7', transport: 'http', def: {}, scope: 'plugin', source: { kind: 'plugin', pluginId: 'context7', provenance: 'claude-code' }, enabled: true, health: { state: 'needs-auth' } };
    renderWithShell(<McpTreeRow item={itemOf(connector)} />);
    expect(screen.getByTestId('channel-warning')).toHaveAccessibleName('Erro no Claude: login pendente. Abrir diagnóstico');
    fireEvent.contextMenu(screen.getByTestId(rowId(itemOf(connector))));
    const [first] = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(first).toHaveTextContent('Conectar');
  });

  it('a click on the row, or on Conectar, opens the server page instead of a browser link', async () => {
    const opened: string[] = [];
    registerMcpOpener((server) => opened.push(server.id));
    const connector: McpServer = { id: 'c1', name: 'context7', transport: 'http', def: {}, scope: 'plugin', source: { kind: 'plugin', pluginId: 'context7', provenance: 'claude-code' }, enabled: true, health: { state: 'needs-auth' } };
    const item = itemOf(connector);
    renderWithShell(<McpTreeRow item={item} />);
    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await user.click(await screen.findByTestId('row-context-menu-authenticate'));
    await user.click(screen.getByTestId(rowId(item)));
    expect(opened).toEqual(['c1', 'c1']);
    expect(call).not.toHaveBeenCalledWith('mcp.authenticate', expect.anything());
    registerMcpOpener(null);
  });
});
