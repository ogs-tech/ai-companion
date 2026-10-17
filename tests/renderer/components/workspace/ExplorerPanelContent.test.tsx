import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplorerPanelContent } from '../../../../src/renderer/components/workspace/ExplorerPanelContent.js';
import { fail, mockApi, ok, renderWithQuery, type CallSpy } from '../../test-utils.js';
import type { GitFileChange, GitStatus } from '../../../../src/shared/git.js';
import type { Workspace } from '../../../../src/shared/workspace.js';

const file = (path: string, index: GitFileChange['index'], worktree: GitFileChange['worktree'], conflicted = false): GitFileChange => ({
  path,
  index,
  worktree,
  conflicted,
});

const repo = (files: GitFileChange[], extra: Partial<Extract<GitStatus, { isRepo: true }>> = {}): GitStatus => ({
  isRepo: true,
  head: { name: 'main', oid: 'abcdef1234', ahead: 0, behind: 0 },
  state: 'clean',
  files,
  truncated: false,
  ...extra,
});

const workspace = { id: 'w1', name: 'proj', rootPath: '/p' } as Workspace;

let call: CallSpy;

function route(overrides: Partial<Record<string, unknown>> = {}): void {
  call.mockImplementation(async (method: string, params: unknown) => {
    if (method in overrides) return overrides[method];
    if (method === 'git.status') return ok(repo([]));
    if (method === 'workspace.listDir') {
      const path = (params as { path: string }).path;
      if (path === '') return ok([{ name: 'src', kind: 'dir' }, { name: 'b.md', kind: 'file' }]);
      if (path === 'src') return ok([{ name: 'a.ts', kind: 'file' }]);
      return ok([]);
    }
    if (method === 'workspace.list') return ok([]);
    return ok(undefined);
  });
}

function renderPanel(isHome = false) {
  const onOpenGitDiff = vi.fn();
  const onSelectFile = vi.fn();
  renderWithQuery(
    <ExplorerPanelContent
      activeWorkspace={isHome ? null : workspace}
      isHome={isHome}
      gitPolling
      appAreaRows={<div data-testid="app-rows" />}
      onSelectFile={onSelectFile}
      onOpenAsWorkspace={vi.fn()}
      onPreviewFile={vi.fn()}
      onNewAction={vi.fn()}
      onOpenGitDiff={onOpenGitDiff}
    />,
  );
  return { onOpenGitDiff, onSelectFile };
}

beforeEach(() => {
  call = mockApi();
  window.localStorage.clear();
  route();
});

