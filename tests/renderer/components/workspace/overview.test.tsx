import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeOverview } from '../../../../src/renderer/components/workspace/overview/HomeOverview.js';
import { WorkspaceOverview } from '../../../../src/renderer/components/workspace/overview/WorkspaceOverview.js';
import { todayFilters } from '../../../../src/renderer/components/workspace/overview/OverviewCard.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { Workspace } from '../../../../src/shared/workspace.js';

const ACME: Workspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '', lastOpenedAt: '2026-10-10T10:00:00.000Z' };
const BRAVO: Workspace = { id: 'w2', name: 'Bravo', rootPath: '/repos/bravo', createdAt: '', lastOpenedAt: '2026-10-11T10:00:00.000Z' };

const RUNNING = {
  sessionId: 'personal', claudeSessionId: 'c1', anchor: { kind: 'personal' }, cwd: '/home/u',
  label: 'Início', status: 'running', browserEnabled: false,
};

let call: CallSpy;
const answer = (answers: Record<string, unknown>) =>
  call.mockImplementation(async (method: string) => ok(method in answers ? answers[method] : undefined));

beforeEach(() => {
  call = mockApi();
});

describe('todayFilters', () => {
  it('pins both bounds to local midday today, so no timezone shifts the day', () => {
    const { from, to } = todayFilters(new Date(2026, 9, 12, 23, 30));
    expect(from).toBe(to);
    const midday = new Date(from);
    expect([midday.getFullYear(), midday.getMonth(), midday.getDate(), midday.getHours()]).toEqual([2026, 9, 12, 12]);
  });
});

describe('HomeOverview', () => {
  const renderHome = (props: Partial<React.ComponentProps<typeof HomeOverview>> = {}) =>
    renderWithShell(
      <HomeOverview onOpenSession={vi.fn()} onOpenHistory={vi.fn()} onOpenDiagnostics={vi.fn()} onError={vi.fn()} {...props} />,
    );

  it('lists running sessions, opens one on click, and shows today\'s spend with a history link', async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    const onOpenHistory = vi.fn();
    answer({ 'session.list': [RUNNING], 'sessionHistory.stats': { totalCostUsd: 1.5, unpricedCount: 0, sessionCount: 1, perDay: [], models: [] } });
    renderHome({ onOpenSession, onOpenHistory });
    await user.click(await screen.findByTestId('overview-session-personal'));
    expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'personal' }));
    await waitFor(() => expect(screen.getByTestId('overview-today-spend')).toHaveTextContent('1.50'));
    expect(call).toHaveBeenCalledWith('sessionHistory.stats', expect.objectContaining({ scope: { kind: 'all' } }));
    await user.click(screen.getByTestId('overview-see-history'));
    expect(onOpenHistory).toHaveBeenCalled();
  });

  it('lists recents newest first and switches on click', async () => {
    const user = userEvent.setup();
    answer({ 'workspace.list': [ACME, BRAVO], 'workspace.getActive': null, 'workspace.switchTo': BRAVO });
    renderHome();
    const card = await screen.findByTestId('overview-card-recents');
    await waitFor(() => expect(within(card).getAllByTestId(/^overview-recent-/)).toHaveLength(2));
    expect(within(card).getAllByTestId(/^overview-recent-/).map((r) => r.getAttribute('data-testid'))).toEqual([
      'overview-recent-w2',
      'overview-recent-w1',
    ]);
    await user.click(screen.getByTestId('overview-recent-w2'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'w2' }));
  });

  it('offers "Abrir pasta…" when there are no recents', async () => {
    answer({ 'workspace.list': [] });
    renderHome();
    expect(await screen.findByTestId('overview-open-folder')).toBeInTheDocument();
  });

  it('shows the worst health severity, the top two problems, and links to Diagnóstico', async () => {
    const user = userEvent.setup();
    const onOpenDiagnostics = vi.fn();
    const check = (id: string, severity: string) => ({ id, category: 'symlink', severity, title: `check ${id}`, observedAt: '' });
    answer({
      'health.getReport': {
        generatedAt: '', worst: 'error', counts: { ok: 1, warning: 2, error: 1 },
        checks: [check('a', 'warning'), check('b', 'ok'), check('c', 'error'), check('d', 'warning')],
      },
    });
    renderHome({ onOpenDiagnostics });
    expect(await screen.findByTestId('status-pill-overview-health-worst')).toHaveTextContent('Erro');
    const shown = screen.getAllByTestId(/^overview-health-check-/).map((r) => r.getAttribute('data-testid'));
    expect(shown).toEqual(['overview-health-check-c', 'overview-health-check-a']);
    await user.click(screen.getByTestId('overview-open-diagnostics'));
    expect(onOpenDiagnostics).toHaveBeenCalled();
  });

  it('summarizes Global: personal instruction, counts and per-harness state', async () => {
    const entity = (name: string) => ({ urn: `urn:skill:${name}`, name });
    answer({
      'instruction.get': { urn: 'urn:instruction:default', name: 'default' },
      'skill.list': [entity('a'), entity('b')],
      'agent.list': [entity('c')],
      'mcp.list': [],
      'settings.get': { ui: { theme: 'light' }, adapters: { claude: { enabled: true }, cursor: { enabled: false } }, language: 'off' },
    });
    renderHome();
    await waitFor(() => expect(screen.getByTestId('overview-global-instruction')).toHaveTextContent('configurada'));
    await waitFor(() => expect(screen.getByTestId('overview-global-skills')).toHaveTextContent('2'));
    expect(screen.getByTestId('overview-global-agents')).toHaveTextContent('1');
    expect(screen.getByTestId('overview-global-mcp')).toHaveTextContent('0');
    expect(await screen.findByTestId('overview-harness-claude')).toHaveAttribute('data-enabled', 'true');
  });
});

