import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomizationsList, type CustomizationsListProps } from '../../../../src/renderer/components/workspace/CustomizationsList.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const metadata = { version: '0.1.0', createdAt: '', updatedAt: '' };
const source = { kind: 'workspace' as const };
const localSkill = { urn: 'urn:skill:deploy', kind: 'skill', name: 'deploy', description: 'Ship it', scopes: ['workspace'], scopeId: 'w1', metadata, source, content: '' };
const globalSkill = { urn: 'urn:skill:lint', kind: 'skill', name: 'lint', description: 'Style rules', scopes: ['personal'], metadata, source, content: '' };
const localAgent = { urn: 'urn:agent:reviewer', kind: 'agent', name: 'reviewer', description: 'Reviews PRs', scopes: ['workspace'], scopeId: 'w1', metadata, source, systemPrompt: '' };
const hook = { id: 'h1', event: 'PreToolUse', handler: { type: 'command', command: 'echo hi' }, enabled: true, source };
const personalInstruction = { urn: 'urn:instruction:default', kind: 'instruction', name: 'default', description: 'House rules', scopes: ['personal'], metadata, source, content: '# rules' };
const server = (name: string, enabled = true) => ({ id: `${name}-id`, name, def: {}, scope: 'global', source, enabled });

/** Row test id: `tree-row-<origin>:<folder alias>:<identity>`. */
const row = (origin: 'local' | 'global' | 'detected', identity: string, alias = ''): string => `tree-row-${origin}:${alias}:${identity}`;

type Handler = (method: string, params?: unknown) => unknown;
let call: CallSpy;
const respond = (overrides: Record<string, unknown> = {}, fallback?: Handler): void => {
  call.mockImplementation(async (method: string, params?: unknown) => {
    if (method in overrides) return ok(overrides[method]);
    const fromFallback = fallback?.(method, params);
    if (fromFallback !== undefined) return ok(fromFallback);
    if (method === 'skill.list') return ok([localSkill, globalSkill]);
    if (method === 'agent.list') return ok([localAgent]);
    if (method === 'hook.list') return ok([hook]);
    if (method === 'instruction.get') return ok(personalInstruction);
    if (method === 'instruction.list') return ok([personalInstruction]);
    return ok([]);
  });
};
beforeEach(() => {
  window.localStorage.clear();
  call = mockApi();
  respond();
});

