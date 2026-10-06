import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GitView } from '../../../../../src/renderer/components/workspace/git/GitView.js';
import { groupChanges } from '../../../../../src/renderer/components/workspace/git/ChangeList.js';
import { fail, mockApi, ok, renderWithQuery, type CallSpy } from '../../../test-utils.js';
import type { GitFileChange, GitStatus } from '../../../../../src/shared/git.js';
import type { Project } from '../../../../../src/shared/project.js';

const file = (
  path: string,
  index: GitFileChange['index'],
  worktree: GitFileChange['worktree'],
  conflicted = false,
): GitFileChange => ({
  path,
  index,
  worktree,
  conflicted,
});

const repo = (
  files: GitFileChange[],
  extra: Partial<Extract<GitStatus, { isRepo: true }>> = {},
): GitStatus => ({
  isRepo: true,
  head: { name: 'main', oid: 'abcdef1234', ahead: 0, behind: 0 },
  state: 'clean',
  files,
  truncated: false,
  ...extra,
});

let call: CallSpy;

function route(overrides: Partial<Record<string, unknown>> = {}): void {
  call.mockImplementation(async (method: string) => {
    if (method in overrides) {
      const value = overrides[method];
      return typeof value === 'function' ? (value as () => unknown)() : value;
    }
    if (method === 'git.status') return ok(repo([]));
    return ok(undefined);
  });
}

function renderView(props: { projectId?: string; projects?: Project[] } = {}) {
  const onOpenDiff = vi.fn();
  const onSelectProject = vi.fn();
  renderWithQuery(
    <GitView
      projectId={props.projectId}
      visible
      projects={props.projects ?? []}
      onSelectProject={onSelectProject}
      onOpenDiff={onOpenDiff}
    />,
  );
  return { onOpenDiff, onSelectProject };
}

beforeEach(() => {
  call = mockApi();
  route();
});

describe('groupChanges', () => {
  it('puts a partially staged file in both groups and conflicts only under changes', () => {
    const both = file('both.ts', 'modified', 'modified');
    const conflict = file('c.ts', 'modified', 'modified', true);
    const untracked = file('n.ts', 'untracked', 'untracked');
    const staged = file('s.ts', 'added', 'unmodified');
    const groups = groupChanges([both, conflict, untracked, staged]);
    expect(groups.staged).toEqual([both, staged]);
    expect(groups.changes).toEqual([both, conflict, untracked]);
  });
});

