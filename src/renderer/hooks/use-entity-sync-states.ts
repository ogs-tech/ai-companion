import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { EntitySyncState } from '../../shared/sync-result.js';

export const ENTITY_SYNC_STATES_KEY = ['adapter', 'entitySyncStates'] as const;

/**
 * Per-entity sync state (urn → state), read from disk by main. Entities with nothing to
 * materialize are absent. Refetches when any entity changes and when the window regains focus,
 * so a file edited outside the app flips its dot.
 */
export function useEntitySyncStates(): Record<string, EntitySyncState> {
  const qc = useQueryClient();
  const { data } = useQuery<Record<string, EntitySyncState>>({
    queryKey: ENTITY_SYNC_STATES_KEY,
    queryFn: () => callIpc<Record<string, EntitySyncState>>('adapter.entitySyncStates', {}),
    refetchOnWindowFocus: true,
  });
  useEffect(
    () => window.api.entity.onChanged(() => void qc.invalidateQueries({ queryKey: ENTITY_SYNC_STATES_KEY })),
    [qc],
  );
  return data ?? {};
}
