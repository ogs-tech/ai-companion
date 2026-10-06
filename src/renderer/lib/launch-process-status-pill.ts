import type { LaunchProcessStatus } from '../../shared/launch-config.js';
import type { StatusPillVariant } from '../components/ds/StatusPill.js';

/** Mirrors SESSION_STATUS_PILL — launch processes share sessions' running/exited shape but are never Sessions themselves. */
export const LAUNCH_PROCESS_STATUS_PILL: Record<LaunchProcessStatus, { variant: StatusPillVariant; label: string }> = {
  running: { variant: 'running', label: 'Rodando' },
  exited: { variant: 'exited', label: 'Encerrado' },
};
