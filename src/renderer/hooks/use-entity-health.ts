import { useMemo } from 'react';
import { useHealthReport } from './use-health-report.js';
import { entityUrn } from '../../shared/entity.js';
import { channelProblems, rollUpToPlugins, type ChannelProblems, type PluginChild } from '../lib/entity-health.js';
import { useHooks } from './use-hooks.js';
import { useMcpList } from './use-mcp-list.js';

const NONE: ChannelProblems = new Map();

/**
 * Per-item, per-channel problems for the customizations tree, from the same report Diagnósticos shows.
 * Empty while the report loads: silence is the "ok" state, so nothing flashes a warning meanwhile.
 */
export function useEntityHealth(): ChannelProblems {
  const { data } = useHealthReport('personal');
  const hooks = useHooks().data;
  const mcps = useMcpList().data;
  return useMemo(() => {
    if (!Array.isArray(data?.checks)) return NONE;
    const children: PluginChild[] = [];
    for (const h of hooks ?? []) if (h.source.kind === 'plugin') children.push({ urn: entityUrn('hook', h.id), pluginId: h.source.pluginId });
    for (const m of mcps ?? []) if (m.source.kind === 'plugin') children.push({ urn: entityUrn('mcp', m.name), pluginId: m.source.pluginId });
    return rollUpToPlugins(channelProblems(data.checks), children);
  }, [data, hooks, mcps]);
}
