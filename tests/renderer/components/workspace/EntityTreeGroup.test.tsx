import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityTreeGroup } from '../../../../src/renderer/components/workspace/EntityTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { Skill } from '../../../../src/shared/entity.js';

function skill(overrides: Partial<Skill>): Skill {
  return {
    urn: `urn:skill:${overrides.name}`,
    kind: 'skill',
    name: 'unnamed',
    description: '',
    scopes: ['personal'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: { kind: 'workspace' },
    content: '',
    ...overrides,
  };
}

const workspaceScoped = skill({ name: 'workspace-skill', scopes: ['workspace'], scopeId: 'w1' });
const personalScoped = skill({ name: 'personal-skill', scopes: ['personal'] });
const pluginSkill = skill({ name: 'plugin-skill', source: { kind: 'plugin', pluginId: 'acme', provenance: 'workspace-managed' } });

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'skill.list') return ok([workspaceScoped, personalScoped, pluginSkill]);
    return ok(undefined);
  });
});

describe('EntityTreeGroup', () => {
  it('with a localScope, only shows items matching it', async () => {
    const user = userEvent.setup();
    renderWithShell(
      <EntityTreeGroup kind="skill" label="Skills" localScope={{ scope: 'workspace', scopeId: 'w1' }} onEdit={vi.fn()} />,
    );
    await user.click(await screen.findByTestId('tree-group-skill'));
    expect(await screen.findByTestId('tree-skill-workspace-skill')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-skill-personal-skill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-skill-plugin-skill')).not.toBeInTheDocument();
  });

  describe('inherited (the workspace\'s "Herdado do Global")', () => {
    const renderInherited = (onEdit = vi.fn()) =>
      renderWithShell(
        <EntityTreeGroup kind="skill" label="Skills" localScope={{ scope: 'workspace', scopeId: 'w1' }} inherited onEdit={onEdit} />,
      );

    it('lists only the items that do NOT belong to the localScope', async () => {
      const user = userEvent.setup();
      renderInherited();
      await user.click(await screen.findByTestId('tree-group-inherited-skill'));
      expect(await screen.findByTestId('tree-inherited-skill-personal-skill')).toBeInTheDocument();
      await user.click(screen.getByTestId('tree-subgroup-inherited-skill-acme'));
      expect(await screen.findByTestId('tree-inherited-skill-plugin-skill')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-inherited-skill-workspace-skill')).not.toBeInTheDocument();
    });

    it('is read-only: no create action, no delete action', async () => {
      const user = userEvent.setup();
      renderInherited();
      await user.click(await screen.findByTestId('tree-group-inherited-skill'));
      await screen.findByTestId('tree-inherited-skill-personal-skill');
      expect(screen.queryByTestId('tree-group-new-inherited-skill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tree-skill-delete-personal-skill')).not.toBeInTheDocument();
    });

    it('row click hands the entity to onEdit (the caller opens it read-only)', async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      renderInherited(onEdit);
      await user.click(await screen.findByTestId('tree-group-inherited-skill'));
      await user.click(await screen.findByTestId('tree-inherited-skill-personal-skill'));
      expect(onEdit).toHaveBeenCalledWith('skill', personalScoped, false);
    });
  });

  it('shows every item, unfiltered, when no localScope is given (at Início)', async () => {
    const user = userEvent.setup();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    expect(await screen.findByTestId('tree-skill-workspace-skill')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-skill-personal-skill')).toBeInTheDocument();
    await user.click(await screen.findByTestId('tree-subgroup-skill-acme'));
    expect(await screen.findByTestId('tree-skill-plugin-skill')).toBeInTheDocument();
  });

  it('seeds a new skill with the current localScope when creating from inside a workspace', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderWithShell(
      <EntityTreeGroup kind="skill" label="Skills" localScope={{ scope: 'workspace', scopeId: 'w1' }} onEdit={onEdit} />,
    );
    await user.click(await screen.findByTestId('tree-group-new-skill'));
    expect(onEdit).toHaveBeenCalledWith(
      'skill',
      expect.objectContaining({ scopes: ['workspace'], scopeId: 'w1' }),
      true,
    );
  });

  it('opens the editor tab for an existing item on click of the row', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={onEdit} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    await user.click(await screen.findByTestId('tree-skill-personal-skill'));
    expect(onEdit).toHaveBeenCalledWith('skill', expect.objectContaining({ name: 'personal-skill' }), false);
  });

  it('deletes a workspace-owned item after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    fireEvent.contextMenu(await screen.findByTestId('tree-skill-personal-skill'));
    await user.click(await screen.findByTestId('row-context-menu-delete'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('skill.delete', { id: 'personal-skill', removeSymlinks: true }),
    );
    confirmSpy.mockRestore();
  });

  it('shows a running-session badge only on the row whose entity has an active session', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'skill.list') return ok([workspaceScoped, personalScoped, pluginSkill]);
      if (method === 'session.list') {
        return ok([
          {
            sessionId: 'entity:urn:skill:personal-skill',
            anchor: { kind: 'entity', urn: 'urn:skill:personal-skill' },
            cwd: '/x',
            label: 'personal-skill',
            status: 'running',
          },
        ]);
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-skill'));

    const activeRow = await screen.findByTestId('tree-skill-personal-skill');
    expect(within(activeRow).getByTestId('session-status-entity:urn:skill:personal-skill')).toHaveTextContent('Ocioso');

    const idleRow = await screen.findByTestId('tree-skill-workspace-skill');
    expect(within(idleRow).queryByTestId('session-status-entity:urn:skill:workspace-skill')).not.toBeInTheDocument();
  });

  it('does not offer a delete action for a plugin-provided item, but the row still opens it (read-only) in the editor tab', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={onEdit} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    await user.click(await screen.findByTestId('tree-subgroup-skill-acme'));
    await screen.findByTestId('tree-skill-plugin-skill');
    expect(screen.queryByTestId('tree-skill-delete-plugin-skill')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('tree-skill-plugin-skill'));
    expect(onEdit).toHaveBeenCalledWith('skill', expect.objectContaining({ name: 'plugin-skill' }), false);
  });

  it('right-click → "New Action" passes the row\'s kind and entity through', async () => {
    const user = userEvent.setup();
    const onNewAction = vi.fn();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={vi.fn()} onNewAction={onNewAction} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    const row = await screen.findByTestId('tree-skill-personal-skill');
    fireEvent.contextMenu(row);
    const item = await screen.findByTestId('row-context-menu-new-action');
    fireEvent.click(item);
    expect(onNewAction).toHaveBeenCalledWith('skill', expect.objectContaining({ name: 'personal-skill' }));
  });

  describe('grouping by origin', () => {
    const mine = skill({ name: 'my-skill' });
    const acmeA = skill({ name: 'acme-a', source: { kind: 'plugin', pluginId: 'acme@market', provenance: 'workspace-managed' } });
    const acmeB = skill({ name: 'acme-b', source: { kind: 'plugin', pluginId: 'acme@market', provenance: 'workspace-managed' } });
    const zeta = skill({ name: 'zeta-a', source: { kind: 'plugin', pluginId: 'zeta@market', provenance: 'workspace-managed' } });

    beforeEach(() => {
      localStorage.clear();
      call.mockImplementation(async (method: string) => (method === 'skill.list' ? ok([zeta, acmeB, mine, acmeA]) : ok(undefined)));
    });

    it('opens "Meus" and keeps each plugin collapsed, with counts', async () => {
      const user = userEvent.setup();
      renderWithShell(<EntityTreeGroup kind="skill" label="Skills" onEdit={vi.fn()} />);
      await user.click(await screen.findByTestId('tree-group-skill'));
      expect(await screen.findByTestId('tree-skill-my-skill')).toBeInTheDocument();
      expect(within(screen.getByTestId('tree-subgroup-skill-acme@market')).getByText('2')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-skill-acme-a')).not.toBeInTheDocument();
      const headers = screen.getAllByTestId(/^tree-subgroup-skill-/).map((el) => el.getAttribute('data-testid'));
      expect(headers).toEqual(['tree-subgroup-skill-mine', 'tree-subgroup-skill-acme@market', 'tree-subgroup-skill-zeta@market']);
    });

    it('expands a plugin on click and remembers it across remounts', async () => {
      const user = userEvent.setup();
      const first = renderWithShell(<EntityTreeGroup kind="skill" label="Skills" flat onEdit={vi.fn()} />);
      await user.click(await screen.findByTestId('tree-subgroup-skill-acme@market'));
      expect(await screen.findByTestId('tree-skill-acme-a')).toBeInTheDocument();
      first.unmount();
      renderWithShell(<EntityTreeGroup kind="skill" label="Skills" flat onEdit={vi.fn()} />);
      expect(await screen.findByTestId('tree-skill-acme-a')).toBeInTheDocument();
    });

    it('force-opens plugin groups while searching', async () => {
      renderWithShell(<EntityTreeGroup kind="skill" label="Skills" flat query="zeta" onEdit={vi.fn()} />);
      expect(await screen.findByTestId('tree-skill-zeta-a')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-subgroup-skill-acme@market')).not.toBeInTheDocument();
    });

    it('stays a plain list when there are no plugin items', async () => {
      call.mockImplementation(async (method: string) => (method === 'skill.list' ? ok([mine]) : ok(undefined)));
      renderWithShell(<EntityTreeGroup kind="skill" label="Skills" flat onEdit={vi.fn()} />);
      expect(await screen.findByTestId('tree-skill-my-skill')).toBeInTheDocument();
      expect(screen.queryByTestId(/^tree-subgroup-/)).not.toBeInTheDocument();
    });
  });
});
