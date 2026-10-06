import { LAUNCH_PROCESS_STATUS_PILL } from '../lib/launch-process-status-pill.js';
import { StatusPill } from './ds/StatusPill.js';
import type { LaunchProcessStatus } from '../../shared/launch-config.js';

interface LaunchProcessStatusBadgeProps {
  status: LaunchProcessStatus | undefined;
  testId: string;
}

/** A running/exited pill for one launch config's row — renders nothing until it has been run at least once. */
export function LaunchProcessStatusBadge({ status, testId }: LaunchProcessStatusBadgeProps): React.ReactElement | null {
  if (!status) return null;
  const pill = LAUNCH_PROCESS_STATUS_PILL[status];
  return <StatusPill variant={pill.variant} label={pill.label} testId={testId} />;
}
