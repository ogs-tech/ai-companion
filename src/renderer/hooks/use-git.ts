import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { useFolderRouting } from './use-folder-routing.js';
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

/** `folder` selects one repository of a multi-folder workspace; omitted = the primary folder. */
export const gitStatusOptions = (folder: string | undefined, visible: boolean) => ({
  queryKey: [...GIT_QUERY_KEY, 'status', folder ?? null] as const,
  queryFn: () => callIpc<GitStatus>('git.status', folder === undefined ? {} : { folder }),
  refetchInterval: visible ? GIT_STATUS_POLL_MS : (false as const),
  ...LIVE_QUERY_OPTIONS,
});

export function useGitStatus(options: { visible: boolean; folder?: string }) {
  return useQuery<GitStatus>(gitStatusOptions(options.folder, options.visible));
}

/** `path` is workspace-relative (starting with the folder alias in a multi-folder workspace). */
export function useGitDiff(path: string, source: GitDiffSource) {
  const { split } = useFolderRouting();
  const { folder, rel } = split(path);
  return useQuery<GitFileDiff>({
    queryKey: [...GIT_QUERY_KEY, 'diff', path, source],
    queryFn: () => callIpc<GitFileDiff>('git.diff', { path: rel, source, ...(folder !== undefined ? { folder } : {}) }),
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

export const useGitStage = () => useGitMutation<{ paths: string[]; folder?: string }>('git.stage');

export const useGitUnstage = () => useGitMutation<{ paths: string[]; folder?: string }>('git.unstage');

export const useGitDiscard = () => useGitMutation<{ paths: string[]; folder?: string }>('git.discard');

export const useGitCommit = () => useGitMutation<{ message: string; amend?: boolean; folder?: string }, GitCommitResult>('git.commit');

export const useGitInit = () => useGitMutation<{ folder?: string }>('git.init');

export const useGitPush = () => useGitMutation<{ folder?: string }>('git.push');

export const useGitPull = () => useGitMutation<{ folder?: string }>('git.pull');

export const useGitFetch = () => useGitMutation<{ folder?: string }>('git.fetch');

export const useGitSync = () => useGitMutation<{ folder?: string }, GitSyncResult>('git.sync');

/** Reads the staged diff only — never changes the repo, so no invalidation. */
export const useGitGenerateCommitMessage = () =>
  useMutation<GitGenerateCommitMessageResult, Error, { folder?: string } | void>({
    mutationFn: (args) => callIpc<GitGenerateCommitMessageResult>('git.generateCommitMessage', args ?? {}),
  });
