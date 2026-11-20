import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { DetectedEntity } from '../../shared/detected.js';
import type { SyncResult } from '../../shared/sync-result.js';

export interface RefreshResult {
  sync: SyncResult[];
  /** Items found in the channels' own files that can be imported, from a fresh scan. */
  importable: number;
}

/**
 * Diagnóstico's "Atualizar": sync every channel, re-probe the MCP servers' live state, scan the channels again for
 * what they hold, then refetch everything that shows it (report, tree status, detected rows, MCP, hooks). The
 * probe and the scan may fail without hiding the sync; the queries refetch even when the sync fails — the screen
 * must show reality.
 */
export function useRefreshDiagnostics(): UseMutationResult<RefreshResult, unknown, void> {
  const qc = useQueryClient();
  return useMutation<RefreshResult, unknown, void>({
    mutationFn: async () => {
      const sync = await callIpc<SyncResult[]>('adapter.syncAll', {});
      await callIpc('mcp.refreshHealth', {}).catch(() => undefined);
      const detected = await callIpc<DetectedEntity[]>('detected.list', {}).catch((): DetectedEntity[] => []);
      return { sync, importable: detected.filter((d) => d.importable).length };
    },
    onSettled: () => qc.invalidateQueries(),
  });
}
