import type { SessionStatus } from '../../shared/session.js';
import type { StatusPillVariant } from '../components/ds/StatusPill.js';

/** Shared with SessionPanel's own header pill so a row badge and the panel it points at never drift into different wording for the same status. */
export const SESSION_STATUS_PILL: Record<SessionStatus, { variant: StatusPillVariant; label: string }> = {
  running: { variant: 'running', label: 'Ativa' },
  exited: { variant: 'exited', label: 'Encerrada' },
};
