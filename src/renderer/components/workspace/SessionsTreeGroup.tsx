import { useState } from 'react';
import { Box, Chip, List, Stack, Tooltip, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Square, SquareTerminal, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { TreeGroupRow } from './TreeGroup.js';
import { useSessions, sessionsQueryKey } from '../../hooks/use-sessions.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { SESSION_STATUS_PILL } from '../../lib/session-status-pill.js';
import { StatusPill } from '../ds/StatusPill.js';
import { parseUrn } from '../../../shared/entity.js';
import type { SessionAnchor, SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';

const ENTITY_KIND_LABEL: Record<string, string> = {
  skill: 'Skill',
  agent: 'Agent',
  instruction: 'Instruction',
};

function anchorKindLabel(anchor: SessionAnchor): string {
  if (anchor.kind === 'workspace') return 'Workspace';
  if (anchor.kind === 'project') return 'Project';
  return ENTITY_KIND_LABEL[parseUrn(anchor.urn).kind] ?? 'Entity';
}

interface SessionsTreeGroupProps {
  /** Opens/focuses this session's own Workbench tab — the same "un-minimize" gesture whether the session is running or exited. */
  onOpen: (session: SessionSnapshot) => void;
  /** Called after a session is apagada, so the caller can close its Workbench tab too, if one is open. */
  onRemoved?: (sessionId: string) => void;
}

/**
 * Consolidated, flat list of every `claude` session known in this
 * workspace's memory, running or exited — the only place a session can be
 * reached (and retomada/encerrada/apagada) once its own entity/project/
 * workspace tab has been fechada or was never open in the first place.
 * Renders bare rows (no collapsible `TreeGroup` wrapper of its own) — it's
 * meant to sit inside a parent panel that already provides the "Sessões"
 * header and collapse affordance (see WorkspaceScreen's sessions block).
 */
export function SessionsTreeGroup({ onOpen, onRemoved }: SessionsTreeGroupProps): React.ReactElement {
  const { data } = useSessions();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const visible = [...(data ?? [])].sort((a, b) => a.label.localeCompare(b.label));

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: sessionsQueryKey });

  const reportError = (err: unknown): void => {
    setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
  };

  const handleResume = async (session: SessionSnapshot): Promise<void> => {
    try {
      const resumed = await callIpc<SessionSnapshotWithOutput>('session.resume', { sessionId: session.sessionId });
      await invalidate();
      onOpen(resumed);
    } catch (err) {
      reportError(err);
    }
  };

  const handleStop = async (session: SessionSnapshot): Promise<void> => {
    try {
      await callIpc('session.kill', { sessionId: session.sessionId });
      await invalidate();
    } catch (err) {
      reportError(err);
    }
  };

  const handleRemove = async (session: SessionSnapshot): Promise<void> => {
    if (!window.confirm(`Apagar a sessão de ${session.label}? O histórico desta sessão será perdido.`)) return;
    try {
      await callIpc('session.remove', { sessionId: session.sessionId });
      await invalidate();
      onRemoved?.(session.sessionId);
    } catch (err) {
      reportError(err);
    }
  };

  if (visible.length === 0) {
    return (
      <Typography
        variant="caption"
        color="text.secondary"
        data-testid="sessions-empty"
        sx={{ display: 'block', px: 1.5, py: 1 }}
      >
        Nenhuma sessão ainda
      </Typography>
    );
  }

  return (
    <>
      <List disablePadding>
        {visible.map((session) => {
          const pill = SESSION_STATUS_PILL[session.status];
          return (
            <TreeGroupRow
              key={session.sessionId}
              testId={`tree-session-${session.sessionId}`}
              glyph={SquareTerminal}
              primary={session.label}
              onClick={() => (session.status === 'exited' ? void handleResume(session) : onOpen(session))}
              badge={
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={anchorKindLabel(session.anchor)}
                    sx={{ height: 18, fontSize: '0.6875rem' }}
                  />
                  <StatusPill variant={pill.variant} label={pill.label} testId={`session-status-${session.sessionId}`} />
                </Stack>
              }
              actions={
                <>
                  {session.status === 'running' && (
                    <Tooltip title="Encerrar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Encerrar ${session.label}`}
                        data-testid={`tree-session-stop-${session.sessionId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStop(session);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          void handleStop(session);
                        }}
                        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                      >
                        <Icon glyph={Square} size={14} />
                      </Box>
                    </Tooltip>
                  )}
                  <Tooltip title="Apagar">
                    <Box
                      component="span"
                      role="button"
                      tabIndex={0}
                      aria-label={`Apagar ${session.label}`}
                      data-testid={`tree-session-remove-${session.sessionId}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemove(session);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        if (e.key === ' ') e.preventDefault();
                        e.stopPropagation();
                        void handleRemove(session);
                      }}
                      sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                    >
                      <Icon glyph={Trash2} size={14} />
                    </Box>
                  </Tooltip>
                </>
              }
            />
          );
        })}
      </List>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
