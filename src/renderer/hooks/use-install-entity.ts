import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { ChannelId } from '../../shared/channel.js';

/**
 * Installs one customization into the given channels over the files the app doesn't own there (moved to
 * `_backups/`). Resolves with the undo tokens — each one puts its channel's backups back.
 */
export function useInstallEntity(): UseMutationResult<string[], Error, { urn: string; channels: ChannelId[] }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ urn, channels }) => {
      const tokens: string[] = [];
      for (const adapterId of channels) {
        const { undoToken } = await callIpc<{ undoToken?: string }>('adapter.install', { urn, adapterId });
        if (undoToken !== undefined) tokens.push(undoToken);
      }
      return tokens;
    },
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useUndoInstall(): UseMutationResult<void, Error, string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tokens) => {
      for (const undoToken of tokens) await callIpc('adapter.undoInstall', { undoToken });
    },
    onSettled: () => qc.invalidateQueries(),
  });
}
