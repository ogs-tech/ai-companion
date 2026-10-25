import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { terminalsQueryKey } from './use-terminals.js';
import type { WorkspaceLaunchConfigs } from '../../shared/launch-config.js';
import type { TerminalSnapshot } from '../../shared/terminal.js';

export const launchConfigsQueryKey = ['launchConfigs'] as const;

/** The open workspace's own launch.json configs — `null` at Início. */
export function useLaunchConfigs(enabled = true): UseQueryResult<WorkspaceLaunchConfigs | null> {
  return useQuery<WorkspaceLaunchConfigs | null>({
    queryKey: launchConfigsQueryKey,
    queryFn: async () => (await callIpc<WorkspaceLaunchConfigs | null>('launchConfig.list')) ?? null,
    enabled,
  });
}

/** Runs a configuration as a new terminal (two runs are two terminals) and resolves with its snapshot. */
export function useRunLaunchConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { configName: string }) => callIpc<TerminalSnapshot>('launchConfig.run', args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: terminalsQueryKey }),
  });
}
