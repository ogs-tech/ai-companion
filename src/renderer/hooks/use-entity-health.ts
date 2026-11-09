import { useMemo } from 'react';
import { useHealthReport } from './use-health-report.js';
import { channelProblems, type ChannelProblems } from '../lib/entity-health.js';

const NONE: ChannelProblems = new Map();

/**
 * Per-item, per-channel problems for the customizations tree, from the same report Diagnósticos shows.
 * Empty while the report loads: silence is the "ok" state, so nothing flashes a warning meanwhile.
 */
export function useEntityHealth(): ChannelProblems {
  const { data } = useHealthReport('personal');
  return useMemo(() => (Array.isArray(data?.checks) ? channelProblems(data.checks) : NONE), [data]);
}
