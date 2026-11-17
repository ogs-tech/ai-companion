import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityTreeRow, seedNewEntity, type EntityRowHandlers } from '../../../../src/renderer/components/workspace/EntityTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { Skill } from '../../../../src/shared/entity.js';

function skill(overrides: Partial<Skill>): Skill {
  return {
    urn: `urn:skill:${overrides.name}`, kind: 'skill', name: 'unnamed', description: '', scopes: ['personal'],
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: '', ...overrides,
  };
}
const own = skill({ name: 'personal-skill' });
const ownItem = treeItem({ kind: 'skill', value: own }, { urn: own.urn, name: own.name });
const globalItem = treeItem({ kind: 'skill', value: own }, { urn: own.urn, name: own.name, origin: 'global' });

const handlers = (): EntityRowHandlers => ({ onEdit: vi.fn(), onOpenInherited: vi.fn(), onPreview: vi.fn(), onProperties: vi.fn(), onNewAction: vi.fn() });

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

  it('a Global item is read-only: opens inherited, dimmed, with no delete or Properties', async () => {
    const h = handlers();
    renderWithShell(<EntityTreeRow item={globalItem} handlers={h} />);
    const row = screen.getByTestId(rowId(globalItem));
    await userEvent.setup().click(row);
    expect(h.onOpenInherited).toHaveBeenCalledWith(own, 'skill');
    expect(h.onEdit).not.toHaveBeenCalled();
    fireEvent.contextMenu(row);
    expect(await screen.findByTestId('row-context-menu-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('row-context-menu-delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-context-menu-properties')).not.toBeInTheDocument();
  });

  it('deletes an own item after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithShell(<EntityTreeRow item={ownItem} handlers={handlers()} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(ownItem)));
    await user.click(await screen.findByTestId('row-context-menu-delete'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(call).toHaveBeenCalledWith('skill.delete', { id: 'personal-skill', removeSymlinks: true }));
    confirmSpy.mockRestore();
  });

  it('right-click → "New Action" passes the row\'s kind and entity through', async () => {
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
    expect(screen.getByTestId(rowId(failing))).toHaveTextContent('⚠ Cursor');
  });

  it('seeds a new skill with the current localScope, and its folder when given', () => {
    expect(seedNewEntity('skill', { scope: 'workspace', scopeId: 'w1' })).toMatchObject({ scopes: ['workspace'], scopeId: 'w1' });
    expect(seedNewEntity('agent', { scope: 'workspace', scopeId: 'w1', folder: '/r/api' })).toMatchObject({ folder: '/r/api' });
    expect(seedNewEntity('skill', undefined).scopes).toEqual(['personal']);
  });
});
