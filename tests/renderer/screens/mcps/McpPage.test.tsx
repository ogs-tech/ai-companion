import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpPage } from '../../../../src/renderer/screens/mcps/McpPage.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { McpServer } from '../../../../src/shared/mcp.js';
import type { Settings } from '../../../../src/shared/settings.js';

// xterm needs a real browser (matchMedia, canvas); the dialog only hosts it.
vi.mock('../../../../src/renderer/components/workspace/TerminalPanel.js', () => ({ TerminalPanel: () => null }));

const settings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: false } },
  ui: { theme: 'system' },
  language: 'off',
};
const remote: McpServer = {
  id: 'own-ctx',
  name: 'context7',
  transport: 'http',
  def: { url: 'https://mcp.context7.com/mcp' },
  scope: 'global',
  source: { kind: 'workspace' },
  enabled: true,
  health: { state: 'needs-auth' },
};

let call: CallSpy;
let exitListeners: Map<string, (code: number | null) => void>;

function route(servers: McpServer[], status: Record<string, unknown> = {}): void {
  let terminal = 0;
  call.mockImplementation(async (method: string) => {
    if (method === 'mcp.list') return ok(servers);
    if (method === 'settings.get') return ok(settings);
    if (method === 'customization.status') return ok({ generatedAt: '', items: status });
    if (method === 'channelSetup.mcpLogin') return ok({ kind: 'terminal', terminalId: `t${++terminal}`, title: 'Conectar' });
    return ok(undefined);
  });
}

beforeEach(() => {
  call = mockApi();
  exitListeners = new Map();
  vi.mocked(window.api.terminal.onExit).mockImplementation(((id: string, listener: (code: number | null) => void) => {
    exitListeners.set(id, listener);
    return () => exitListeners.delete(id);
  }) as never);
});

describe('McpPage', () => {
  it('signs in to every channel the server lives in, one login per channel, Claude then Cursor', async () => {
    route([remote]);
    renderWithShell(<McpPage serverId="own-ctx" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Conectar em todos' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('channelSetup.mcpLogin', { channelId: 'claude', server: 'context7' }));
    await screen.findByTestId('channel-setup-dialog');

    act(() => exitListeners.get('t1')?.(0));
    await waitFor(() => expect(call).toHaveBeenCalledWith('mcp.refreshHealth', {}));
    await user.click(await screen.findByRole('button', { name: 'Conectar no Cursor' }));

    await waitFor(() => expect(call).toHaveBeenCalledWith('channelSetup.mcpLogin', { channelId: 'cursor', server: 'context7' }));
    expect(call).toHaveBeenCalledWith('channelSetup.close', { terminalId: 't1' });
  });

  it("a plugin's server lives only in Claude, signed in under its runtime name", async () => {
    route([{ ...remote, id: 'p', scope: 'plugin', source: { kind: 'plugin', pluginId: 'context7', provenance: 'claude-code' } }]);
    renderWithShell(<McpPage serverId="p" />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Conectar no Claude' }));

    await waitFor(() => expect(call).toHaveBeenCalledWith('channelSetup.mcpLogin', { channelId: 'claude', server: 'plugin:context7:context7' }));
    expect(screen.queryByTestId('mcp-page-channel-cursor')).not.toBeInTheDocument();
  });

  it("shows each channel's state: Claude's live error with its detail, Cursor's sync status", async () => {
    route([{ ...remote, health: { state: 'error', detail: 'Connection closed' } }], {
      'urn:mcp:context7': { status: 'error', channels: { claude: { status: 'error' }, cursor: { status: 'installed' } } },
    });
    renderWithShell(<McpPage serverId="own-ctx" />);

    const claude = await screen.findByTestId('mcp-page-channel-claude');
    expect(claude).toHaveTextContent('Erro');
    expect(claude).toHaveTextContent('Connection closed');
    expect(within(claude).getByRole('button', { name: 'Ver diagnóstico' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('mcp-page-channel-cursor')).toHaveTextContent('Configurado'));
  });

  it('a local stdio server has no login: its keys go in env', async () => {
    route([{ ...remote, transport: 'stdio', def: { command: 'npx', args: ['-y', 'ctx'] }, health: { state: 'ok' } }]);
    renderWithShell(<McpPage serverId="own-ctx" />);

    expect(await screen.findByTestId('mcp-page-no-login')).toHaveTextContent('env');
    expect(screen.queryByRole('button', { name: /Conectar/ })).not.toBeInTheDocument();
    expect(screen.getByText('stdio · npx -y ctx')).toBeInTheDocument();
  });

  it('says so when the server is gone', async () => {
    route([]);
    renderWithShell(<McpPage serverId="own-ctx" />);
    expect(await screen.findByText('Este servidor não está mais configurado.')).toBeInTheDocument();
  });
});
