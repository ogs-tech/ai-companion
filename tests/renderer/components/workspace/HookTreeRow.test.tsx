import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HookTreeRow } from '../../../../src/renderer/components/workspace/HookTreeRow.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { rowId, treeItem } from './tree-item-fixture.js';
import type { Hook } from '../../../../src/renderer/hooks/use-hooks.js';
import { UndoableDeleteContext } from '../../../../src/renderer/hooks/use-undoable-delete.js';

const own: Hook = { id: 'h1', event: 'PreToolUse', handler: { type: 'command', command: './fmt.sh' }, enabled: true, source: { kind: 'workspace' } };
const itemOf = (hook: Hook, opts: { disabled?: boolean; origin?: 'local' | 'global' | 'detected' } = {}) =>
  treeItem({ kind: 'hook', value: hook }, { urn: `urn:hook:${hook.id}`, name: 'fmt', ...opts });

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async () => ok(undefined));
});

describe('HookTreeRow', () => {
  it('Editar opens the hook editor on an own hook', async () => {
    const item = itemOf(own);
    renderWithShell(<HookTreeRow item={item} />);
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await userEvent.setup().click(await screen.findByTestId('row-context-menu-edit'));
    expect(await screen.findByTestId('hook-editor-dialog')).toBeInTheDocument();
  });

  it('Excluir hands the delete to the undo window, with no confirm dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const requestDelete = vi.fn();
    const item = itemOf(own);
    renderWithShell(
      <UndoableDeleteContext.Provider value={requestDelete}>
        <HookTreeRow item={item} />
      </UndoableDeleteContext.Provider>,
    );
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await userEvent.setup().click(await screen.findByTestId('row-context-menu-delete'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(requestDelete).toHaveBeenCalledWith(expect.objectContaining({ key: 'urn:hook:h1', message: '"fmt" excluído' }));
    await requestDelete.mock.calls[0]![0].commit();
    await waitFor(() => expect(call).toHaveBeenCalledWith('hook.delete', { id: 'h1', scope: 'personal' }));
    confirmSpy.mockRestore();
  });

  it('a disabled hook reads Desativado', () => {
    const item = itemOf({ ...own, enabled: false }, { disabled: true });
    renderWithShell(<HookTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).toHaveTextContent('Desativado');
  });

  it('imports a detected hook from its menu', async () => {
    const detected: Hook = { ...own, enabled: undefined as never, source: { kind: 'detected', detectedId: 'det-h', harness: 'cursor', importable: true } };
    const item = itemOf(detected, { origin: 'detected' });
    renderWithShell(<HookTreeRow item={item} />);
    expect(screen.getByTestId(rowId(item))).not.toHaveTextContent('Cursor');
    fireEvent.contextMenu(screen.getByTestId(rowId(item)));
    await userEvent.setup().click(await screen.findByTestId('row-context-menu-import'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('detected.import', { id: 'det-h' }));
  });
});
