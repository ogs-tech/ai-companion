import type { HarnessId } from '../../../../shared/harness.js';
import { isHarnessId } from '../../../../shared/harness.js';

/** The `channel` field of a check for an adapter id, or nothing when the adapter is not a known harness. */
export function channelOf(adapterId: string): { channel?: HarnessId } {
  return isHarnessId(adapterId) ? { channel: adapterId } : {};
}
