import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { DetectedEntity, DetectedKind } from '../../shared/detected.js';

export const detectedQueryKey = (kinds: readonly DetectedKind[]): readonly unknown[] => ['detected', ...kinds];

/** Customizations found in Claude's / Cursor's own files that are not yet canonical. */
export function useDetected(kinds: readonly DetectedKind[]): UseQueryResult<DetectedEntity[]> {
  return useQuery<DetectedEntity[]>({
    queryKey: detectedQueryKey(kinds),
    queryFn: () => callIpc<DetectedEntity[]>('detected.list', { kinds: [...kinds] }),
  });
}

/**
 * Imports a detected item as a canonical entity. Every list that can show it
 * (skills, agents, MCP, hooks, and the detected rows themselves) changes, so
 * the whole cache is invalidated rather than guessing keys.
 */
export function useImportDetected(): UseMutationResult<unknown, Error, { id: string; kind?: DetectedKind }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => callIpc('detected.import', { id }),
    onSuccess: (_result, { kind }) => {
      void qc.invalidateQueries();
      // An imported MCP server is now written to Claude's config under its own name: re-probe so a sign-in it
      // needs shows up (Conectar) without waiting for a session. A failed probe leaves the last health in place.
      if (kind === 'mcp') {
        void callIpc('mcp.refreshHealth', {})
          .then(() => qc.invalidateQueries())
          .catch(() => undefined);
      }
    },
  });
}