describe('WorkspaceOverview', () => {
  const renderWorkspace = (props: Partial<React.ComponentProps<typeof WorkspaceOverview>> = {}) =>
    renderWithShell(
      <WorkspaceOverview
        workspace={ACME}
        visible
        onShowGit={vi.fn()}
        onNewSession={vi.fn()}
        onOpenSession={vi.fn()}
        onOpenInstruction={vi.fn()}
        onOpenTerminal={vi.fn()}
        onError={vi.fn()}
        {...props}
      />,
    );

  it('summarizes git and links to the Git view', async () => {
    const user = userEvent.setup();
    const onShowGit = vi.fn();
    answer({
      'git.status': {
        isRepo: true, head: { name: 'main', oid: 'abc', upstream: 'origin/main', ahead: 2, behind: 1 },
        state: 'clean', files: [{ path: 'a', index: 'modified', worktree: 'unmodified', conflicted: false }], truncated: false,
      },
    });
    renderWorkspace({ onShowGit });
    expect(await screen.findByTestId('overview-git-branch')).toHaveTextContent('main');
    expect(screen.getByTestId('overview-git-changes')).toHaveTextContent('1 alteração(ões)');
    expect(screen.getByTestId('overview-git-changes')).toHaveTextContent('↑2 ↓1');
    await user.click(screen.getByTestId('overview-show-git'));
    expect(onShowGit).toHaveBeenCalled();
  });

  it('offers "Inicializar repositório" when the folder is not a repo', async () => {
    const user = userEvent.setup();
    answer({ 'git.status': { isRepo: false } });
    renderWorkspace();
    await user.click(await screen.findByTestId('overview-git-init'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.init', {}));
  });

  it('starts a new session from the Sessões card', async () => {
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    answer({});
    renderWorkspace({ onNewSession });
    await user.click(await screen.findByTestId('overview-new-session'));
    expect(onNewSession).toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith('sessionHistory.stats', expect.objectContaining({ scope: { kind: 'workspace', workspaceId: 'w1' } }));
  });

  it('opens the workspace instruction, or offers to create one', async () => {
    const user = userEvent.setup();
    const onOpenInstruction = vi.fn();
    const instruction = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme', description: '', scopes: ['workspace'], scopeId: 'w1',
      metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: 'a\nb\nc',
    };
    answer({ 'instruction.list': [instruction] });
    renderWorkspace({ onOpenInstruction });
    expect(await screen.findByTestId('overview-instruction-open')).toHaveTextContent('3 linhas');
    await user.click(screen.getByTestId('overview-instruction-open'));
    expect(onOpenInstruction).toHaveBeenCalledWith(instruction, false);
  });

  it('offers "Criar instruction" when the workspace has none', async () => {
    const user = userEvent.setup();
    const onOpenInstruction = vi.fn();
    answer({ 'instruction.list': [] });
    renderWorkspace({ onOpenInstruction });
    await user.click(await screen.findByTestId('overview-instruction-create'));
    expect(onOpenInstruction).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['workspace'], scopeId: 'w1' }), true);
  });

  it('runs a supported launch config and opens its terminal', async () => {
    const user = userEvent.setup();
    const onOpenTerminal = vi.fn();
    const terminal = { terminalId: 'p1', workspaceId: 'w1', kind: 'launch', name: 'dev', relCwd: '', status: 'running', exitCode: null, generation: 0 };
    answer({
      'launchConfig.list': {
        workspaceId: 'w1',
        configs: [
          { name: 'dev', type: 'node', request: 'launch', program: 'x', args: [], supported: true },
          { name: 'web', type: 'chrome', request: 'launch', program: '', args: [], supported: false },
        ],
      },
      'launchConfig.run': terminal,
    });
    renderWorkspace({ onOpenTerminal });
    await user.click(await screen.findByTestId('overview-launch-run-dev'));
    await waitFor(() => expect(onOpenTerminal).toHaveBeenCalledWith(terminal));
    expect(screen.queryByTestId('overview-launch-run-web')).not.toBeInTheDocument();
  });

  it('hides the Launch card when there are no configs', async () => {
    answer({ 'launchConfig.list': null });
    renderWorkspace();
    await screen.findByTestId('overview-card-git');
    expect(screen.queryByTestId('overview-card-launch')).not.toBeInTheDocument();
  });
});
