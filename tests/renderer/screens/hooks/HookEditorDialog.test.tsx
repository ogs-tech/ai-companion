import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HookEditorDialog } from '../../../../src/renderer/screens/hooks/HookEditorDialog.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { Hook } from '../../../../src/renderer/hooks/use-hooks.js';

const settings = { adapters: { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: false } } };
const report = { generatedAt: '', worst: 'ok', counts: { ok: 0, warning: 0, error: 0 }, checks: [] };
const existing: Hook = {
  id: 'hook-1a2b3c4d', event: 'PreToolUse', matcher: 'Bash', handler: { type: 'command', command: './check.sh', timeout: 30 },
  enabled: true, source: { kind: 'workspace' },
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'settings.get') return ok(settings);
    if (method === 'health.getReport') return ok(report);
    if (method === 'hook.save') return ok({ hook: existing, syncReport: [] });
    return ok(undefined);
  });
});

async function pickEvent(user: ReturnType<typeof userEvent.setup>, event: string): Promise<void> {
  await user.click(within(screen.getByTestId('hook-editor-event')).getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: event }));
}

describe('HookEditorDialog', () => {
  it('creates a hook from event, matcher and command', async () => {
    const user = userEvent.setup();
    renderWithShell(<HookEditorDialog open mode="create" scope="personal" onClose={() => undefined} onSaved={() => undefined} />);
    await pickEvent(user, 'PreToolUse');
    await user.type(within(screen.getByTestId('hook-editor-matcher')).getByRole('textbox'), 'Bash');
    await user.type(within(screen.getByTestId('hook-editor-command')).getByRole('textbox'), './check.sh');
    await user.click(screen.getByTestId('hook-editor-save'));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('hook.save', {
        scope: 'personal',
        hook: { event: 'PreToolUse', matcher: 'Bash', handler: { type: 'command', command: './check.sh' }, enabled: true },
      }),
    );
  });

  it('cannot save without a command', async () => {
    const user = userEvent.setup();
    renderWithShell(<HookEditorDialog open mode="create" scope="personal" onClose={() => undefined} onSaved={() => undefined} />);
    await pickEvent(user, 'Stop');
    expect(screen.getByTestId('hook-editor-save')).toBeDisabled();
  });

  it('edits an existing hook, keeping its id, timeout and enabled switch, and shows where it goes', async () => {
    const user = userEvent.setup();
    renderWithShell(<HookEditorDialog open mode="edit" initial={existing} scope="personal" onClose={() => undefined} onSaved={() => undefined} />);
    expect(await screen.findByTestId('channel-sync')).toBeInTheDocument();
    const matcher = within(screen.getByTestId('hook-editor-matcher')).getByRole('textbox');
    await user.clear(matcher);
    await user.type(matcher, 'Read');
    await user.click(within(screen.getByTestId('hook-editor-enabled')).getByRole('checkbox'));
    await user.click(screen.getByTestId('hook-editor-save'));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('hook.save', {
        scope: 'personal',
        hook: { id: 'hook-1a2b3c4d', event: 'PreToolUse', matcher: 'Read', handler: { type: 'command', command: './check.sh', timeout: 30 }, enabled: false },
      }),
    );
  });
});
