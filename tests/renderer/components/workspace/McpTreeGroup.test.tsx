import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpTreeGroup } from '../../../../src/renderer/components/workspace/McpTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { McpServer } from '../../../../src/shared/mcp.js';

const localServer: McpServer = {
  id: 's1', name: 'local-server', transport: 'stdio', def: {}, scope: 'project-local',
  repoPath: '/repos/acme', source: { kind: 'workspace' }, enabled: true,
};
const globalServer: McpServer = {
  id: 's2', name: 'global-server', transport: 'stdio', def: {}, scope: 'global',
  source: { kind: 'workspace' }, enabled: true,
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'mcp.list') return ok([localServer, globalServer]);
    return ok(undefined);
  });
});

describe('McpTreeGroup', () => {
  it('with a matchPath, only shows servers whose repoPath matches until "Mostrar globais" is on', async () => {
    const user = userEvent.setup();
    renderWithShell(<McpTreeGroup matchPath="/repos/acme" showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-mcp'));
    expect(await screen.findByTestId('tree-mcp-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-mcp-s2')).not.toBeInTheDocument();
  });

  it('reveals the global server once showGlobal is true', async () => {
    const user = userEvent.setup();
    renderWithShell(<McpTreeGroup matchPath="/repos/acme" showGlobal />);
    await user.click(await screen.findByTestId('tree-group-mcp'));
    expect(await screen.findByTestId('tree-mcp-s1')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-mcp-s2')).toBeInTheDocument();
  });

  it('shows every server, unfiltered, with no matchPath (the Default tier)', async () => {
    const user = userEvent.setup();
    renderWithShell(<McpTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-mcp'));
    expect(await screen.findByTestId('tree-mcp-s1')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-mcp-s2')).toBeInTheDocument();
  });

  it('tells two same-named servers apart by where each is configured, and leaves unique names bare', async () => {
    const user = userEvent.setup();
    const figmaUser: McpServer = { ...globalServer, id: 'f1', name: 'figma' };
    const figmaProject: McpServer = { ...localServer, id: 'f2', name: 'figma', scope: 'project-shared' };
    call.mockImplementation(async (method: string) => (method === 'mcp.list' ? ok([figmaUser, figmaProject, globalServer]) : ok(undefined)));
    renderWithShell(<McpTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-mcp'));
    expect(await screen.findByTestId('tree-mcp-scope-f1')).toHaveTextContent('usuário');
    expect(screen.getByTestId('tree-mcp-scope-f2')).toHaveTextContent('projeto');
    expect(screen.queryByTestId('tree-mcp-scope-s2')).not.toBeInTheDocument();
  });

  it('groups same-named servers by origin so each plugin keeps its own collapsed group', async () => {
    const user = userEvent.setup();
    const figma = (id: string, pluginId: string): McpServer => ({
      ...globalServer, id, name: 'figma', source: { kind: 'plugin', pluginId, provenance: 'claude-code' },
    });
    call.mockImplementation(async (method: string) =>
      method === 'mcp.list' ? ok([globalServer, figma('f1', 'figma@market'), figma('f2', 'other@market')]) : ok(undefined));
    renderWithShell(<McpTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-mcp'));
    expect(await screen.findByTestId('tree-mcp-s2')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-mcp-f1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('tree-subgroup-mcp-figma@market'));
    expect(await screen.findByTestId('tree-mcp-f1')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-mcp-f2')).not.toBeInTheDocument();
  });
});
