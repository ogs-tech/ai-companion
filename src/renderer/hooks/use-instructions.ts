import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import type { Instruction } from '../../shared/entity.js';
import { isProjectInstruction, isWorkspaceInstruction } from '../../shared/entity.js';

export const INSTRUCTIONS_QUERY_KEY = ['entity', 'instruction', 'personal'] as const;
export const PERSONAL_INSTRUCTION_QUERY_KEY = ['entity', 'instruction', 'default'] as const;

/**
 * Loads every instruction — personal singleton (if configured) plus every
 * project instruction the user has created — in a single call.
 */
export function useInstructionsList() {
  return useQuery<Instruction[]>({
    queryKey: INSTRUCTIONS_QUERY_KEY,
    queryFn: async () => {
      const list = await callIpc<Instruction[]>('instruction.list', {});
      return Array.isArray(list) ? list : [];
    },
    refetchOnMount: 'always',
  });
}

/**
 * Loads the personal ("default") instruction only. Kept as a dedicated hook so
 * screens that only need the singleton don't force the list roundtrip.
 * Returns `null` when the singleton doesn't exist yet.
 */
export function usePersonalInstruction() {
  return useQuery<Instruction | null>({
    queryKey: PERSONAL_INSTRUCTION_QUERY_KEY,
    queryFn: async () => {
      try {
        return await callIpc<Instruction>('instruction.get', { id: 'default' });
      } catch (err) {
        if (err instanceof IpcCallError && err.kind === 'not_found') return null;
        throw err;
      }
    },
    refetchOnMount: 'always',
  });
}

/**
 * Shared by `useWorkspaceInstruction`/`useProjectInstruction` — both narrow the
 * same `useInstructionsList` cache (same queryKey/queryFn, so react-query
 * dedupes the fetch) down to the one entity matching `predicate`.
 */
function useScopedInstruction(scopeId: string, predicate: (i: Instruction) => boolean) {
  return useQuery<Instruction[], Error, Instruction | null>({
    queryKey: INSTRUCTIONS_QUERY_KEY,
    queryFn: async () => {
      const list = await callIpc<Instruction[]>('instruction.list', {});
      return Array.isArray(list) ? list : [];
    },
    refetchOnMount: 'always',
    select: (list) => list.find((i) => predicate(i) && i.scopeId === scopeId) ?? null,
  });
}

/**
 * The instruction scoped to a given workspace (`scopes: ['workspace']`,
 * `scopeId === workspaceId`), or `null` when that workspace has none yet.
 */
export function useWorkspaceInstruction(workspaceId: string) {
  return useScopedInstruction(workspaceId, isWorkspaceInstruction);
}

/**
 * The instruction scoped to a given project (`scopes: ['project']`,
 * `scopeId === projectId`), or `null` when that project has none yet.
 */
export function useProjectInstruction(projectId: string) {
  return useScopedInstruction(projectId, isProjectInstruction);
}

/**
 * Invalidator used after save/delete. Invalidates both the instruction queries
 * AND the starter-pack query so downstream screens that summarize instructions
 * (like the home StarterPackScreen) refresh in the same tick — closing the
 * silent staleness gap the old global-instruction screen had.
 */
export function useInvalidateInstructions() {
  const qc = useQueryClient();
  return async (): Promise<void> => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: INSTRUCTIONS_QUERY_KEY }),
      qc.invalidateQueries({ queryKey: PERSONAL_INSTRUCTION_QUERY_KEY }),
      qc.invalidateQueries({ queryKey: ['starter-pack'] }),
    ]);
  };
}
