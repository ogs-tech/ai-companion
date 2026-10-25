import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { Entity, EntityKind } from '../../shared/entity.js';
import type { PluginScope } from './use-plugins.js';

/**
 * `scope` here is the plugin-provenance scope `*.list` merges plugin entities
 * from (Claude Code's `personal`/`project` plugin tiers) — not an entity scope.
 */
type Scope = PluginScope;

export function entityQueryKey(kind: EntityKind, scope: Scope = 'personal'): readonly unknown[] {
  return ['entity', kind, scope] as const;
}

export function useCustomizationList(kind: EntityKind, listMethod: string, scope: Scope = 'personal') {
  return useQuery<Entity[]>({
    queryKey: entityQueryKey(kind, scope),
    queryFn: async () => {
      const list = await callIpc<Entity[]>(listMethod, { scope });
      return Array.isArray(list) ? list : [];
    },
  });
}

export function useInvalidateCustomization() {
  const qc = useQueryClient();
  return (kind: EntityKind, scope: Scope = 'personal'): Promise<void> =>
    qc.invalidateQueries({ queryKey: entityQueryKey(kind, scope) });
}
