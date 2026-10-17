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
  it('in a workspace, lists local items under "Neste workspace" and Global ones in a collapsed, read-only "Do Global"', async () => {
    const user = userEvent.setup();
    const props = workspaceProps();
    renderWithShell(<CustomizationsList {...props} />);

    expect(screen.getByTestId('control-panel-section-local')).toHaveTextContent('Neste workspace');
    expect(await screen.findByTestId('tree-skill-deploy')).toBeVisible();
    expect(screen.queryByTestId('tree-skill-lint')).not.toBeInTheDocument();
    expect(screen.getByTestId('tree-inherited-skill-lint')).not.toBeVisible();

    await user.click(screen.getByTestId('control-panel-section-global'));
    await user.click(screen.getByTestId('tree-inherited-skill-lint'));
    expect(props.onOpenInherited).toHaveBeenCalledWith(globalSkill, 'skill');
    expect(props.onEditEntity).not.toHaveBeenCalled();
    // No delete affordance on an inherited row.
    expect(screen.queryByTestId('tree-skill-delete-lint')).not.toBeInTheDocument();
  });

  it('at Início, shows a single editable "Global" section and no "Do Global"', async () => {
    renderWithShell(<CustomizationsList {...workspaceProps()} isHome localScope={undefined as never} />);
    expect(screen.getByTestId('control-panel-section-local')).toHaveTextContent('Global');
    expect(screen.queryByTestId('control-panel-section-global')).not.toBeInTheDocument();
    expect(await screen.findByTestId('tree-skill-deploy')).toBeInTheDocument();
    expect(screen.getByTestId('tree-skill-lint')).toBeInTheDocument();
  });

  it('filters by type chip: Skills, Agents and Integrações each show only their own rows', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('tree-skill-deploy');
    expect(screen.getByTestId('tree-agent-reviewer')).toBeInTheDocument();

    await user.click(screen.getByTestId('control-panel-chip-skill'));
    expect(screen.getByTestId('tree-skill-deploy')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-agent-reviewer')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('control-panel-chip-agent'));
    expect(screen.getByTestId('tree-agent-reviewer')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-skill-deploy')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('control-panel-chip-integrations'));
    expect(screen.queryByTestId('tree-agent-reviewer')).not.toBeInTheDocument();
    // Hooks are Global-only inside a workspace, so they sit in the collapsed "Do Global" section.
    expect(await screen.findByTestId('tree-hook-h1')).not.toBeVisible();

    await user.click(screen.getByTestId('control-panel-chip-all'));
    expect(screen.getByTestId('tree-skill-deploy')).toBeInTheDocument();
  });

  it('searches name and description across both scopes and expands "Do Global" on a hit', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('tree-skill-deploy');

    // By description, hitting only the Global skill.
    await user.type(screen.getByTestId('control-panel-search'), 'style');
    await waitFor(() => expect(screen.getByTestId('tree-inherited-skill-lint')).toBeVisible());
    expect(screen.queryByTestId('tree-skill-deploy')).not.toBeInTheDocument();

    // By name, hitting only the local one: Global stays collapsed.
    await user.clear(screen.getByTestId('control-panel-search'));
    await user.type(screen.getByTestId('control-panel-search'), 'DEPLOY');
    expect(await screen.findByTestId('tree-skill-deploy')).toBeVisible();
    expect(screen.queryByTestId('tree-inherited-skill-lint')).not.toBeInTheDocument();
    expect(screen.getByTestId('control-panel-global-rows')).not.toBeVisible();
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderWithShell(<CustomizationsList {...workspaceProps()} />);
    await screen.findByTestId('tree-skill-deploy');
    await user.type(screen.getByTestId('control-panel-search'), 'zzz-nothing');
    expect(await screen.findByTestId('control-panel-empty')).toHaveTextContent('zzz-nothing');
  });

  it('"+" creates the filtered type directly, and offers a Skill/Agent/Instruction menu on "Tudo"', async () => {
    const user = userEvent.setup();
    const props = workspaceProps();
    props.seedWorkspaceInstruction = () => ({ ...personalInstruction, name: 'acme', scopes: ['workspace'], scopeId: 'w1' }) as never;
    renderWithShell(<CustomizationsList {...props} />);
    await screen.findByTestId('tree-skill-deploy');

    await user.click(screen.getByTestId('control-panel-chip-agent'));
    await user.click(screen.getByTestId('control-panel-new'));
    expect(props.onEditEntity).toHaveBeenCalledWith('agent', expect.objectContaining({ kind: 'agent', scopeId: 'w1' }), true);

    await user.click(screen.getByTestId('control-panel-chip-all'));
    await user.click(screen.getByTestId('control-panel-new'));
    expect(await screen.findByTestId('control-panel-new-skill')).toBeInTheDocument();
    expect(screen.getByTestId('control-panel-new-agent')).toBeInTheDocument();
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
