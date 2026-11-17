import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityTreeRow, seedNewEntity, type EntityRowHandlers } from '../../../../src/renderer/components/workspace/EntityTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { Skill } from '../../../../src/shared/entity.js';
import { UndoableDeleteContext } from '../../../../src/renderer/hooks/use-undoable-delete.js';

function skill(overrides: Partial<Skill>): Skill {
  return {
    urn: `urn:skill:${overrides.name}`, kind: 'skill', enabled: true, name: 'unnamed', description: '', scopes: ['personal'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: '', ...overrides,
  };
}
const own = skill({ name: 'personal-skill' });
const ownItem = treeItem({ kind: 'skill', value: own }, { urn: own.urn, name: own.name });
const globalItem = treeItem({ kind: 'skill', value: own }, { urn: own.urn, name: own.name, origin: 'global' });

const handlers = (): EntityRowHandlers => ({ onEdit: vi.fn(), onPreview: vi.fn(), onProperties: vi.fn(), onNewAction: vi.fn() });

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async () => ok(undefined));
});

describe('EntityTreeRow', () => {
  it('opens the editor tab for an own item on click', async () => {
    const h = handlers();
    renderWithShell(<EntityTreeRow item={ownItem} handlers={h} />);
    await userEvent.setup().click(screen.getByTestId(rowId(ownItem)));
    expect(h.onEdit).toHaveBeenCalledWith('skill', own, false);
  });

  it('a Global item seen from a workspace is editable: opens its editor, with Editar and Excluir', async () => {
    const h = handlers();
    renderWithShell(<EntityTreeRow item={globalItem} handlers={h} />);
    const row = screen.getByTestId(rowId(globalItem));
    await userEvent.setup().click(row);
    expect(h.onEdit).toHaveBeenCalledWith('skill', own, false);
    fireEvent.contextMenu(row);
    expect(await screen.findByTestId('row-context-menu-edit')).toBeInTheDocument();
    expect(screen.getByTestId('row-context-menu-delete')).toBeInTheDocument();
  });

  it('Excluir hands the delete to the undo window, with no confirm dialog', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const requestDelete = vi.fn();
    renderWithShell(
      <UndoableDeleteContext.Provider value={requestDelete}>
        <EntityTreeRow item={ownItem} handlers={handlers()} />
      </UndoableDeleteContext.Provider>,
    );
    fireEvent.contextMenu(screen.getByTestId(rowId(ownItem)));
    await user.click(await screen.findByTestId('row-context-menu-delete'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(requestDelete).toHaveBeenCalledWith(expect.objectContaining({ key: ownItem.urn, message: '"personal-skill" excluído' }));
    expect(call).not.toHaveBeenCalledWith('skill.delete', expect.anything());
    await requestDelete.mock.calls[0]![0].commit();
    expect(call).toHaveBeenCalledWith('skill.delete', { id: 'personal-skill', removeSymlinks: true });
    confirmSpy.mockRestore();
  });

  it('right-click → "Nova sessão" passes the row\'s kind and entity through', async () => {
    const h = handlers();
    renderWithShell(<EntityTreeRow item={ownItem} handlers={h} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(ownItem)));
    fireEvent.click(await screen.findByTestId('row-context-menu-new-action'));
    expect(h.onNewAction).toHaveBeenCalledWith('skill', own);
  });

  it('shows a running-session badge when its entity has an active session', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'session.list'
        ? ok([{ sessionId: 'entity:urn:skill:personal-skill', anchor: { kind: 'entity', urn: own.urn }, cwd: '/x', label: own.name, status: 'running' }])
        : ok(undefined),
    );
    renderWithShell(<EntityTreeRow item={ownItem} handlers={handlers()} />);
    const row = screen.getByTestId(rowId(ownItem));
    expect(await within(row).findByTestId(`session-status-entity:${own.urn}`)).toHaveTextContent('Ocioso');
  });

  it('a problem shows the channel warning', () => {
    const failing = treeItem({ kind: 'skill', value: own }, { urn: own.urn, name: own.name, origin: 'global', problems: ['cursor'] });
    renderWithShell(<EntityTreeRow item={failing} handlers={handlers()} />);
    expect(screen.getByTestId(rowId(failing))).toHaveTextContent('Erro no Cursor');
  });

  it('seeds a new skill with the current localScope, and its folder when given', () => {
    expect(seedNewEntity('skill', { scope: 'workspace', scopeId: 'w1' })).toMatchObject({ scopes: ['workspace'], scopeId: 'w1' });
    expect(seedNewEntity('agent', { scope: 'workspace', scopeId: 'w1', folder: '/r/api' })).toMatchObject({ folder: '/r/api' });
    expect(seedNewEntity('skill', undefined).scopes).toEqual(['personal']);
  });
});

describe('EntityTreeRow — registry menu', () => {
  it('an own skill offers Visualizar, Editar, Desativar, Excluir, then Nova sessão', async () => {
    renderWithShell(<EntityTreeRow item={ownItem} handlers={handlers()} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(ownItem)));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Visualizar', 'Editar', 'Desativar', 'Excluir', 'Nova sessão']);
  });

  it('Desativar turns the skill off in every channel', async () => {
    renderWithShell(<EntityTreeRow item={ownItem} handlers={handlers()} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(ownItem)));
    fireEvent.click(await screen.findByTestId('row-context-menu-toggle'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('entity.setEnabled', { urn: ownItem.urn, enabled: false }));
  });

  it("a plugin's skill opens as a preview and offers only Visualizar and Nova sessão", async () => {
    const h = handlers();
    const pluginSkill = { ...own, source: { kind: 'plugin' as const, pluginId: 'superpowers', provenance: 'workspace-managed' as const } };
    const item = { ...ownItem, entity: { kind: 'skill' as const, value: pluginSkill } };
    renderWithShell(<EntityTreeRow item={item} handlers={h} />);
    fireEvent.click(screen.getByTestId(rowId(item)));
    expect(h.onPreview).toHaveBeenCalledWith(pluginSkill);
    expect(h.onEdit).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Visualizar', 'Nova sessão']);
  });
});
