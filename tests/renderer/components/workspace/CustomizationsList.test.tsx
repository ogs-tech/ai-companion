import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomizationsList, type CustomizationsListProps } from '../../../../src/renderer/components/workspace/CustomizationsList.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const metadata = { version: '0.1.0', createdAt: '', updatedAt: '' };
const source = { kind: 'workspace' as const };
const localSkill = { urn: 'urn:skill:deploy', kind: 'skill', name: 'deploy', description: 'Ship it', scopes: ['workspace'], scopeId: 'w1', metadata, source, content: '' };
const globalSkill = { urn: 'urn:skill:lint', kind: 'skill', name: 'lint', description: 'Style rules', scopes: ['personal'], metadata, source, content: '' };
const localAgent = { urn: 'urn:agent:reviewer', kind: 'agent', name: 'reviewer', description: 'Reviews PRs', scopes: ['workspace'], scopeId: 'w1', metadata, source, systemPrompt: '' };
const hook = { id: 'h1', event: 'PreToolUse', handler: { type: 'command', command: 'echo hi' }, source };
const personalInstruction = { urn: 'urn:instruction:default', kind: 'instruction', name: 'default', description: 'House rules', scopes: ['personal'], metadata, source, content: '# rules' };

let call: CallSpy;
beforeEach(() => {
  window.localStorage.clear();
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'skill.list') return ok([localSkill, globalSkill]);
    if (method === 'agent.list') return ok([localAgent]);
    if (method === 'hook.list') return ok([hook]);
    if (method === 'instruction.get') return ok(personalInstruction);
    if (method === 'instruction.list') return ok([personalInstruction]);
    return ok([]);
  });
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
  onOpenInherited: vi.fn(),
});

