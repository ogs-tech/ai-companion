import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { ProjectLaunchConfigs } from '../../shared/launch-config.js';

export const launchConfigsQueryKey = ['launchConfigs'] as const;

/** Every registered Project's launch.json configs, across the active workspace. */
export function useLaunchConfigs(): UseQueryResult<ProjectLaunchConfigs[]> {
  return useQuery<ProjectLaunchConfigs[]>({
    queryKey: launchConfigsQueryKey,
    queryFn: async () => {
      const list = await callIpc<ProjectLaunchConfigs[]>('launchConfig.list');
      return Array.isArray(list) ? list : [];
    },
  });
}

/** One Project's own launch configs, derived from the shared list query. */
export function useProjectLaunchConfigs(projectId: string): ProjectLaunchConfigs | undefined {
  const { data } = useLaunchConfigs();
  return data?.find((entry) => entry.projectId === projectId);
}
