import { useState } from 'react';
import { IpcCallError } from '../../../lib/ipc.js';
import {
  useGitCommit,
  useGitDiscard,
  useGitFetch,
  useGitGenerateCommitMessage,
  useGitInit,
  useGitPull,
  useGitPush,
  useGitStage,
  useGitSync,
  useGitUnstage,
} from '../../../hooks/use-git.js';
import type { GitFileChange } from '../../../../shared/git.js';

export interface ErrorReport {
  message: string;
  stderr?: string;
  files?: string[];
  /** The remote has newer commits: the alert offers pull-and-retry. */
  pushRejected?: boolean;
}

export function toReport(err: unknown): ErrorReport {
  if (!(err instanceof IpcCallError)) return { message: err instanceof Error ? err.message : String(err) };
  const stderr = err.details?.['stderr'];
  const files = err.details?.['files'];
  return {
    ...(err.details?.['reason'] === 'push_rejected' ? { pushRejected: true } : {}),
    message: err.message,
    ...(typeof stderr === 'string' && stderr.length > 0 ? { stderr } : {}),
    ...(Array.isArray(files) ? { files: files.filter((f): f is string => typeof f === 'string') } : {}),
  };
}

/**
 * The Explorer's git mutations plus the shared error/discard-confirmation
 * state, so the toolbar, the tree's context menu and the error alert all
 * report through one place.
 */
export function useGitActions() {
  const stage = useGitStage();
  const unstage = useGitUnstage();
  const discard = useGitDiscard();
  const commit = useGitCommit();
  const init = useGitInit();
  const generate = useGitGenerateCommitMessage();
  const push = useGitPush();
  const pull = useGitPull();
  const fetch = useGitFetch();
  const sync = useGitSync();
  const [error, setError] = useState<ErrorReport | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<GitFileChange[] | null>(null);

  const busy = stage.isPending || unstage.isPending || discard.isPending || commit.isPending || init.isPending || push.isPending || pull.isPending || fetch.isPending || sync.isPending;
  /** The remote operation in flight, for the sync button's progress label. */
  const syncing: 'sync' | 'push' | 'pull' | 'fetch' | null = sync.isPending ? 'sync' : push.isPending ? 'push' : pull.isPending ? 'pull' : fetch.isPending ? 'fetch' : null;

  const run = <T,>(promise: Promise<T>): Promise<T> => {
    setError(null);
    return promise.catch((err: unknown) => {
      setError(toReport(err));
      throw err;
    });
  };
  const fireAndReport = (promise: Promise<unknown>): void => void run(promise).catch(() => undefined);

  return {
    busy,
    syncing,
    error,
    clearError: () => setError(null),
    pendingDiscard,
    requestDiscard: setPendingDiscard,
    cancelDiscard: () => setPendingDiscard(null),
    confirmDiscard: () => {
      const files = pendingDiscard ?? [];
      setPendingDiscard(null);
      fireAndReport(discard.mutateAsync({ paths: files.map((f) => f.path) }));
    },
    stage: (paths: string[]) => fireAndReport(stage.mutateAsync({ paths })),
    unstage: (paths: string[]) => fireAndReport(unstage.mutateAsync({ paths })),
    sync: () => fireAndReport(sync.mutateAsync({})),
    push: () => fireAndReport(push.mutateAsync({})),
    pull: () => fireAndReport(pull.mutateAsync({})),
    fetch: () => fireAndReport(fetch.mutateAsync({})),
    init: () => fireAndReport(init.mutateAsync({})),
    /** Errors are not routed to the shared alert: the commit box shows them next to the field. */
    generateCommitMessage: () => generate.mutateAsync().then((r) => r.message),
    commit: (message: string, amend: boolean) => run(commit.mutateAsync({ message, amend })).then(() => undefined),
  };
}

export type GitActions = ReturnType<typeof useGitActions>;
