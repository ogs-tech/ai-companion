import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { GitCommitResult, GitDiffSource, GitFileDiff, GitStatus } from '../../shared/git.js';

/** How often status refetches while the Git view is on screen. */
export const GIT_STATUS_POLL_MS = 5_000;

/**
 * The renderer never knows a repo's absolute root, so queries are keyed by the
 * target as the IPC addresses it: a Project id, or the workspace root. Every
 * `git.*` query for one target shares the `['git', scope]` prefix, so a
 * mutation invalidates status and open diffs together.
 */
export function gitScopeKey(projectId: string | undefined): readonly ['git', string] {
  return ['git', projectId ?? 'workspace'];
}

/** `{ projectId }` only when set — `exactOptionalPropertyTypes` rejects an explicit `undefined`. */
function target(projectId: string | undefined): { projectId?: string } {
  return projectId !== undefined ? { projectId } : {};
}

// Agent sessions rewrite the worktree at any moment: never trust a cached read.
const LIVE_QUERY_OPTIONS = { staleTime: 0, refetchOnWindowFocus: true } as const;

export function useGitStatus(projectId: string | undefined, options: { visible: boolean }) {
  return useQuery<GitStatus>({
    queryKey: [...gitScopeKey(projectId), 'status'],
    queryFn: () => callIpc<GitStatus>('git.status', target(projectId)),
    refetchInterval: options.visible ? GIT_STATUS_POLL_MS : false,
    ...LIVE_QUERY_OPTIONS,
  });
}

export function useGitDiff(projectId: string | undefined, path: string, source: GitDiffSource) {
  return useQuery<GitFileDiff>({
    queryKey: [...gitScopeKey(projectId), 'diff', path, source],
    queryFn: () => callIpc<GitFileDiff>('git.diff', { ...target(projectId), path, source }),
    ...LIVE_QUERY_OPTIONS,
  });
}

function useGitMutation<TArgs, TResult = void>(projectId: string | undefined, method: string) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TArgs>({
    mutationFn: (args) => callIpc<TResult>(method, { ...target(projectId), ...args }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: gitScopeKey(projectId) }),
  });
}

export const useGitStage = (projectId: string | undefined) =>
  useGitMutation<{ paths: string[] }>(projectId, 'git.stage');

export const useGitUnstage = (projectId: string | undefined) =>
  useGitMutation<{ paths: string[] }>(projectId, 'git.unstage');

export const useGitDiscard = (projectId: string | undefined) =>
  useGitMutation<{ paths: string[] }>(projectId, 'git.discard');

export const useGitCommit = (projectId: string | undefined) =>
  useGitMutation<{ message: string; amend?: boolean }, GitCommitResult>(projectId, 'git.commit');

export const useGitInit = (projectId: string | undefined) =>
  useGitMutation<Record<string, never>>(projectId, 'git.init');
