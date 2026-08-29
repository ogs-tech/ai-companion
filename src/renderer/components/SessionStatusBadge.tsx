import { useSessionStatus } from '../hooks/use-sessions.js';
import { sessionAnchorKey, type SessionAnchor } from '../../shared/session.js';
import { SESSION_STATUS_PILL } from '../lib/session-status-pill.js';
import { StatusPill } from './ds/StatusPill.js';

interface SessionStatusBadgeProps {
  anchor: SessionAnchor;
}

/** A running/exited pill for whichever row (Skill/Agent/Instruction/Project/Workspace) owns this anchor's session — renders nothing when the anchor has never had one. */
export function SessionStatusBadge({ anchor }: SessionStatusBadgeProps): React.ReactElement | null {
  const status = useSessionStatus(anchor);
  if (!status) return null;
  const pill = SESSION_STATUS_PILL[status];
  return <StatusPill variant={pill.variant} label={pill.label} testId={`session-status-${sessionAnchorKey(anchor)}`} />;
}
