import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalsSection } from '../../../../src/renderer/components/workspace/TerminalsSection.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { TerminalSnapshot } from '../../../../src/shared/terminal.js';

const term = (over: Partial<TerminalSnapshot>): TerminalSnapshot => ({
  terminalId: 't1', workspaceId: 'w1', kind: 'shell', name: 'zsh', relCwd: '', status: 'running', exitCode: null, generation: 0, ...over,
});

let call: CallSpy;
const answer = (answers: Record<string, unknown>) =>
  call.mockImplementation(async (method: string) => ok(method in answers ? answers[method] : undefined));

const props = () => ({
  openTerminalIds: new Set<string>(),
  onOpen: vi.fn(),
  onRemoved: vi.fn(),
  onEditLaunchJson: vi.fn(),
  onError: vi.fn(),
});

beforeEach(() => {
  call = mockApi();
});

describe('TerminalsSection', () => {
  it('shows an empty state with no terminals', async () => {
    answer({ 'terminal.list': [], 'launchConfig.list': null });
    renderWithShell(<TerminalsSection {...props()} />);
    expect(await screen.findByTestId('terminals-empty')).toBeInTheDocument();
  });

  it('describes a row: name, relative cwd, launch tag, "sem aba", and the exit code', async () => {
    answer({
      'terminal.list': [
        term({ terminalId: 'a', name: 'zsh', relCwd: '' }),
        term({ terminalId: 'b', kind: 'launch', name: 'Run server', relCwd: 'apps/api', status: 'exited', exitCode: 2 }),
      ],
      'launchConfig.list': null,
    });
    const p = props();
    renderWithShell(<TerminalsSection {...p} openTerminalIds={new Set(['a'])} />);
    const a = await screen.findByTestId('terminal-row-a');
    expect(a).toHaveTextContent('zsh');
    expect(a).toHaveTextContent('raiz');
    expect(a).not.toHaveTextContent('sem aba');
    const b = screen.getByTestId('terminal-row-b');
    expect(b).toHaveTextContent('Run server');
    expect(b).toHaveTextContent('apps/api');
    expect(b).toHaveTextContent('launch');
    expect(b).toHaveTextContent('sem aba');
    expect(screen.getByTestId('terminal-exit-b')).toHaveTextContent('2');
  });

  it('offers stop on a running row, and restart + remove on an exited one', async () => {
    answer({
      'terminal.list': [term({ terminalId: 'a' }), term({ terminalId: 'b', status: 'exited', exitCode: 0 })],
      'launchConfig.list': null,
    });
    renderWithShell(<TerminalsSection {...props()} />);
    const a = await screen.findByTestId('terminal-row-a');
    expect(within(a).getByTestId('terminal-stop-a')).toBeInTheDocument();
    expect(within(a).queryByTestId('terminal-restart-a')).not.toBeInTheDocument();
    const b = screen.getByTestId('terminal-row-b');
    expect(within(b).getByTestId('terminal-restart-b')).toBeInTheDocument();
    expect(within(b).getByTestId('terminal-remove-b')).toBeInTheDocument();
    expect(within(b).queryByTestId('terminal-stop-b')).not.toBeInTheDocument();
  });

  it('stop kills without opening the row', async () => {
    const user = userEvent.setup();
    answer({ 'terminal.list': [term({ terminalId: 'a' })], 'launchConfig.list': null });
    const p = props();
    renderWithShell(<TerminalsSection {...p} />);
    await user.click(await screen.findByTestId('terminal-stop-a'));
    expect(call).toHaveBeenCalledWith('terminal.kill', { terminalId: 'a' });
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it('restart reopens the terminal; remove reports it so its tab can go', async () => {
    const user = userEvent.setup();
    const exited = term({ terminalId: 'b', status: 'exited', exitCode: 1 });
    answer({ 'terminal.list': [exited], 'launchConfig.list': null, 'terminal.restart': { ...exited, status: 'running', generation: 1 } });
    const p = props();
    renderWithShell(<TerminalsSection {...p} />);
    await user.click(await screen.findByTestId('terminal-restart-b'));
    expect(call).toHaveBeenCalledWith('terminal.restart', { terminalId: 'b' });
    await vi.waitFor(() => expect(p.onOpen).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'b', generation: 1 })));
    await user.click(screen.getByTestId('terminal-remove-b'));
    await vi.waitFor(() => expect(p.onRemoved).toHaveBeenCalledWith('b'));
  });

  it('clicking a row opens its tab', async () => {
    const user = userEvent.setup();
    answer({ 'terminal.list': [term({ terminalId: 'a' })], 'launchConfig.list': null });
    const p = props();
    renderWithShell(<TerminalsSection {...p} />);
    await user.click(await screen.findByTestId('terminal-row-a'));
    expect(p.onOpen).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'a' }));
  });

  it('the + menu lists root, folder picker and launch configs; unsupported ones are disabled', async () => {
    const user = userEvent.setup();
    answer({
      'terminal.list': [],
      'launchConfig.list': {
        workspaceId: 'w1',
        configs: [
          { name: 'dev', type: 'node', request: 'launch', program: 'x', args: [], supported: true },
          { name: 'web', type: 'chrome', request: 'launch', args: [], supported: false },
        ],
      },
    });
    renderWithShell(<TerminalsSection {...props()} />);
    await user.click(await screen.findByTestId('terminals-new-menu'));
    expect(await screen.findByTestId('terminals-menu-root')).toBeInTheDocument();
    expect(screen.getByTestId('terminals-menu-pick')).toBeInTheDocument();
    expect(screen.getByTestId('terminals-menu-launch-dev')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('terminals-menu-launch-web')).toHaveAttribute('aria-disabled', 'true');
  });

  it('"Novo terminal em…" filters the workspace folders and Enter opens a shell in the match', async () => {
    const user = userEvent.setup();
    const created = term({ terminalId: 'n', relCwd: 'apps/console' });
    answer({
      'terminal.list': [],
      'launchConfig.list': null,
      'workspace.listFolders': ['apps', 'apps/console', 'libs'],
      'terminal.create': created,
    });
    const p = props();
    renderWithShell(<TerminalsSection {...p} />);
    await user.click(await screen.findByTestId('terminals-new-menu'));
    await user.click(await screen.findByTestId('terminals-menu-pick'));
    await user.type(await screen.findByTestId('folder-picker-input'), 'cons{Enter}');
    expect(call).toHaveBeenCalledWith('terminal.create', { relCwd: 'apps/console' });
    await vi.waitFor(() => expect(p.onOpen).toHaveBeenCalledWith(created));
  });

  it('Enter on the unfiltered picker opens the root', async () => {
    const user = userEvent.setup();
    answer({ 'terminal.list': [], 'launchConfig.list': null, 'workspace.listFolders': ['apps'], 'terminal.create': term({}) });
    renderWithShell(<TerminalsSection {...props()} />);
    await user.click(await screen.findByTestId('terminals-new-menu'));
    await user.click(await screen.findByTestId('terminals-menu-pick'));
    await user.type(await screen.findByTestId('folder-picker-input'), '{Enter}');
    expect(call).toHaveBeenCalledWith('terminal.create', {});
  });

  it('reports a failed create through onError', async () => {
    const user = userEvent.setup();
    call.mockImplementation(async (method: string) => {
      if (method === 'terminal.create') return { ok: false, error: { kind: 'io', message: 'spawn failed' } };
      return ok(method === 'terminal.list' ? [] : null);
    });
    const p = props();
    renderWithShell(<TerminalsSection {...p} />);
    await user.click(await screen.findByTestId('terminals-new-menu'));
    await user.click(await screen.findByTestId('terminals-menu-root'));
    await vi.waitFor(() => expect(p.onError).toHaveBeenCalledWith('spawn failed'));
  });
});