describe('CustomizationsList', () => {
  it('in a workspace, lists local items first and Global ones under their own read-only section', async () => {
    const user = userEvent.setup();
    const props = workspaceProps();
    renderWithShell(<CustomizationsList {...props} />);

    expect(await screen.findByTestId('tree-skill-deploy')).toBeVisible();
    expect(screen.queryByTestId('tree-skill-lint')).not.toBeInTheDocument();
    expect(screen.getByTestId('control-panel-section-local')).toHaveTextContent('Workspace');
    expect(screen.getByTestId('control-panel-section-global')).toHaveTextContent('Global');
    expect(screen.queryByTestId('origin-meta-global')).not.toBeInTheDocument();
    // Global's section starts closed: the workspace's own items stay in view.
    await waitFor(() => expect(screen.getByTestId('tree-inherited-skill-lint')).not.toBeVisible());

    await user.click(screen.getByTestId('control-panel-section-global'));
    expect(screen.getByTestId('tree-inherited-skill-lint')).toBeVisible();
    await user.click(screen.getByTestId('tree-inherited-skill-lint'));
    expect(props.onOpenInherited).toHaveBeenCalledWith(globalSkill, 'skill');
    expect(props.onEditEntity).not.toHaveBeenCalled();
    // No delete affordance on an inherited row.
    expect(screen.queryByTestId('tree-skill-delete-lint')).not.toBeInTheDocument();
  });

  it('at Início, shows a single editable list with no section title', async () => {
    renderWithShell(<CustomizationsList {...workspaceProps()} isHome localScope={undefined as never} />);
    expect(screen.queryByTestId('control-panel-section-local')).not.toBeInTheDocument();
    expect(await screen.findByTestId('tree-skill-deploy')).toBeInTheDocument();
    expect(screen.getByTestId('tree-skill-lint')).toBeInTheDocument();
  });

  it('searches name and description across both scopes', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('tree-skill-deploy');

    // By description, hitting only the Global skill.
    await user.type(screen.getByTestId('control-panel-search'), 'style');
    await waitFor(() => expect(screen.getByTestId('tree-inherited-skill-lint')).toBeVisible());
    expect(screen.queryByTestId('tree-skill-deploy')).not.toBeInTheDocument();

    // By name, hitting only the local one.
    await user.clear(screen.getByTestId('control-panel-search'));
    await user.type(screen.getByTestId('control-panel-search'), 'DEPLOY');
    expect(await screen.findByTestId('tree-skill-deploy')).toBeVisible();
    expect(screen.queryByTestId('tree-inherited-skill-lint')).not.toBeInTheDocument();
  });

  it('has no origin filter: the search is the only control, and Skills/Agents are always listed', async () => {
    renderWithShell(<CustomizationsList {...workspaceProps()} isHome localScope={undefined as never} />);
    await screen.findByTestId('tree-skill-deploy');
    expect(screen.getByTestId('personal-instruction-row')).toBeInTheDocument();
    expect(screen.queryByTestId('control-panel-origin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('control-panel-origin-chip')).not.toBeInTheDocument();
    expect(screen.getByTestId('tree-subgroup-type-local-agent')).toHaveTextContent('Agents');
  });

  it('keeps the Início section collapsed but counted, toggles it, and a search reopens it', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('tree-inherited-skill-lint');
    await waitFor(() => expect(screen.getByTestId('tree-inherited-skill-lint')).not.toBeVisible());
    expect(screen.getByTestId('control-panel-section-global')).toHaveTextContent(/\d+/);

    await user.click(screen.getByTestId('control-panel-section-global'));
    expect(screen.getByTestId('tree-inherited-skill-lint')).toBeVisible();
    await user.click(screen.getByTestId('control-panel-section-global'));
    await waitFor(() => expect(screen.getByTestId('tree-inherited-skill-lint')).not.toBeVisible());

    await user.type(screen.getByTestId('control-panel-search'), 'lint');
    expect(await screen.findByTestId('tree-inherited-skill-lint')).toBeVisible();
  });

  it('hides the Início section when a filter leaves nothing from it, and brings it back when cleared', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('tree-inherited-skill-lint');

    await user.type(screen.getByTestId('control-panel-search'), 'deploy');
    await waitFor(() => expect(screen.getByTestId('control-panel-section-global')).not.toBeVisible());

    await user.click(screen.getByTestId('control-panel-search-clear'));
    await waitFor(() => expect(screen.getByTestId('control-panel-section-global')).toBeVisible());
  });

  it('lists a plugin once, as a folder under Integrações, and keeps what it provides out of the type groups', async () => {
    const plugin = { kind: 'plugin' as const, pluginId: 'dev-kit@market' };
    const pluginSkill = { ...localSkill, urn: 'urn:skill:scaffold', name: 'scaffold', source: plugin };
    const pluginHook = { ...hook, id: 'h2', source: plugin };
    call.mockImplementation(async (method: string) => {
      if (method === 'skill.list') return ok([localSkill, pluginSkill]);
      if (method === 'hook.list') return ok([hook, pluginHook]);
      if (method === 'plugin.list') return ok([{ id: 'dev-kit@market', scope: 'personal', origin: 'imported', enabled: true }]);
      if (method === 'instruction.list') return ok([]);
      return ok([]);
    });
    renderWithShell(<CustomizationsList {...workspaceProps()} isHome localScope={undefined as never} />);

    expect(await screen.findByTestId('tree-skill-deploy')).toBeVisible();
    expect(await screen.findByTestId('tree-hook-h1')).toBeVisible();
    expect(screen.getByTestId('tree-subgroup-type-local-skill')).toHaveTextContent('Skills');
    expect(screen.getByTestId('tree-subgroup-type-local-integrations')).toHaveTextContent('Integrações');
    expect(screen.getByTestId('tree-subgroup-type-local-agent')).toHaveTextContent('Agents');
    // No origin-based "Plugins" block, and nothing a plugin ships is listed outside the plugin's own detail.
    expect(screen.queryByTestId('tree-subgroup-plugins-local')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-skill-scaffold')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-hook-h2')).not.toBeInTheDocument();
    // Hooks, MCP and Plugins are folders of Integrações; the plugin appears exactly once.
    expect(screen.getByTestId('tree-group-hook')).toHaveTextContent('Hooks');
    expect(screen.getByTestId('tree-group-mcp')).toHaveTextContent('MCP');
    expect(screen.getByTestId('tree-group-plugin')).toHaveTextContent('Plugins');
    expect(await screen.findAllByTestId('tree-plugin-dev-kit@market')).toHaveLength(1);
    expect(screen.queryByTestId('detail-drawer-plugin')).not.toBeInTheDocument();
  });

  it('sums the items with a problem up the folders, counting an item once however many channels fail', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'skill.list') return ok([localSkill]);
      if (method === 'hook.list') return ok([hook, { ...hook, id: 'h2' }, { ...hook, id: 'h3' }]);
      if (method === 'instruction.list') return ok([]);
      if (method === 'health.getReport') {
        const check = (id: string, urn: string, channel: string) => ({ id, category: 'merge-entry', severity: 'error', title: 't', entityUrn: urn, channel, observedAt: '' });
        return ok({ checks: [check('1', 'urn:hook:h1', 'claude'), check('2', 'urn:hook:h1', 'cursor'), check('3', 'urn:hook:h2', 'cursor')] });
      }
      return ok([]);
    });
    renderWithShell(<CustomizationsList {...workspaceProps()} isHome localScope={undefined as never} />);

    await waitFor(() => expect(screen.getByTestId('tree-hook-h1')).toHaveTextContent('⚠ Claude · Cursor'));
    expect(screen.getByTestId('tree-hook-h2')).toHaveTextContent('⚠ Cursor');
    expect(screen.getByTestId('tree-hook-h3')).not.toHaveTextContent('⚠');
    // Hooks: 2 items fail (h1 in both channels counts once), and Integrações sums its children.
    await waitFor(() => expect(screen.getByTestId('tree-group-hook')).toHaveTextContent('2 ⚠'));
    expect(screen.getByTestId('tree-subgroup-type-local-integrations')).toHaveTextContent('2 ⚠');
    expect(screen.getByTestId('tree-subgroup-type-local-skill')).not.toHaveTextContent('⚠');
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('tree-skill-deploy');
    await user.type(screen.getByTestId('control-panel-search'), 'zzz-nothing');
    expect(await screen.findByTestId('control-panel-empty')).toHaveTextContent('zzz-nothing');
  });

  it('"+" offers a Skill/Agent/Instruction/MCP/plugin menu, and no type chips exist', async () => {
    const user = userEvent.setup();
    const props = workspaceProps();
    props.seedWorkspaceInstruction = () => ({ ...personalInstruction, name: 'acme', scopes: ['workspace'], scopeId: 'w1' }) as never;
    renderWithShell(<CustomizationsList {...props} />);
    await screen.findByTestId('tree-skill-deploy');
    expect(screen.queryByTestId('control-panel-chip-all')).not.toBeInTheDocument();

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
    renderWithShell(<CustomizationsList {...workspaceProps()} isHome localScope={undefined as never} />);
    await screen.findByTestId('personal-instruction-row');
    await user.click(screen.getByTestId('control-panel-new'));
    expect(await screen.findByTestId('control-panel-new-skill')).toBeInTheDocument();
    expect(screen.queryByTestId('control-panel-new-instruction')).not.toBeInTheDocument();
  });
});
