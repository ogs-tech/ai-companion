import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HooksTreeGroup } from '../../../../src/renderer/components/workspace/HooksTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const hook = {
  id: 'h1',
  event: 'PreToolUse',
  handler: { type: 'command' as const, command: 'echo hi' },
  source: { kind: 'workspace' as const },
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'hook.list') return ok([hook]);
    return ok(undefined);
  });
});

describe('HooksTreeGroup', () => {
  it('at the Default tier (no isProjectContext), always shows hooks', async () => {
    const user = userEvent.setup();
    renderWithShell(<HooksTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-hook'));
    expect(await screen.findByTestId('tree-hook-h1')).toBeInTheDocument();
  });

  it('inside a project workspace, hides every hook until "Mostrar globais" is on — none of them are local', async () => {
    const user = userEvent.setup();
    renderWithShell(<HooksTreeGroup isProjectContext showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-hook'));
    expect(await screen.findByTestId('tree-group-empty-hook')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-hook-h1')).not.toBeInTheDocument();
  });

  it('reveals hooks once showGlobal is true', async () => {
    const user = userEvent.setup();
    renderWithShell(<HooksTreeGroup isProjectContext showGlobal />);
    await user.click(await screen.findByTestId('tree-group-hook'));
    expect(await screen.findByTestId('tree-hook-h1')).toBeInTheDocument();
  });

  it('deletes a workspace-owned hook after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithShell(<HooksTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-hook'));
    fireEvent.contextMenu(await screen.findByTestId('tree-hook-h1'));
    await user.click(await screen.findByTestId('row-context-menu-delete'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(call).toHaveBeenCalledWith('hook.delete', { id: 'h1', scope: 'personal' }));
    confirmSpy.mockRestore();
  });

  it('groups hooks by origin: own first and open, each plugin collapsed with its count', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method !== 'hook.list') return ok(undefined);
      const fromPlugin = (id: string, pluginId: string) => ({
        ...hook,
        id,
        event: 'SessionStart',
        source: { kind: 'plugin' as const, pluginId },
      });
      return ok([fromPlugin('p1', 'learning@market'), fromPlugin('p2', 'explanatory@market'), hook]);
    });
    renderWithShell(<HooksTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-hook'));
    expect(await screen.findByTestId('tree-hook-h1')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-hook-p1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('tree-subgroup-hook-learning@market'));
    expect(await screen.findByTestId('tree-hook-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-hook-p2')).not.toBeInTheDocument();
  });
});
