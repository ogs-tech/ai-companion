import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Main } from '../../../src/renderer/screens/Main.js';
import {
  mockApi,
  ok,
  fail,
  renderWithShell,
  type CallSpy,
} from '../test-utils.js';

const render = renderWithShell;

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

const DEFAULT_WORKSPACE = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };

const setupRoute = (overrides: Record<string, unknown> = {}) => {
  call.mockImplementation((method: string) => {
    if (method in overrides) return Promise.resolve(overrides[method]);
    if (method === 'instruction.get') {
      return Promise.resolve(fail('not_found', 'no global instruction'));
    }
    if (method === 'customization.list') return Promise.resolve(ok([]));
    if (method === 'skill.list') return Promise.resolve(ok([]));
    if (method === 'agent.list') return Promise.resolve(ok([]));
    if (method === 'command.list') return Promise.resolve(ok([]));
    if (method === 'reference.list') return Promise.resolve(ok([]));
    if (method === 'plugin.list') return Promise.resolve(ok([]));
    if (method === 'marketplace.list') return Promise.resolve(ok([]));
    // Lands the Workspace landing screen on the Global/default branch —
    // no active project, so no file browser (and its xterm session panel).
    if (method === 'workspace.getActive') return Promise.resolve(ok(DEFAULT_WORKSPACE));
    if (method === 'workspace.list') return Promise.resolve(ok([DEFAULT_WORKSPACE]));
    if (method === 'project.list') return Promise.resolve(ok([]));
    return Promise.resolve(ok(undefined));
  });
};

describe('<Main> — shell navigation', () => {
  it('renders the Workspace overview as the landing screen inside the shell', async () => {
    setupRoute();
    render(<Main onOpenSettings={() => undefined} />);

    expect(await screen.findByTestId('workspace-screen')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('nav-settings')).toBeInTheDocument();
  });

  it('navigates to the skills list via the Workspace sub-rail', async () => {
    setupRoute();
    render(<Main onOpenSettings={() => undefined} />);

    await screen.findByTestId('workspace-screen');
    await userEvent.click(screen.getByTestId('nav-skills'));

    expect(await screen.findByTestId('entity-list-skill')).toBeInTheDocument();
  });

  it('reaches the Starter Pack screen as an ordinary page via the top nav', async () => {
    setupRoute();
    render(<Main onOpenSettings={() => undefined} />);

    await screen.findByTestId('workspace-screen');
    await userEvent.click(screen.getByTestId('nav-starter-pack'));

    expect(await screen.findByTestId('starter-pack-screen')).toBeInTheDocument();
  });

  it('does not render linked repos UI in the landing view', async () => {
    setupRoute();
    render(<Main onOpenSettings={() => undefined} />);

    await screen.findByTestId('workspace-screen');
    expect(screen.queryByRole('button', { name: /add repo/i })).toBeNull();
  });
});