const workspaceProps = (): CustomizationsListProps => ({
  isHome: false,
  localScope: { scope: 'workspace', scopeId: 'w1' },
  onEditEntity: vi.fn(),
  onPreviewEntity: vi.fn(),
  onEntityProperties: vi.fn(),
  onNewActionForEntity: vi.fn(),
  onOpenInstruction: vi.fn(),
  onInstructionProperties: vi.fn(),
  onNewActionForInstruction: vi.fn(),
});
const homeProps = (): CustomizationsListProps => ({ ...workspaceProps(), isHome: true, localScope: undefined as never });
const follows = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('CustomizationsList', () => {
  it('in a workspace, splits Workspace and a collapsed, read-only Global section, each grouped by type', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    const local = await screen.findByTestId(row('local', 'urn:skill:deploy'));
    const workspaceSection = screen.getByTestId('control-panel-section-local');
    const globalSection = screen.getByTestId('control-panel-section-global');
    expect(workspaceSection).toHaveTextContent('Workspace');
    expect(globalSection).toHaveTextContent('Global');
    expect(follows(workspaceSection, screen.getByTestId('tree-group-skill')) && follows(screen.getByTestId('tree-group-skill'), local)).toBe(true);
    // Global starts closed: the workspace's own items stay in view.
    await waitFor(() => expect(screen.getByTestId(row('global', 'urn:skill:lint'))).not.toBeVisible());
    await user.click(globalSection);
    const global = screen.getByTestId(row('global', 'urn:skill:lint'));
    expect(global).toBeVisible();
    expect(follows(globalSection, screen.getByTestId('tree-group-global-skill')) && follows(screen.getByTestId('tree-group-global-skill'), global)).toBe(true);
    // Hooks have no workspace scoping, so they are Global's; MCP/Hooks are their own groups (no "Integrações").
    expect(screen.getByTestId('tree-group-global-hook')).toHaveTextContent('Hooks');
    expect(screen.getByTestId(row('global', 'urn:hook:h1'))).toBeInTheDocument();
    expect(screen.queryByText('Integrações')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-tag-global')).not.toBeInTheDocument();
    expect(screen.getByTestId('control-panel-footer')).toHaveTextContent(/itens, 3 do Global/);
  });

  it('puts each section’s Instructions row right under it, not inside a group', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} seedWorkspaceInstruction={() => ({ ...personalInstruction, name: 'acme', scopes: ['workspace'], scopeId: 'w1' }) as never} />);
    const own = await screen.findByTestId('workspace-instruction-row');
    expect(own).toHaveTextContent('Instructions');
    expect(screen.queryByTestId('tree-group-instruction')).not.toBeInTheDocument();
    expect(follows(screen.getByTestId('control-panel-section-local'), own) && follows(own, screen.getByTestId('tree-group-skill'))).toBe(true);
    await user.click(await screen.findByTestId('control-panel-section-global'));
    const inherited = screen.getByTestId('personal-instruction-row');
    expect(inherited).toHaveTextContent('Instructions');
    expect(follows(screen.getByTestId('control-panel-section-global'), inherited) && follows(inherited, screen.getByTestId('tree-group-global-skill'))).toBe(true);
  });

  it('hides the Global section when a search leaves nothing in it, and brings it back when cleared', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('control-panel-section-global');
    await user.type(screen.getByTestId('control-panel-search'), 'deploy');
    await waitFor(() => expect(screen.queryByTestId('control-panel-section-global')).not.toBeInTheDocument());
    await user.click(screen.getByTestId('control-panel-search-clear'));
    expect(await screen.findByTestId('control-panel-section-global')).toBeInTheDocument();
  });

  it('at Início: no sections, the Instructions row, then the type groups in fixed order', async () => {
    respond({ 'mcp.list': [server('ctx')], 'plugin.list': [{ id: 'kit', scope: 'personal', origin: 'imported', enabled: true }] });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    await screen.findByTestId(row('local', 'mcp:ctx-id'));
    expect(screen.queryByTestId('control-panel-section-local')).not.toBeInTheDocument();
    const ids = screen.getAllByTestId(/^tree-group-(instruction|skill|agent|mcp|hook|plugin)$/).map((el) => el.dataset['testid']);
    expect(ids).toEqual(['tree-group-skill', 'tree-group-agent', 'tree-group-mcp', 'tree-group-hook', 'tree-group-plugin']);
    expect(follows(screen.getByTestId('personal-instruction-row'), screen.getByTestId('tree-group-skill'))).toBe(true);
  });

  it('opening a Global skill in a workspace edits it like a local one', async () => {
    const user = userEvent.setup();
    const props = workspaceProps();
    renderWithShell(<CustomizationsList {...props} />);
    await user.click(await screen.findByTestId('control-panel-section-global'));
    await user.click(screen.getByTestId(row('global', 'urn:skill:lint')));
    expect(props.onEditEntity).toHaveBeenCalledWith('skill', globalSkill, false);
    await user.click(screen.getByTestId(row('local', 'urn:skill:deploy')));
    expect(props.onEditEntity).toHaveBeenCalledWith('skill', localSkill, false);
  });

  it('Início lists no Global tag', async () => {
    renderWithShell(<CustomizationsList {...homeProps()} />);
    expect(await screen.findByTestId(row('local', 'urn:skill:lint'))).toBeInTheDocument();
    expect(screen.getByTestId(row('local', 'urn:skill:deploy'))).toBeInTheDocument();
    expect(screen.getByTestId('personal-instruction-row')).toBeInTheDocument();
    expect(screen.queryByTestId('control-panel-section-global')).not.toBeInTheDocument();
    expect(screen.getByTestId('control-panel-footer')).not.toHaveTextContent('Global');
  });

  it('searches name and description, and counts "n de N itens"', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId(row('local', 'urn:skill:deploy'));
    await user.type(screen.getByTestId('control-panel-search'), 'style');
    expect(await screen.findByTestId(row('global', 'urn:skill:lint'))).toBeVisible();
    expect(screen.queryByTestId(row('local', 'urn:skill:deploy'))).not.toBeInTheDocument();
    expect(screen.getByTestId('control-panel-footer')).toHaveTextContent('1 de 5 itens');
  });

  it('selecting a chip filters rows and shows "n de N itens"', async () => {
    const user = userEvent.setup();
    respond({ 'mcp.list': [server('on'), server('off', false)] });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    await screen.findByTestId(row('local', 'mcp:off-id'));
    expect(screen.getByTestId('chip-draft')).toHaveTextContent('Draft 1');
    await user.click(screen.getByTestId('chip-draft'));
    expect(screen.getByTestId('chip-draft')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(row('local', 'mcp:off-id'))).toBeVisible();
    expect(screen.queryByTestId(row('local', 'mcp:on-id'))).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-group-skill')).not.toBeInTheDocument();
    // 2 skills + 1 agent + 1 hook + 2 MCP + the saved personal instruction.
    expect(screen.getByTestId('control-panel-footer')).toHaveTextContent('1 de 7 itens');
  });

  it('a chip with zero matches is disabled', async () => {
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId(row('local', 'urn:skill:deploy'));
    expect(screen.getByTestId('chip-error')).toBeDisabled();
    expect(screen.getByTestId('chip-draft')).toBeDisabled();
    expect(screen.getByTestId('chip-all')).toBeEnabled();
    expect(screen.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'true');
  });

  it('chip stays selected when search empties it and Limpar filtros resets both', async () => {
    const user = userEvent.setup();
    respond({ 'mcp.list': [server('off', false)] });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    await screen.findByTestId(row('local', 'mcp:off-id'));
    await user.click(screen.getByTestId('chip-draft'));
    await user.type(screen.getByTestId('control-panel-search'), 'deploy');
    expect(screen.getByTestId('chip-draft')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('chip-draft')).toBeDisabled();
    expect(screen.getByTestId('control-panel-empty')).toHaveTextContent('deploy');
    expect(screen.getByTestId('control-panel-footer')).toHaveTextContent('0 de');

    await user.click(screen.getByTestId('control-panel-clear'));
    expect(screen.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('control-panel-search')).toHaveValue('');
    expect(screen.getByTestId(row('local', 'urn:skill:deploy'))).toBeInTheDocument();
    expect(screen.queryByTestId('control-panel-empty')).not.toBeInTheDocument();
  });

  it('disabled hook row shows desativado', async () => {
    respond({ 'hook.list': [{ ...hook, enabled: false }] });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    expect(await screen.findByTestId(row('local', 'urn:hook:h1'))).toHaveTextContent('draft · desativado');
  });

  it('disabled MCP row shows desativado', async () => {
    respond({ 'mcp.list': [server('off', false)] });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    expect(await screen.findByTestId(row('local', 'mcp:off-id'))).toHaveTextContent('desativado');
  });

  it('shows each row its status from customization.status, counts errors once per item, and filters by channel', async () => {
    const user = userEvent.setup();
    const error = (...channels: string[]) => ({ status: 'error', channels: Object.fromEntries(channels.map((c) => [c, { status: 'error' }])) });
    respond({
      'hook.list': [hook, { ...hook, id: 'h2' }, { ...hook, id: 'h3' }, { ...hook, id: 'h4' }],
      'customization.status': {
        generatedAt: '',
        items: {
          'urn:hook:h1': error('claude', 'cursor'),
          'urn:hook:h2': error('cursor'),
          'urn:hook:h3': { status: 'installed', channels: { claude: { status: 'installed' } } },
          'urn:hook:h4': { status: 'draft', reason: 'detected', channels: { cursor: { status: 'draft', reason: 'detected' } } },
        },
      },
    });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    await waitFor(() => expect(screen.getByTestId(row('local', 'urn:hook:h1'))).toHaveTextContent('⚠ Claude · Cursor'));
    expect(screen.getByTestId(row('local', 'urn:hook:h2'))).toHaveTextContent('⚠ Cursor');
    expect(screen.getByTestId(row('local', 'urn:hook:h3'))).not.toHaveTextContent('⚠');
    expect(screen.getByTestId(row('local', 'urn:hook:h4'))).toHaveTextContent('draft');
    expect(screen.getByTestId('tree-group-hook')).toHaveTextContent('2 ⚠');
    expect(screen.getByTestId('chip-error')).toHaveTextContent('Com erro 2');
    expect(screen.getByTestId('chip-installed')).toHaveTextContent('Instalado 1');
    expect(screen.getByTestId('chip-draft')).toHaveTextContent('Draft 1');
    expect(screen.queryByTestId('chip-channel-all')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('chip-error'));
    expect(screen.getByTestId('chip-channel-claude')).toHaveTextContent('Claude 1');
    expect(screen.getByTestId('chip-channel-cursor')).toHaveTextContent('Cursor 2');
    await user.click(screen.getByTestId('chip-channel-claude'));
    expect(screen.getByTestId(row('local', 'urn:hook:h1'))).toBeInTheDocument();
    expect(screen.queryByTestId(row('local', 'urn:hook:h2'))).not.toBeInTheDocument();

    // A new status chip starts on every channel again.
    await user.click(screen.getByTestId('chip-draft'));
    expect(screen.getByTestId('chip-channel-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(row('local', 'urn:hook:h4'))).toBeInTheDocument();
  });

  it('multi-folder rows show the folder tag', async () => {
    const workspace = { id: 'w1', name: 'Acme', rootPath: '/r/api', extraFolders: ['/r/web'], createdAt: '' };
    respond({ 'workspace.getActive': workspace, 'skill.list': [{ ...localSkill, folder: '/r/web' }] });
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    const tagged = await screen.findByTestId(row('local', 'urn:skill:deploy', 'web'));
    expect(within(tagged).getByTestId('row-folder')).toHaveTextContent('web');
  });

  it('lists a plugin once, with what it provides only under it, shown on click', async () => {
    const user = userEvent.setup();
    const plugin = { kind: 'plugin' as const, pluginId: 'dev-kit@market' };
    respond({
      'skill.list': [localSkill, { ...localSkill, urn: 'urn:skill:scaffold', name: 'scaffold', source: plugin }],
      'hook.list': [hook, { ...hook, id: 'h2', source: plugin }],
      'plugin.list': [{ id: 'dev-kit@market', scope: 'personal', origin: 'imported', enabled: true }],
      'instruction.list': [],
    });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    const pluginRow = (await screen.findAllByTestId(row('local', 'urn:plugin:dev-kit@market')))[0]!;
    expect(screen.getAllByTestId(row('local', 'urn:plugin:dev-kit@market'))).toHaveLength(1);
    expect(screen.getByTestId('tree-group-plugin')).toHaveTextContent('Plugins');
    expect(screen.queryByTestId(row('local', 'dev-kit@market:urn:skill:scaffold'))).not.toBeInTheDocument();
    expect(screen.queryByTestId(row('local', 'urn:hook:h2'))).not.toBeInTheDocument();
    await user.click(pluginRow);
    await user.click(screen.getByTestId('tree-plugin-kind-dev-kit@market-skill'));
    await user.click(screen.getByTestId('tree-plugin-kind-dev-kit@market-hook'));
    expect(await screen.findByTestId(row('local', 'dev-kit@market:urn:skill:scaffold'))).toBeInTheDocument();
    expect(screen.getByTestId(row('local', 'urn:hook:h2'))).toBeInTheDocument();
  });

  it('+ Novo lists the kinds in registry order', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} seedWorkspaceInstruction={() => personalInstruction as never} />);
    await user.click(await screen.findByTestId('control-panel-new'));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).toEqual(['Instruções', 'Skills', 'Agents', 'MCP', 'Hooks', 'Importar plugin']);
  });

  it('keeps Skills and Agents as the create affordance when empty', async () => {
    respond({ 'skill.list': [], 'agent.list': [] });
    renderWithShell(<CustomizationsList {...homeProps()} />);
    expect(await screen.findByTestId('tree-group-empty-skill')).toHaveTextContent('Nada aqui ainda');
    expect(screen.getByTestId('tree-group-empty-agent')).toBeInTheDocument();
  });

  it('remembers a collapsed group per scope and section', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    await waitFor(() => expect(screen.queryByTestId(row('local', 'urn:skill:deploy'))).not.toBeInTheDocument());
    expect(window.localStorage.getItem('tree-group:w1:local:skill')).not.toBeNull();
  });

  it('"+" offers a Skill/Agent/Instruction/MCP/plugin menu', async () => {
    const user = userEvent.setup();
    const props = workspaceProps();
    props.seedWorkspaceInstruction = () => ({ ...personalInstruction, name: 'acme', scopes: ['workspace'], scopeId: 'w1' }) as never;
    renderWithShell(<CustomizationsList {...props} />);
    await screen.findByTestId(row('local', 'urn:skill:deploy'));
    await user.click(screen.getByTestId('control-panel-new'));
    expect(await screen.findByTestId('control-panel-new-skill')).toBeInTheDocument();
    expect(screen.getByTestId('control-panel-new-agent')).toBeInTheDocument();
    expect(screen.getByTestId('control-panel-new-mcp')).toBeInTheDocument();
    expect(screen.getByTestId('control-panel-new-plugin')).toBeInTheDocument();
    await user.click(screen.getByTestId('control-panel-new-instruction'));
    expect(props.onOpenInstruction).toHaveBeenCalledWith(expect.objectContaining({ name: 'acme' }), true);
  });

  it('at Início, does not offer a second personal instruction once one exists', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...homeProps()} />);
    await screen.findByTestId('personal-instruction-row');
    await user.click(screen.getByTestId('control-panel-new'));
    expect(await screen.findByTestId('control-panel-new-skill')).toBeInTheDocument();
    expect(screen.queryByTestId('control-panel-new-instruction')).not.toBeInTheDocument();
  });

  it('the Global personal instruction opens its editor in a workspace', async () => {
    const user = userEvent.setup();
    const props = workspaceProps();
    renderWithShell(<CustomizationsList {...props} />);
    await user.click(await screen.findByTestId('control-panel-section-global'));
    await user.click(screen.getByTestId('personal-instruction-row'));
    expect(props.onOpenInstruction).toHaveBeenCalledWith(personalInstruction, false);
  });
});