describe('ExplorerPanelContent', () => {
  it('has no Arquivos | Git toggle in a workspace and never queries git at Início', async () => {
    renderPanel(true);
    expect(await screen.findByTestId('app-rows')).toBeInTheDocument();
    expect(screen.queryByTestId('explorer-view-git')).not.toBeInTheDocument();
    expect(call).not.toHaveBeenCalledWith('git.status', expect.anything());

    renderPanel();
    expect(await screen.findByTestId('git-head')).toBeInTheDocument();
    expect(screen.queryByTestId('explorer-view-files')).not.toBeInTheDocument();
  });

  it('decorates files and parent folders, and opens the file on click', async () => {
    route({ 'git.status': ok(repo([file('src/a.ts', 'unmodified', 'modified'), file('b.md', 'untracked', 'untracked')])) });
    const { onSelectFile } = renderPanel();

    expect(await screen.findByTestId('git-badge-b.md')).toHaveTextContent('U');
    expect(screen.getByTestId('git-dirty-dir-src')).toBeInTheDocument();
    await userEvent.click(screen.getByText('src'));
    expect(await screen.findByTestId('git-badge-src/a.ts')).toHaveTextContent('M');

    await userEvent.click(screen.getByText('b.md'));
    expect(onSelectFile).toHaveBeenCalledWith('b.md');
  });

  it('offers both diffs for a partially staged file via the context menu', async () => {
    route({ 'git.status': ok(repo([file('b.md', 'modified', 'modified')])) });
    const { onOpenGitDiff } = renderPanel();

    await userEvent.pointer({ keys: '[MouseRight]', target: await screen.findByText('b.md') });
    await userEvent.click(screen.getByTestId('row-context-menu-git-open-diff-staged'));
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByText('b.md') });
    await userEvent.click(screen.getByTestId('row-context-menu-git-open-diff-worktree'));

    expect(onOpenGitDiff.mock.calls).toEqual([
      [{ path: 'b.md', source: { kind: 'index' } }],
      [{ path: 'b.md', source: { kind: 'worktree' } }],
    ]);
  });

  it('stages, unstages and discards from the context menu', async () => {
    route({ 'git.status': ok(repo([file('b.md', 'modified', 'modified')])) });
    renderPanel();

    await userEvent.pointer({ keys: '[MouseRight]', target: await screen.findByText('b.md') });
    await userEvent.click(screen.getByTestId('row-context-menu-git-stage'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.stage', { paths: ['b.md'] }));

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByText('b.md') });
    await userEvent.click(screen.getByTestId('row-context-menu-git-unstage'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.unstage', { paths: ['b.md'] }));

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByText('b.md') });
    await userEvent.click(screen.getByTestId('row-context-menu-git-discard'));
    await userEvent.click(screen.getByTestId('git-discard-confirm-btn'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.discard', { paths: ['b.md'] }));
  });

  it('lists deleted files under "Removidos" with an openable diff', async () => {
    route({ 'git.status': ok(repo([file('old.ts', 'unmodified', 'deleted')])) });
    const { onOpenGitDiff } = renderPanel();

    expect(await screen.findByTestId('git-removed-header')).toBeInTheDocument();
    expect(screen.getByTestId('git-badge-old.ts')).toHaveTextContent('D');
    await userEvent.click(screen.getByTestId('git-removed-old.ts'));
    expect(onOpenGitDiff).toHaveBeenCalledWith({ path: 'old.ts', source: { kind: 'worktree' } });
  });

  it('warns about an in-progress operation and notes truncation', async () => {
    route({ 'git.status': ok(repo([file('b.md', 'modified', 'modified', true)], { state: 'merging', truncated: true })) });
    renderPanel();
    expect(await screen.findByTestId('git-state-banner')).toHaveTextContent('merging');
    expect(screen.getByTestId('git-truncated')).toHaveTextContent('1 arquivos');
    expect(await screen.findByTestId('git-badge-b.md')).toHaveTextContent('!');
  });

  it('explains a missing git binary in the toolbar and keeps the tree', async () => {
    route({ 'git.status': fail('io', 'GitNotFound') });
    renderPanel();
    expect(await screen.findByTestId('git-not-found')).toBeInTheDocument();
    expect(await screen.findByText('b.md')).toBeInTheDocument();
  });

  it('offers git init when the folder is not a repo', async () => {
    route({ 'git.status': ok({ isRepo: false }) });
    renderPanel();

    expect(await screen.findByTestId('git-init-card')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('git-init-trigger'));
    await userEvent.click(screen.getByTestId('git-init-btn'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.init', {}));
  });
});

describe('ExplorerToolbar', () => {
  it('shows ahead/behind and disables Stage all without worktree changes', async () => {
    route({ 'git.status': ok(repo([file('a.ts', 'added', 'unmodified')], { head: { name: 'feat/x', oid: 'abc', ahead: 2, behind: 1 } })) });
    renderPanel();

    const chip = await screen.findByTestId('git-head');
    expect(chip).toHaveTextContent('feat/x');
    expect(chip).toHaveTextContent('↑2 ↓1');
    expect(screen.getByTestId('git-stage-all')).toBeDisabled();
  });

  it('stages all worktree changes', async () => {
    route({ 'git.status': ok(repo([file('b.md', 'unmodified', 'modified'), file('c.md', 'untracked', 'untracked')])) });
    renderPanel();
    await userEvent.click(await screen.findByTestId('git-stage-all'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.stage', { paths: ['b.md', 'c.md'] }));
  });

  it('opens the commit popover and closes it once the commit succeeds', async () => {
    route({ 'git.status': ok(repo([file('a.ts', 'added', 'unmodified')])), 'git.commit': ok({ sha: 'x' }) });
    renderPanel();

    await userEvent.click(await screen.findByTestId('git-commit-open'));
    await userEvent.type(screen.getByTestId('git-commit-message'), 'fix: thing');
    await userEvent.click(screen.getByTestId('git-commit-btn'));

    await waitFor(() => expect(call).toHaveBeenCalledWith('git.commit', { message: 'fix: thing', amend: false }));
    await waitFor(() => expect(screen.queryByTestId('git-commit-message')).not.toBeInTheDocument());
  });

  it('keeps the popover open and shows the error when the commit fails', async () => {
    route({
      'git.status': ok(repo([file('a.ts', 'added', 'unmodified')])),
      'git.commit': { ok: false, error: { kind: 'io', message: 'hook failed', details: { stderr: 'eslint: 3 errors' } } },
    });
    renderPanel();

    await userEvent.click(await screen.findByTestId('git-commit-open'));
    await userEvent.type(screen.getByTestId('git-commit-message'), 'msg');
    await userEvent.click(screen.getByTestId('git-commit-btn'));

    const alert = await screen.findByTestId('git-error');
    expect(alert).toHaveTextContent('hook failed');
    await userEvent.click(within(alert).getByTestId('git-error-details-toggle'));
    expect(screen.getByTestId('git-error-details')).toHaveTextContent('eslint: 3 errors');
    expect(screen.getByTestId('git-commit-message')).toHaveValue('msg');
  });
});

describe('Explorer status actions', () => {
  it('shows staged/changes chips and hides a chip whose count is 0', async () => {
    route({ 'git.status': ok(repo([file('a.ts', 'added', 'unmodified'), file('b.md', 'unmodified', 'modified'), file('c.md', 'untracked', 'untracked')])) });
    renderPanel();
    expect(await screen.findByTestId('git-chip-staged')).toHaveTextContent('1 staged');
    expect(screen.getByTestId('git-chip-changes')).toHaveTextContent('2 changes');
  });

  it('omits the chips and disables Unstage all on a clean tree', async () => {
    renderPanel();
    await screen.findByTestId('git-head');
    expect(screen.queryByTestId('git-chip-staged')).not.toBeInTheDocument();
    expect(screen.queryByTestId('git-chip-changes')).not.toBeInTheDocument();
    expect(screen.getByTestId('git-unstage-all')).toBeDisabled();
  });

  it('unstages every staged file from the toolbar', async () => {
    route({ 'git.status': ok(repo([file('a.ts', 'added', 'unmodified'), file('b.md', 'modified', 'modified')])) });
    renderPanel();
    await userEvent.click(await screen.findByTestId('git-unstage-all'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.unstage', { paths: ['a.ts', 'b.md'] }));
  });

  it.each([
    ['unstaged only (M)', file('b.md', 'unmodified', 'modified'), ['stage', 'discard'], ['unstage']],
    ['untracked (U)', file('b.md', 'untracked', 'untracked'), ['stage', 'discard'], ['unstage']],
    ['staged only', file('b.md', 'added', 'unmodified'), ['unstage'], ['stage', 'discard']],
    ['both sides (M·M)', file('b.md', 'modified', 'modified'), ['stage', 'unstage', 'discard'], []],
  ])('file row %s offers the right inline actions', async (_name, change, present, absent) => {
    route({ 'git.status': ok(repo([change])) });
    renderPanel();
    await screen.findByTestId('git-head');
    for (const key of present) expect(await screen.findByTestId(`git-row-${key}-b.md`)).toBeInTheDocument();
    for (const key of absent) expect(screen.queryByTestId(`git-row-${key}-b.md`)).not.toBeInTheDocument();
  });

  it('stages, unstages and asks to discard from the row, without opening the file', async () => {
    route({ 'git.status': ok(repo([file('b.md', 'modified', 'modified')])) });
    const { onSelectFile } = renderPanel();

    await userEvent.click(await screen.findByTestId('git-row-stage-b.md'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.stage', { paths: ['b.md'] }));
    await userEvent.click(screen.getByTestId('git-row-unstage-b.md'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.unstage', { paths: ['b.md'] }));
    await userEvent.click(screen.getByTestId('git-row-discard-b.md'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(call).not.toHaveBeenCalledWith('git.discard', expect.anything());
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('stages and unstages a whole folder by its own path', async () => {
    route({ 'git.status': ok(repo([file('src/a.ts', 'modified', 'modified')])) });
    renderPanel();
    await userEvent.click(await screen.findByTestId('git-row-stage-src'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.stage', { paths: ['src'] }));
    await userEvent.click(screen.getByTestId('git-row-unstage-src'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.unstage', { paths: ['src'] }));
    expect(screen.queryByTestId('git-row-discard-src')).not.toBeInTheDocument();
  });

  it('offers no folder action when nothing under it would be affected', async () => {
    route({ 'git.status': ok(repo([file('b.md', 'unmodified', 'modified')])) });
    renderPanel();
    await screen.findByTestId('git-row-stage-b.md');
    expect(screen.queryByTestId('git-row-stage-src')).not.toBeInTheDocument();
    expect(screen.queryByTestId('git-row-unstage-src')).not.toBeInTheDocument();
  });
});

describe('AI commit message', () => {
  const staged = (): GitStatus => repo([file('a.ts', 'added', 'unmodified')]);

  async function openPopover(): Promise<void> {
    await userEvent.click(await screen.findByTestId('git-commit-open'));
  }

  it('fills the editable field without committing, then offers Regerar', async () => {
    route({ 'git.status': ok(staged()), 'git.generateCommitMessage': ok({ message: 'feat: add a' }) });
    renderPanel();
    await openPopover();

    await userEvent.click(screen.getByTestId('git-generate-btn'));
    await waitFor(() => expect(screen.getByTestId('git-commit-message')).toHaveValue('feat: add a'));
    expect(screen.getByTestId('git-generate-btn')).toHaveTextContent('Regerar');
    expect(call).not.toHaveBeenCalledWith('git.commit', expect.anything());
  });

  it('disables Gerar and Commit while generating', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    route({ 'git.status': ok(staged()) });
    const base = call.getMockImplementation() as (method: string, params: unknown) => Promise<unknown>;
    call.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'git.generateCommitMessage') {
        await gate;
        return ok({ message: 'feat: x' });
      }
      return base(method, params);
    });
    renderPanel();
    await openPopover();
    await userEvent.type(screen.getByTestId('git-commit-message'), 'draft');
    await userEvent.clear(screen.getByTestId('git-commit-message'));
    await userEvent.click(screen.getByTestId('git-generate-btn'));

    expect(screen.getByTestId('git-generate-btn')).toHaveTextContent('Gerando');
    expect(screen.getByTestId('git-generate-btn')).toBeDisabled();
    expect(screen.getByTestId('git-commit-btn')).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByTestId('git-generate-btn')).toBeEnabled());
  });

  it('asks before replacing existing text, and cancel keeps it', async () => {
    route({ 'git.status': ok(staged()), 'git.generateCommitMessage': ok({ message: 'feat: new' }) });
    renderPanel();
    await openPopover();
    await userEvent.type(screen.getByTestId('git-commit-message'), 'mine');

    await userEvent.click(screen.getByTestId('git-generate-btn'));
    expect(screen.getByTestId('git-generate-confirm')).toBeInTheDocument();
    expect(call).not.toHaveBeenCalledWith('git.generateCommitMessage', expect.anything());
    await userEvent.click(screen.getByTestId('git-generate-cancel'));
    expect(screen.getByTestId('git-commit-message')).toHaveValue('mine');

    await userEvent.click(screen.getByTestId('git-generate-btn'));
    await userEvent.click(screen.getByTestId('git-generate-replace'));
    await waitFor(() => expect(screen.getByTestId('git-commit-message')).toHaveValue('feat: new'));
  });

  it('shows the error inline and leaves the field untouched', async () => {
    route({
      'git.status': ok(staged()),
      'git.generateCommitMessage': { ok: false, error: { kind: 'not_found', message: 'Command not found: claude' } },
    });
    renderPanel();
    await openPopover();
    await userEvent.click(screen.getByTestId('git-generate-btn'));

    expect(await screen.findByTestId('git-error')).toHaveTextContent('Command not found: claude');
    expect(screen.getByTestId('git-commit-message')).toHaveValue('');
    expect(screen.getByTestId('git-generate-btn')).toBeEnabled();
  });

  it('disables Gerar with a hint when nothing is staged', async () => {
    route({ 'git.status': ok(repo([file('b.md', 'unmodified', 'modified')])) });
    renderPanel();
    await openPopover();
    expect(screen.getByTestId('git-generate-btn')).toBeDisabled();
    expect(screen.getByTestId('git-generate-hint')).toHaveTextContent('Faça stage');
  });

  it('disables Gerar while Amend is ticked', async () => {
    route({ 'git.status': ok(staged()) });
    renderPanel();
    await openPopover();
    expect(screen.getByTestId('git-generate-btn')).toBeEnabled();
    await userEvent.click(screen.getByTestId('git-commit-amend'));
    expect(screen.getByTestId('git-generate-btn')).toBeDisabled();
  });
});

describe('Git sync button', () => {
  type Head = Extract<GitStatus, { isRepo: true }>['head'];
  const withHead = (head: Partial<Head> & { untracked?: boolean }, extra: Partial<Extract<GitStatus, { isRepo: true }>> = {}) => {
    const { untracked, ...rest } = head;
    const base: Head = { name: 'main', oid: 'abc', ahead: 0, behind: 0, ...(untracked ? {} : { upstream: 'origin/main' }) };
    route({ 'git.status': ok(repo([], { head: { ...base, ...rest }, ...extra })) });
  };

  it.each([
    [{ untracked: true }, 'Publicar branch'],
    [{ ahead: 2 }, 'Push 2'],
    [{ behind: 3 }, 'Pull 3'],
    [{ ahead: 1, behind: 4 }, 'Sincronizar ↑1 ↓4'],
    [{}, 'Fetch'],
  ])('labels %j as "%s"', async (head, label) => {
    withHead(head);
    renderPanel();
    expect(await screen.findByTestId('git-sync-button')).toHaveTextContent(label);
  });

  it('hides the button on an unborn branch and disables it mid-merge', async () => {
    withHead({ oid: null });
    renderPanel();
    await screen.findByTestId('git-head');
    expect(screen.queryByTestId('git-sync')).not.toBeInTheDocument();
  });

  it('disables sync while a merge is in progress', async () => {
    withHead({ ahead: 1 }, { state: 'merging' });
    renderPanel();
    expect(await screen.findByTestId('git-sync-menu')).toBeDisabled();
    expect(screen.queryByTestId('git-sync-button')).not.toBeInTheDocument();
  });

  it('runs git.sync on click', async () => {
    withHead({ ahead: 1 });
    renderPanel();
    await userEvent.click(await screen.findByTestId('git-sync-button'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.sync', {}));
  });

  it('runs the individual ops from the ⋯ menu', async () => {
    withHead({ ahead: 1 });
    renderPanel();
    await userEvent.click(await screen.findByTestId('git-sync-menu'));
    await userEvent.click(screen.getByTestId('git-sync-fetch'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.fetch', {}));
    await userEvent.click(screen.getByTestId('git-sync-menu'));
    await userEvent.click(screen.getByTestId('git-sync-push'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.push', {}));
  });

  it('disables Pull in the menu without an upstream', async () => {
    withHead({ untracked: true });
    renderPanel();
    await userEvent.click(await screen.findByTestId('git-sync-menu'));
    expect(screen.getByTestId('git-sync-pull')).toHaveAttribute('aria-disabled', 'true');
  });

  it('offers "Pull e tentar de novo" after a rejected push and re-syncs', async () => {
    withHead({ ahead: 1 });
    route({
      'git.status': ok(repo([], { head: { name: 'main', oid: 'abc', upstream: 'origin/main', ahead: 1, behind: 0 } })),
      'git.sync': { ok: false, error: { kind: 'conflict', message: 'Push rejeitado', details: { reason: 'push_rejected', stderr: '! [rejected]' } } },
    });
    renderPanel();
    await userEvent.click(await screen.findByTestId('git-sync-button'));
    const alert = await screen.findByTestId('git-error');
    expect(alert).toHaveTextContent('Push rejeitado');

    await userEvent.click(within(alert).getByTestId('git-error-pull-retry'));
    await waitFor(() => expect(call.mock.calls.filter(([m]) => m === 'git.sync')).toHaveLength(2));
  });
});
