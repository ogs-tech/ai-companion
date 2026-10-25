import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { GitCommitResult, GitDiffSource, GitFileDiff, GitGenerateCommitMessageResult, GitStatus, GitSyncResult } from '../../shared/git.js';

/** How often status refetches while the Git view is on screen. */
export const GIT_STATUS_POLL_MS = 5_000;

/**
 * Every `git.*` call targets the open workspace's root, so every query shares
 * the `['git']` prefix and a mutation invalidates status and open diffs
 * together. A workspace switch invalidates everything anyway.
 */
export const GIT_QUERY_KEY = ['git'] as const;

// Agent sessions rewrite the worktree at any moment: never trust a cached read.
const LIVE_QUERY_OPTIONS = { staleTime: 0, refetchOnWindowFocus: true } as const;

export function useGitStatus(options: { visible: boolean }) {
  return useQuery<GitStatus>({
    queryKey: [...GIT_QUERY_KEY, 'status'],
    queryFn: () => callIpc<GitStatus>('git.status', {}),
    refetchInterval: options.visible ? GIT_STATUS_POLL_MS : false,
    ...LIVE_QUERY_OPTIONS,
  });
}

export function useGitDiff(path: string, source: GitDiffSource) {
  return useQuery<GitFileDiff>({
    queryKey: [...GIT_QUERY_KEY, 'diff', path, source],
    queryFn: () => callIpc<GitFileDiff>('git.diff', { path, source }),
    ...LIVE_QUERY_OPTIONS,
  });
}

function useGitMutation<TArgs, TResult = void>(method: string) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TArgs>({
    mutationFn: (args) => callIpc<TResult>(method, args),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: GIT_QUERY_KEY }),
  });
}

export const useGitStage = () => useGitMutation<{ paths: string[] }>('git.stage');

export const useGitUnstage = () => useGitMutation<{ paths: string[] }>('git.unstage');

export const useGitDiscard = () => useGitMutation<{ paths: string[] }>('git.discard');

export const useGitCommit = () => useGitMutation<{ message: string; amend?: boolean }, GitCommitResult>('git.commit');

export const useGitInit = () => useGitMutation<Record<string, never>>('git.init');

export const useGitPush = () => useGitMutation<Record<string, never>>('git.push');

export const useGitPull = () => useGitMutation<Record<string, never>>('git.pull');

export const useGitFetch = () => useGitMutation<Record<string, never>>('git.fetch');

export const useGitSync = () => useGitMutation<Record<string, never>, GitSyncResult>('git.sync');

/** Reads the staged diff only — never changes the repo, so no invalidation. */
export const useGitGenerateCommitMessage = () =>
  useMutation<GitGenerateCommitMessageResult, Error, void>({
    mutationFn: () => callIpc<GitGenerateCommitMessageResult>('git.generateCommitMessage', {}),
  });