describe('CustomizationsList — undoable delete', () => {
  it('Excluir hides the row at once; Desfazer brings it back and nothing is deleted', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    const target = await screen.findByTestId(row('local', 'urn:skill:deploy'));
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await user.click(await screen.findByTestId('row-context-menu-delete'));
    await waitFor(() => expect(screen.queryByTestId(row('local', 'urn:skill:deploy'))).not.toBeInTheDocument());
    expect(screen.getByText('"deploy" excluído')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByTestId(row('local', 'urn:skill:deploy'))).toBeInTheDocument();
    expect(call).not.toHaveBeenCalledWith('skill.delete', expect.anything());
  });

  it('unmounting during the undo window still deletes', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithShell(<CustomizationsList {...workspaceProps()} />);
    const target = await screen.findByTestId(row('local', 'urn:skill:deploy'));
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await user.click(await screen.findByTestId('row-context-menu-delete'));
    unmount();
    await waitFor(() => expect(call).toHaveBeenCalledWith('skill.delete', { id: 'deploy', removeSymlinks: true }));
  });
});

describe('CustomizationsList — Global rows in a workspace', () => {
  it('a Global skill offers the same menu as a local one', async () => {
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await userEvent.setup().click(await screen.findByTestId('control-panel-section-global'));
    const target = screen.getByTestId(row('global', 'urn:skill:lint'));
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).toContain('Excluir');
    expect(items).not.toContain('Editar no Início');
  });
});

describe('CustomizationsList — workspace plugins', () => {
  it("lists a workspace plugin's skills under its row, not in Skills", async () => {
    const plugin = { kind: 'plugin' as const, pluginId: 'demo-plugin', provenance: 'workspace-managed' as const };
    const greet = { ...localSkill, urn: 'urn:skill:greet', name: 'greet', scopes: ['personal'], source: plugin };
    respond({ 'instruction.list': [] }, (method, params) => {
      const scope = (params as { scope?: string } | undefined)?.scope;
      if (method === 'skill.list') return scope === 'project' ? [greet] : [localSkill];
      if (method === 'plugin.list') return scope === 'project' ? [{ id: 'demo-plugin', scope: 'project', origin: 'imported', enabled: true }] : [];
      return undefined;
    });
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    const pluginRow = await screen.findByTestId(row('local', 'urn:plugin:demo-plugin'));
    expect(screen.queryByTestId(row('local', 'demo-plugin:urn:skill:greet'))).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(pluginRow);
    await user.click(screen.getByTestId('tree-plugin-kind-demo-plugin-skill'));
    expect(await screen.findByTestId(row('local', 'demo-plugin:urn:skill:greet'))).toBeInTheDocument();
  });
});
