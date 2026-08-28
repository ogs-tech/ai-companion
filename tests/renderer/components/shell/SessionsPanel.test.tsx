import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsPanel } from '../../../../src/renderer/components/shell/SessionsPanel.js';
import { SessionFocusProvider, useSessionFocus } from '../../../../src/renderer/lib/session-focus-context.js';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../../test-utils.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return ok({ id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
    if (method === 'session.status') return ok(null);
    return ok(null);
  });
});

function Harness(): React.ReactElement {
  const { focusSession } = useSessionFocus();
  return (
    <>
      <button onClick={() => focusSession({ kind: 'workspace', workspaceId: 'w1' }, 'Acme')}>open acme</button>
      <button onClick={() => focusSession({ kind: 'project', projectId: 'p1' }, 'apps')}>open apps</button>
      <SessionsPanel />
    </>
  );
}

const renderHarness = () =>
  renderWithQuery(
    <SessionFocusProvider>
      <Harness />
    </SessionFocusProvider>,
  );

describe('SessionsPanel', () => {
  it('renders nothing when no session has been opened', () => {
    renderHarness();
    expect(screen.queryByTestId('sessions-panel')).not.toBeInTheDocument();
  });

  it('shows the panel, expanded, with a tab row for the opened session', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'open acme' }));
    expect(screen.getByTestId('sessions-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-panel-tab-workspace:w1')).toHaveTextContent('Acme');
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
  });

  it('collapsing hides the tab list but keeps the terminal mounted', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'open acme' }));
    await user.click(screen.getByTestId('sessions-panel-collapse'));

    expect(screen.queryByTestId('sessions-panel-tab-workspace:w1')).not.toBeInTheDocument();
    expect(screen.getByTestId('sessions-panel-expand')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
  });

  it('keeps both terminals mounted when a second session is opened, showing only the focused one', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'open acme' }));
    await user.click(screen.getByRole('button', { name: 'open apps' }));

    expect(screen.getAllByTestId('session-panel')).toHaveLength(2);
    expect(screen.getByTestId('sessions-panel-stage-project:p1')).toHaveStyle({ display: 'flex' });
    expect(screen.getByTestId('sessions-panel-stage-workspace:w1')).toHaveStyle({ display: 'none' });
  });

  it('clicking a tab row switches which session is visible', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'open acme' }));
    await user.click(screen.getByRole('button', { name: 'open apps' }));
    await user.click(screen.getByTestId('sessions-panel-tab-workspace:w1'));

    expect(screen.getByTestId('sessions-panel-stage-workspace:w1')).toHaveStyle({ display: 'flex' });
    expect(screen.getByTestId('sessions-panel-stage-project:p1')).toHaveStyle({ display: 'none' });
  });
});
