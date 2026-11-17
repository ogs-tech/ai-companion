import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';

/**
 * Every list a customization can show up in, plus `['health']` — the root of every health report and of the
 * customization status (`CUSTOMIZATION_STATUS_KEY`), which both change when an item is turned on or off.
 */
const INVALIDATED_ROOTS: ReadonlyArray<readonly unknown[]> = [['entity'], ['mcp'], ['hooks'], ['health']];

/** Turns one customization on or off in every channel (`entity.setEnabled`), by urn. */
export function useSetEntityEnabled(): UseMutationResult<{ ok: true }, Error, { urn: string; enabled: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => callIpc<{ ok: true }>('entity.setEnabled', vars),
    onSuccess: () => Promise.all(INVALIDATED_ROOTS.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}
