import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { ExternalConsent, ExternalSession, ExternalSessionsState } from '../../shared/external-session.js';

export const externalSessionsQueryKey = ['external-sessions'] as const;

const EMPTY: ExternalSessionsState = {
  consent: 'unset',
  hooksInstalled: { claude: false, cursor: false },
  sessions: [],
};

/** Consent + sessions running outside the app; main pushes a change event (batched), this refetches. No polling. */
export function useExternalSessions(): UseQueryResult<ExternalSessionsState> {
  const queryClient = useQueryClient();
  useEffect(
    () => window.api.externalSession.onChanged(() => void queryClient.invalidateQueries({ queryKey: externalSessionsQueryKey })),
    [queryClient],
  );
  return useQuery<ExternalSessionsState>({
    queryKey: externalSessionsQueryKey,
    queryFn: async () => {
      const state = await callIpc<ExternalSessionsState>('externalSession.state');
      return state && Array.isArray(state.sessions) ? state : EMPTY;
    },
  });
}

export function useSetExternalConsent(): (mode: Exclude<ExternalConsent, 'unset'> | 'revoke') => Promise<void> {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (mode: Exclude<ExternalConsent, 'unset'> | 'revoke') =>
      mode === 'revoke' ? callIpc<ExternalSessionsState>('externalSession.revokeConsent') : callIpc<ExternalSessionsState>('externalSession.setConsent', { mode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: externalSessionsQueryKey }),
  });
  return async (mode) => {
    await mutation.mutateAsync(mode);
  };
}

export type { ExternalSession };
