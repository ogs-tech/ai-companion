import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionFocusProvider, useSessionFocus } from '../../../src/renderer/lib/session-focus-context.js';
import { useActiveWorkspace } from '../../../src/renderer/hooks/use-workspaces.js';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../test-utils.js';

let call: CallSpy;

const workspaceA = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const workspaceB = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };

beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return ok(workspaceA);
    return ok(null);
  });
});

function Probe(): React.ReactElement {
  const { openTabs, focusedSessionId, expanded, focusSession, toggleExpanded } = useSessionFocus();
  const { data: activeWorkspace } = useActiveWorkspace();
  return (
    <div>
      <span data-testid="tab-count">{openTabs.length}</span>
      <span data-testid="focused">{focusedSessionId ?? ''}</span>
      <span data-testid="expanded">{String(expanded)}</span>
      <span data-testid="active-workspace">{activeWorkspace?.id ?? ''}</span>
      <button onClick={() => focusSession({ kind: 'workspace', workspaceId: 'w1' }, 'Acme')}>open acme</button>
      <button onClick={() => focusSession({ kind: 'project', projectId: 'p1' }, 'apps')}>open apps</button>
      <button onClick={toggleExpanded}>toggle</button>
    </div>
  );
}

describe('SessionFocusProvider', () => {
  it('adds a tab and focuses it when a session is opened', async () => {
    renderWithQuery(
      <SessionFocusProvider>
        <Probe />
      </SessionFocusProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open acme' }));
    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    expect(screen.getByTestId('focused')).toHaveTextContent('workspace:w1');
    expect(screen.getByTestId('expanded')).toHaveTextContent('true');
  });

  it('does not duplicate a tab when the same anchor is opened twice, but re-focuses it', async () => {
    renderWithQuery(
      <SessionFocusProvider>
        <Probe />
      </SessionFocusProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open acme' }));
    await userEvent.click(screen.getByRole('button', { name: 'open apps' }));
    await userEvent.click(screen.getByRole('button', { name: 'open acme' }));
    expect(screen.getByTestId('tab-count')).toHaveTextContent('2');
    expect(screen.getByTestId('focused')).toHaveTextContent('workspace:w1');
  });

  it('toggles expanded state', async () => {
    renderWithQuery(
      <SessionFocusProvider>
        <Probe />
      </SessionFocusProvider>,
    );
    expect(screen.getByTestId('expanded')).toHaveTextContent('false');
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('expanded')).toHaveTextContent('true');
  });

  it('clears open tabs when the active workspace changes', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(workspaceA);
      return ok(null);
    });
    const { client } = renderWithQuery(
      <SessionFocusProvider>
        <Probe />
      </SessionFocusProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open acme' }));
    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');

    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(workspaceB);
      return ok(null);
    });
    await client.invalidateQueries({ queryKey: ['workspace', 'active'] });

    await waitFor(() => expect(screen.getByTestId('tab-count')).toHaveTextContent('0'));
    expect(screen.getByTestId('focused')).toHaveTextContent('');
  });

  it('keeps a tab opened before the initial active-workspace lookup resolves', async () => {
    let resolveActive: ((value: ReturnType<typeof ok<typeof workspaceA>>) => void) | undefined;
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') {
        return new Promise((resolve) => {
          resolveActive = resolve;
        });
      }
      return ok(null);
    });

    renderWithQuery(
      <SessionFocusProvider>
        <Probe />
      </SessionFocusProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'open acme' }));
    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');

    resolveActive?.(ok(workspaceA));

    await waitFor(() => expect(screen.getByTestId('active-workspace')).toHaveTextContent('default'));
    expect(screen.getByTestId('tab-count')).toHaveTextContent('1');
    expect(screen.getByTestId('focused')).toHaveTextContent('workspace:w1');
  });

  it('throws when used outside a SessionFocusProvider', () => {
    expect(() => renderWithQuery(<Probe />)).toThrow('useSessionFocus must be used within SessionFocusProvider');
  });
});
