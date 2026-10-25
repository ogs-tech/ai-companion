import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { TerminalSnapshot } from '../../shared/terminal.js';

export const terminalsQueryKey = ['terminals'] as const;
export const workspaceFoldersQueryKey = ['workspace', 'listFolders'] as const;

/** Every terminal of the open workspace, running and exited. Pass `enabled: false` at Início, where `terminal.*` is `validation`. */
export function useTerminals(enabled = true): UseQueryResult<TerminalSnapshot[]> {
  const queryClient = useQueryClient();
  // A process exiting changes its row (dot, exit code, actions) without any call from here.
  useEffect(() => {
    if (!enabled) return;
    return window.api.terminal.onAnyExit(() => {
      void queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
    });
  }, [enabled, queryClient]);
  return useQuery<TerminalSnapshot[]>({
    queryKey: terminalsQueryKey,
    queryFn: () => callIpc<TerminalSnapshot[]>('terminal.list'),
    enabled,
  });
}

/** A new interactive shell in `relCwd` (the workspace root when omitted). */
export function useCreateTerminal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { relCwd?: string }) => callIpc<TerminalSnapshot>('terminal.create', args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: terminalsQueryKey }),
  });
}

export function useKillTerminal() {
  return useMutation({ mutationFn: (terminalId: string) => callIpc<void>('terminal.kill', { terminalId }) });
}

export function useRestartTerminal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (terminalId: string) => callIpc<TerminalSnapshot>('terminal.restart', { terminalId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: terminalsQueryKey }),
  });
}

export function useRemoveTerminal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (terminalId: string) => callIpc<void>('terminal.remove', { terminalId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: terminalsQueryKey }),
  });
}

/** Root-relative folders of the workspace, for the "Novo terminal em…" picker. */
export function useWorkspaceFolders(enabled: boolean): UseQueryResult<string[]> {
  return useQuery<string[]>({
    queryKey: workspaceFoldersQueryKey,
    queryFn: () => callIpc<string[]>('workspace.listFolders'),
    enabled,
    staleTime: 0,
  });
}
