import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpTreeRow } from '../../../../src/renderer/components/workspace/McpTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { McpServer } from '../../../../src/shared/mcp.js';

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

  it('a disabled server reads desativado and offers Ativar', async () => {
    const item = itemOf({ ...own, enabled: false }, { disabled: true });
    renderWithShell(<McpTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).toHaveTextContent('desativado');
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
    expect(screen.getByTestId('tree-mcp-harness-d1')).toHaveTextContent('Cursor');
    await userEvent.setup().click(screen.getByTestId('row-tag-detected'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'det-1' }));
  });

  it('re-probes the runtime when the window regains focus after Conectar', async () => {
    const connector: McpServer = { id: 'c1', name: 'claude-ai-Gmail', transport: 'http', def: {}, scope: 'detected', source: { kind: 'detected' }, enabled: false, health: { state: 'needs-auth' } };
    const item = itemOf(connector, { origin: 'detected' });
    renderWithShell(<McpTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).not.toHaveTextContent('desativado');
    await userEvent.setup().click(screen.getByTestId('tree-mcp-connect-c1'));
    expect(call).toHaveBeenCalledWith('mcp.authenticate', { id: 'c1' });
    expect(call).not.toHaveBeenCalledWith('mcp.refreshHealth', expect.anything());
    fireEvent.focus(window);
    await waitFor(() => expect(call).toHaveBeenCalledWith('mcp.refreshHealth', {}));
  });
});
