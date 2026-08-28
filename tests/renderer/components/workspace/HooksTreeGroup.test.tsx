import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
    await user.click(await screen.findByTestId('tree-hook-delete-h1'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(call).toHaveBeenCalledWith('hook.delete', { id: 'h1', scope: 'personal' }));
    confirmSpy.mockRestore();
  });
});
