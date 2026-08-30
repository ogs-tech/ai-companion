import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { entityQueryKey } from './use-customization-list.js';
import { INSTRUCTIONS_QUERY_KEY, PERSONAL_INSTRUCTION_QUERY_KEY } from './use-instructions.js';
import type { EntityChangedEvent } from '../../shared/entity.js';

/**
 * Subscribes once to `entity:changed` — fired when the main process's file
 * watcher re-syncs a Skill/Agent/Instruction edited outside the app's own
 * save() flow (e.g. a `claude` session opened via "New Action" writing to the
 * entity's canonical source directly) — and invalidates that kind's list
 * query, so a tree row picks up the change without the user refreshing.
 */
export function useEntityChangeInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.entity.onChanged((event: EntityChangedEvent) => {
      if (event.kind === 'skill' || event.kind === 'agent') {
        void queryClient.invalidateQueries({ queryKey: entityQueryKey(event.kind) });
      } else if (event.kind === 'instruction') {
        void queryClient.invalidateQueries({ queryKey: INSTRUCTIONS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: PERSONAL_INSTRUCTION_QUERY_KEY });
      }
    });
  }, [queryClient]);
}
