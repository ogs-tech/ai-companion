import { useMemo } from 'react';
import { useCustomizationList } from './use-customization-list.js';
import { useDetected } from './use-detected.js';
import { useCustomizationStatus } from './use-customization-status.js';
import { useFolderRouting } from './use-folder-routing.js';
import { useHooks } from './use-hooks.js';
import { useInstructionsList, usePersonalInstruction } from './use-instructions.js';
import { useMcpList } from './use-mcp-list.js';
import { usePluginList } from './use-plugins.js';
import { buildCustomizationTree, type CustomizationTree, type TreeFilter } from '../lib/customization-tree.js';
import type { ChannelId } from '../../shared/channel.js';
import type { Agent, Skill } from '../../shared/entity.js';

const DETECTED_KINDS = ['skill', 'agent', 'instruction'] as const;
const EMPTY: readonly never[] = [];

/** `own` plus the plugin-provided entries of the `project` listing it lacks (by urn). */
function withProjectPlugins<T extends Skill | Agent>(own: readonly T[] | undefined, project: readonly T[] | undefined): readonly T[] | undefined {
  if (project === undefined) return own;
  const urns = new Set((own ?? []).map((e) => e.urn));
  return [...(own ?? []), ...project.filter((e) => e.source.kind === 'plugin' && !urns.has(e.urn))];
}

export interface UseCustomizationTreeOptions {
  isHome: boolean;
  localScope?: { scope: 'workspace'; scopeId: string };
  mcpMatchPath?: string;
  query: string;
  filter: TreeFilter;
  channel?: ChannelId;
}

/** The Customizações tree for the current scope: every list read once, built by one pure function. */
export function useCustomizationTree({ isHome, localScope, mcpMatchPath, query, filter, channel }: UseCustomizationTreeOptions): CustomizationTree {
  const ownSkills = useCustomizationList('skill', 'skill.list').data as Skill[] | undefined;
  const ownAgents = useCustomizationList('agent', 'agent.list').data as Agent[] | undefined;
  // A workspace's own plugins ship skills/agents only the `project` listing returns; they join their kind groups.
  const projectSkills = useCustomizationList('skill', 'skill.list', 'project', !isHome).data as Skill[] | undefined;
  const projectAgents = useCustomizationList('agent', 'agent.list', 'project', !isHome).data as Agent[] | undefined;
  const skills = useMemo(() => withProjectPlugins(ownSkills, isHome ? undefined : projectSkills), [ownSkills, projectSkills, isHome]);
  const agents = useMemo(() => withProjectPlugins(ownAgents, isHome ? undefined : projectAgents), [ownAgents, projectAgents, isHome]);
  const instructions = useInstructionsList().data;
  const personalInstruction = usePersonalInstruction().data;
  const mcps = useMcpList().data;
  const hooks = useHooks().data;
  const personalPlugins = usePluginList('personal').data;
  const projectPlugins = usePluginList('project', !isHome).data;
  const detected = useDetected(DETECTED_KINDS).data;
  const status = useCustomizationStatus();
  const routing = useFolderRouting();
  // `useFolderRouting` builds fresh objects every render; key them by the folders so the build memoizes.
  const foldersKey = routing.folders.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `routing` changes identity every render; its folders decide its content.
  const stableRouting = useMemo(() => routing, [foldersKey]);
  const scopeId = localScope?.scopeId;

  return useMemo(() => {
    return buildCustomizationTree(
      {
        skills: skills ?? EMPTY,
        agents: agents ?? EMPTY,
        instructions: instructions ?? EMPTY,
        personalInstruction,
        mcps: mcps ?? EMPTY,
        hooks: hooks ?? EMPTY,
        plugins: [...(personalPlugins ?? []), ...(isHome ? [] : (projectPlugins ?? []))],
        detected: detected ?? EMPTY,
        status,
      },
      {
        isHome,
        ...(scopeId !== undefined ? { localScope: { scope: 'workspace', scopeId } } : {}),
        ...(mcpMatchPath !== undefined ? { mcpMatchPath } : {}),
        aliases: stableRouting.aliases,
        folders: stableRouting.folders,
        multi: stableRouting.multi,
        query,
        filter,
        ...(channel !== undefined ? { channel } : {}),
      },
    );
  }, [skills, agents, instructions, personalInstruction, mcps, hooks, personalPlugins, projectPlugins, detected, status, stableRouting, isHome, scopeId, mcpMatchPath, query, filter, channel]);
}
