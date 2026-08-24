import { useMutation, useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { queryClient } from '../lib/query-client.js';
import type { Project } from '../../shared/project.js';

const listKey = ['project', 'list'] as const;

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: listKey,
    queryFn: () => callIpc<Project[]>('project.list', {}),
  });
}

export function useFindOrCreateProjectByPath() {
  return useMutation({
    mutationFn: (path: string) => callIpc<Project>('project.findOrCreateByPath', { path }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useDeleteProject() {
  return useMutation({
    mutationFn: (id: string) => callIpc<void>('project.delete', { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
