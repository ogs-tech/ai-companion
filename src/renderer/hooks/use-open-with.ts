import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { OpenWithKind, OpenWithSuggestions } from '../../shared/open-with.js';

/**
 * A row in the file tree, in exactly the terms the tree already has: a path
 * relative to its scope's root, never an absolute one. The main process
 * resolves it through the same sandbox the rest of the file browser uses.
 */
export interface OpenWithTarget {
  relPath: string;
  kind: OpenWithKind;
  projectId?: string;
}

const scopeParams = (target: OpenWithTarget): { path: string; projectId?: string } => ({
  path: target.relPath,
  ...(target.projectId ? { projectId: target.projectId } : {}),
});

/**
 * Suggestions are fetched only once the submenu actually opens — querying
 * Launch Services for every row the user right-clicks would spawn an
 * `osascript` per row for a menu they may never open.
 */
export function useOpenWithSuggestions(
  target: OpenWithTarget | null,
  enabled: boolean,
): UseQueryResult<OpenWithSuggestions> {
  return useQuery<OpenWithSuggestions>({
    queryKey: ['openWith', 'suggest', target?.projectId ?? null, target?.relPath ?? null],
    queryFn: () => {
      if (target === null) throw new Error('No target to suggest applications for');
      return callIpc<OpenWithSuggestions>('openWith.suggest', {
        ...scopeParams(target),
        kind: target.kind,
      });
    },
    enabled: enabled && target !== null,
    // The set of installed applications can change while the app is open, and
    // a listing costs one local process — never worth serving stale.
    staleTime: 0,
    gcTime: 0,
  });
}

export function useOpenWith() {
  return useMutation({
    mutationFn: (args: { target: OpenWithTarget; app: { id: string; path: string } }) =>
      callIpc<void>('openWith.open', {
        ...scopeParams(args.target),
        kind: args.target.kind,
        appId: args.app.id,
        appPath: args.app.path,
      }),
  });
}

export function useOpenWithDefault() {
  return useMutation({
    mutationFn: (target: OpenWithTarget) =>
      callIpc<void>('openWith.openDefault', scopeParams(target)),
  });
}

export function useChooseApplication() {
  return useMutation({
    mutationFn: (target: OpenWithTarget) =>
      callIpc<{ canceled: boolean }>('openWith.chooseApp', {
        ...scopeParams(target),
        kind: target.kind,
      }),
  });
}

export function useRevealPath() {
  return useMutation({
    mutationFn: (target: OpenWithTarget) => callIpc<void>('openWith.reveal', scopeParams(target)),
  });
}

/** Opens the row as a `file://` URL in a fresh manual tab of the app's embedded browser. */
export function useOpenInBrowser() {
  return useMutation({
    mutationFn: (target: OpenWithTarget) =>
      callIpc<{ tabId: string }>('openWith.openInBrowser', scopeParams(target)),
  });
}
