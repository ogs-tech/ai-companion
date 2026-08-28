import { Chip, Stack } from '@mui/material';
import { SquareTerminal } from 'lucide-react';
import { StatusPill, type StatusPillVariant } from '../ds/StatusPill.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { useSessions } from '../../hooks/use-sessions.js';
import { anchorKindLabel } from '../../lib/session-anchor-label.js';
import type { SessionAnchor, SessionStatus } from '../../../shared/session.js';

const STATUS_PILL: Record<SessionStatus, { variant: StatusPillVariant; label: string }> = {
  running: { variant: 'running', label: 'Ativa' },
  exited: { variant: 'exited', label: 'Encerrada' },
};

interface SessionsTreeGroupProps {
  /** Whether exited sessions are currently visible alongside running ones. */
  showFinished: boolean;
  onOpen: (anchor: SessionAnchor, label: string) => void;
}

/** Consolidated view of every `claude` session live in this workspace's memory, running or finished. */
export function SessionsTreeGroup({ showFinished, onOpen }: SessionsTreeGroupProps): React.ReactElement {
  const { data } = useSessions();
  const items = (data ?? []).filter((session) => showFinished || session.status === 'running');
  const visible = [...items].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <TreeGroup testId="session" glyph={SquareTerminal} label="Sessões" count={visible.length}>
      {visible.map((session) => (
        <TreeGroupRow
          key={session.sessionId}
          testId={`tree-session-${session.sessionId}`}
          glyph={SquareTerminal}
          primary={session.label}
          onClick={() => onOpen(session.anchor, session.label)}
          badge={
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <Chip
                size="small"
                variant="outlined"
                label={anchorKindLabel(session.anchor)}
                sx={{ height: 18, fontSize: '0.6875rem' }}
              />
              <StatusPill
                variant={STATUS_PILL[session.status].variant}
                label={STATUS_PILL[session.status].label}
                testId={`session-status-${session.sessionId}`}
              />
            </Stack>
          }
        />
      ))}
    </TreeGroup>
  );
}