describe('GitView', () => {
  it('shows the non-repo empty state and initializes on request', async () => {
    route({ 'git.status': ok({ isRepo: false }) });
    renderView({ projectId: 'p1' });

    await userEvent.click(await screen.findByTestId('git-init-btn'));

    expect(call).toHaveBeenCalledWith('git.init', { projectId: 'p1' });
  });

  it('explains a missing git binary', async () => {
    route({ 'git.status': fail('io', 'GitNotFound') });
    renderView();
    expect(await screen.findByTestId('git-not-found')).toBeInTheDocument();
  });

  it('lists staged and unstaged groups with branch info', async () => {
    route({
      'git.status': ok(
        repo([file('src/a.ts', 'modified', 'unmodified'), file('b.md', 'untracked', 'untracked')], {
          head: { name: 'feat/x', oid: 'abc', ahead: 2, behind: 0 },
        }),
      ),
    });
    renderView();

    expect(await screen.findByTestId('git-row-staged-src/a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('git-row-changes-b.md')).toBeInTheDocument();
    expect(screen.getByTestId('git-badge-changes-b.md')).toHaveTextContent('U');
    expect(screen.getByTestId('git-head')).toHaveTextContent('feat/x');
    expect(screen.getByTestId('git-head')).toHaveTextContent('↑2');
  });

  it('opens the right diff source for each group, scoped to the project', async () => {
    route({ 'git.status': ok(repo([file('a.ts', 'modified', 'modified')])) });
    const { onOpenDiff } = renderView({ projectId: 'p1' });

    await userEvent.click(await screen.findByTestId('git-row-staged-a.ts'));
    await userEvent.click(screen.getByTestId('git-row-changes-a.ts'));

    expect(onOpenDiff.mock.calls).toEqual([
      [{ projectId: 'p1', path: 'a.ts', source: { kind: 'index' } }],
      [{ projectId: 'p1', path: 'a.ts', source: { kind: 'worktree' } }],
    ]);
  });

  it('stages and unstages single files and whole groups', async () => {
    route({
      'git.status': ok(
        repo([file('a.ts', 'modified', 'unmodified'), file('b.ts', 'unmodified', 'modified')]),
      ),
    });
    renderView();

    await userEvent.click(await screen.findByTestId('git-stage-b.ts'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.stage', { paths: ['b.ts'] }));
    await userEvent.click(screen.getByTestId('git-unstage-all'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.unstage', { paths: ['a.ts'] }));
  });

  it('confirms a discard naming what is lost, and does nothing on cancel', async () => {
    route({
      'git.status': ok(
        repo([file('a.ts', 'unmodified', 'modified'), file('new.txt', 'untracked', 'untracked')]),
      ),
    });
    renderView();

    await userEvent.click(await screen.findByTestId('git-discard-all'));
    const dialog = screen.getByTestId('git-discard-confirm-dialog');
    expect(within(dialog).getByText('new.txt')).toBeInTheDocument();
    expect(within(dialog).getByText(/apagados do disco/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('git-discard-cancel-btn'));
    expect(call).not.toHaveBeenCalledWith('git.discard', expect.anything());

    await userEvent.click(screen.getByTestId('git-discard-a.ts'));
    await userEvent.click(screen.getByTestId('git-discard-confirm-btn'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('git.discard', { paths: ['a.ts'] }));
  });

  it('commits only with a message and something staged, then clears the box', async () => {
    route({
      'git.status': ok(repo([file('a.ts', 'modified', 'unmodified')])),
      'git.commit': ok({ sha: 'x' }),
    });
    renderView();

    const button = await screen.findByTestId('git-commit-btn');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByTestId('git-commit-message'), 'fix: thing');
    expect(button).toBeEnabled();
    await userEvent.click(button);

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('git.commit', { message: 'fix: thing', amend: false }),
    );
    await waitFor(() => expect(screen.getByTestId('git-commit-message')).toHaveValue(''));
  });

  it('keeps the commit disabled with nothing staged unless amending', async () => {
    route({ 'git.status': ok(repo([file('a.ts', 'unmodified', 'modified')])) });
    renderView();

    await userEvent.type(await screen.findByTestId('git-commit-message'), 'msg');
    expect(screen.getByTestId('git-commit-btn')).toBeDisabled();
    await userEvent.click(screen.getByTestId('git-commit-amend'));
    expect(screen.getByTestId('git-commit-btn')).toBeEnabled();
  });

  it('shows a failed commit with its stderr behind "Ver detalhes" and keeps the message', async () => {
    route({
      'git.status': ok(repo([file('a.ts', 'added', 'unmodified')])),
      'git.commit': {
        ok: false,
        error: { kind: 'io', message: 'hook failed', details: { stderr: 'eslint: 3 errors' } },
      },
    });
    renderView();

    await userEvent.type(await screen.findByTestId('git-commit-message'), 'msg');
    await userEvent.click(screen.getByTestId('git-commit-btn'));

    expect(await screen.findByTestId('git-error')).toHaveTextContent('hook failed');
    await userEvent.click(screen.getByTestId('git-error-details-toggle'));
    expect(screen.getByTestId('git-error-details')).toHaveTextContent('eslint: 3 errors');
    expect(screen.getByTestId('git-commit-message')).toHaveValue('msg');
  });

  it('shows a project picker only with more than one project', async () => {
    const projects: Project[] = [
      { id: 'p1', name: 'api', path: '/ws/api', createdAt: '' },
      { id: 'p2', name: 'web', path: '/ws/web', createdAt: '' },
    ];
    renderView({ projects });
    expect(await screen.findByTestId('git-project-picker')).toBeInTheDocument();
  });

  it('warns about an in-progress operation', async () => {
    route({
      'git.status': ok(repo([file('c.ts', 'modified', 'modified', true)], { state: 'merging' })),
    });
    renderView();
    expect(await screen.findByTestId('git-state-banner')).toHaveTextContent('merging');
    expect(screen.getByTestId('git-badge-changes-c.ts')).toHaveTextContent('!');
  });
});
