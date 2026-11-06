import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tooltip, Typography } from '@mui/material';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { useSetExternalConsent } from '../../hooks/use-external-sessions.js';
import { compareRows, type SessionRowState } from '../../lib/session-attention.js';
import type { ExternalSession } from '../../../shared/external-session.js';
import type { SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';
import { SessionRow } from './SessionRow.js';
import { getObserveRequest, requestObserve, subscribeObserve } from '../../lib/external-observe-store.js';

export function externalStateOf(session: ExternalSession): SessionRowState {
  return session.closed ? 'exited' : (session.activity ?? 'idle');
}

/** One-time consent: exact state needs hooks in the harnesses' own config; "Só estimado" touches nothing. */
export function ExternalConsentBanner(): React.ReactElement {
  const setConsent = useSetExternalConsent();
  const [error, setError] = useState<string | null>(null);
  const choose = (mode: 'exact' | 'estimated'): void => {
    setError(null);
    setConsent(mode).catch((err: unknown) => setError(err instanceof IpcCallError ? err.message : String(err)));
  };
  return (
    <Alert
      severity="info"
      data-testid="external-consent-banner"
      sx={{ mx: 0.75, mb: 0.75, alignItems: 'flex-start' }}
      action={
        <Stack direction="row" spacing={0.5}>
          <Button size="small" color="inherit" onClick={() => choose('estimated')} data-testid="external-consent-estimated">
            Só estimado
          </Button>
          <Button size="small" variant="outlined" color="inherit" onClick={() => choose('exact')} data-testid="external-consent-exact">
            Ativar
          </Button>
        </Stack>
      }
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Ver o estado exato de sessões fora do app
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        Adiciona hooks de estado a <code>~/.claude/settings.json</code> e <code>~/.cursor/hooks.json</code> (só as entradas do app; removível em Configurações).
      </Typography>
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      )}
    </Alert>
  );
}

/** Read-only live view of an external conversation's transcript tail; refreshed whenever the external list changes. */
function ObserveDialog({ session, onClose }: { session: ExternalSession; onClose: () => void }): React.ReactElement {
  const [text, setText] = useState('');
  useEffect(() => {
    let active = true;
    const load = (): void => {
      void callIpc<string>('externalSession.tail', { id: session.id })
        .then((tail) => {
          if (active) setText(typeof tail === 'string' ? tail : '');
        })
        .catch(() => {});
    };
    load();
    const off = window.api.externalSession.onChanged(load);
    return () => {
      active = false;
      off();
    };
  }, [session.id]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" data-testid="external-observe-dialog">
      <DialogTitle>{`Observando ${session.label} (somente leitura)`}</DialogTitle>
      <DialogContent>
        <Box component="pre" sx={{ m: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} data-testid="external-observe-text">
          {text || 'Sem transcrição disponível para esta sessão.'}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

interface ExternalSessionRowsProps {
  sessions: readonly ExternalSession[];
  filter: SessionRowState | null;
  now: number;
  onAssumed: (session: SessionSnapshot) => void;
  onError: (message: string) => void;
}

/** External sessions as rows of the same list: same indicator, labelled "externa · <terminal>", dashed when only estimated. */
export function ExternalSessionRows({ sessions, filter, now, onAssumed, onError }: ExternalSessionRowsProps): React.ReactElement | null {
  const [observed, setObserved] = useState<ExternalSession | null>(null);
  const requestedId = useSyncExternalStore(subscribeObserve, getObserveRequest);
  // A clicked notification names the session; the dialog follows it live from the current list.
  const observing = observed ?? sessions.find((s) => s.id === requestedId) ?? null;
  const setObserving = (session: ExternalSession | null): void => {
    setObserved(session);
    if (session === null) requestObserve(null);
  };
  const rows = sessions
    .map((session) => ({ session, state: externalStateOf(session) }))
    .filter((row) => filter === null || row.state === filter)
    .sort((a, b) =>
      compareRows(
        { state: a.state, sortAt: a.session.lastEventAt, waitingSince: a.state === 'needs-input' ? (a.session.activitySince ?? null) : null },
        { state: b.state, sortAt: b.session.lastEventAt, waitingSince: b.state === 'needs-input' ? (b.session.activitySince ?? null) : null },
      ),
    );
  if (rows.length === 0) return null;

  const assume = async (session: ExternalSession): Promise<void> => {
    try {
      onAssumed(await callIpc<SessionSnapshotWithOutput>('externalSession.assume', { id: session.id }));
    } catch (err) {
      onError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  return (
    <>
      {rows.map(({ session, state }) => {
        const canAssume = session.cwd !== null && (session.closed || session.activity === 'idle');
        const subtitle = [
          `externa${session.terminal ? ` · ${session.terminal}` : ''}`,
          session.closed ? 'motivo desconhecido' : session.precision === 'estimated' ? 'estimado' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <SessionRow
            key={`external:${session.id}`}
            testId={`tree-external-session-${session.id}`}
            label={session.label}
            harness={session.harness}
            state={state}
            {...(session.attention ? { attention: session.attention } : {})}
            waitingSince={state === 'needs-input' ? (session.activitySince ?? null) : null}
            idleSince={state === 'idle' ? (session.activitySince ?? null) : null}
            workingSince={state === 'working' ? (session.activitySince ?? null) : null}
            activityDetail={session.activityDetail}
            subtitle={subtitle}
            estimated={session.precision === 'estimated'}
            now={now}
            history={null}
            onOpen={() => setObserving(session)}
            actions={
              <>
                <Tooltip title="Observar (somente leitura)">
                  <Button size="small" sx={{ minWidth: 0, px: 0.75, fontSize: '0.625rem' }} onClick={(e) => { e.stopPropagation(); setObserving(session); }} data-testid={`external-observe-${session.id}`}>
                    Observar
                  </Button>
                </Tooltip>
                <Tooltip title={canAssume ? 'Retomar esta conversa no app' : 'Disponível quando a sessão externa estiver ociosa ou fechada'}>
                  <span>
                    <Button size="small" disabled={!canAssume} sx={{ minWidth: 0, px: 0.75, fontSize: '0.625rem' }} onClick={(e) => { e.stopPropagation(); void assume(session); }} data-testid={`external-assume-${session.id}`}>
                      Assumir aqui
                    </Button>
                  </span>
                </Tooltip>
              </>
            }
          />
        );
      })}
      {observing && <ObserveDialog session={observing} onClose={() => setObserving(null)} />}
    </>
  );
}
