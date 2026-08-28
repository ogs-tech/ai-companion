import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

const projectScoped = skill({ name: 'project-skill', scopes: ['project'], scopeId: 'p1' });
const personalScoped = skill({ name: 'personal-skill', scopes: ['personal'] });
const pluginSkill = skill({ name: 'plugin-skill', source: { kind: 'plugin', pluginId: 'acme', provenance: 'workspace-managed' } });

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'skill.list') return ok([projectScoped, personalScoped, pluginSkill]);
    return ok(undefined);
  });
});

describe('EntityTreeGroup', () => {
  it('with a localScope, only shows items matching it until "Mostrar globais" is toggled on', async () => {
    const user = userEvent.setup();
    renderWithShell(
      <EntityTreeGroup kind="skill" label="Skills" localScope={{ scope: 'project', scopeId: 'p1' }} showGlobal={false} />,
    );
    await user.click(await screen.findByTestId('tree-group-skill'));
    expect(await screen.findByTestId('tree-skill-project-skill')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-skill-personal-skill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-skill-plugin-skill')).not.toBeInTheDocument();
  });

  it('reveals non-local items once showGlobal is true', async () => {
    const user = userEvent.setup();
    renderWithShell(
      <EntityTreeGroup kind="skill" label="Skills" localScope={{ scope: 'project', scopeId: 'p1' }} showGlobal />,
    );
    await user.click(await screen.findByTestId('tree-group-skill'));
    expect(await screen.findByTestId('tree-skill-project-skill')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-skill-personal-skill')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-skill-plugin-skill')).toBeInTheDocument();
  });

  it('shows every item, unfiltered, when no localScope is given (the Default/personal tier)', async () => {
    const user = userEvent.setup();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    expect(await screen.findByTestId('tree-skill-project-skill')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-skill-personal-skill')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-skill-plugin-skill')).toBeInTheDocument();
  });

  it('seeds a new skill with the current localScope when creating from inside a project', async () => {
    const user = userEvent.setup();
    renderWithShell(
      <EntityTreeGroup kind="skill" label="Skills" localScope={{ scope: 'project', scopeId: 'p1' }} showGlobal={false} />,
    );
    await user.click(await screen.findByTestId('tree-group-new-skill'));
    expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
  });

  it('deletes a workspace-owned item after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    await user.click(await screen.findByTestId('tree-skill-delete-personal-skill'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('skill.delete', { id: 'personal-skill', removeSymlinks: true }),
    );
    confirmSpy.mockRestore();
  });

  it('does not offer edit/delete for a plugin-provided item', async () => {
    const user = userEvent.setup();
    renderWithShell(<EntityTreeGroup kind="skill" label="Skills" showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-skill'));
    await screen.findByTestId('tree-skill-plugin-skill');
    expect(screen.queryByTestId('tree-skill-delete-plugin-skill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-skill-edit-plugin-skill')).not.toBeInTheDocument();
  });
});
