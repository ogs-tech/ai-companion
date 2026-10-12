import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { WorkspaceLaunchConfigs } from '../../shared/launch-config.js';

export const launchConfigsQueryKey = ['launchConfigs'] as const;

/** The open workspace's own launch.json configs — `null` at Início. */
export function useLaunchConfigs(): UseQueryResult<WorkspaceLaunchConfigs | null> {
  return useQuery<WorkspaceLaunchConfigs | null>({
    queryKey: launchConfigsQueryKey,
    queryFn: async () => (await callIpc<WorkspaceLaunchConfigs | null>('launchConfig.list')) ?? null,
  });
}
