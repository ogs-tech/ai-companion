import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { Entity, EntityKind } from '../../shared/entity.js';
import type { PluginScope } from './use-plugins.js';
import { healthQueryKey } from './use-health-report.js';

/**
 * `scope` here is the plugin-provenance scope `*.list` merges plugin entities
 * from (Claude Code's `personal`/`project` plugin tiers) — not an entity scope.
 */
type Scope = PluginScope;

export function entityQueryKey(kind: EntityKind, scope: Scope = 'personal'): readonly unknown[] {
  return ['entity', kind, scope] as const;
}

export function useCustomizationList(kind: EntityKind, listMethod: string, scope: Scope = 'personal', enabled = true) {
  return useQuery<Entity[]>({
    enabled,
    queryKey: entityQueryKey(kind, scope),
    queryFn: async () => {
      const list = await callIpc<Entity[]>(listMethod, { scope });
      return Array.isArray(list) ? list : [];
    },
  });
}

export function useInvalidateCustomization() {
  const qc = useQueryClient();
  // A save or delete re-syncs the item to the channels, so the ⚠ next to it must be re-read now, not at the next poll.
  return async (kind: EntityKind, scope: Scope = 'personal'): Promise<void> => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: entityQueryKey(kind, scope) }),
      qc.invalidateQueries({ queryKey: healthQueryKey('personal') }),
    ]);
  };
}
