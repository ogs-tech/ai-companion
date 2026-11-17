import { useMemo } from 'react';
import { useCustomizationList } from './use-customization-list.js';
import { useDetected } from './use-detected.js';
import { useEntityHealth } from './use-entity-health.js';
import { useFolderRouting } from './use-folder-routing.js';
import { useHooks } from './use-hooks.js';
import { useInstructionsList, usePersonalInstruction } from './use-instructions.js';
import { useMcpList } from './use-mcp-list.js';
import { usePluginList } from './use-plugins.js';
import { buildCustomizationTree, type CustomizationTree, type TreeFilter } from '../lib/customization-tree.js';
import type { Agent, Skill } from '../../shared/entity.js';
import type { DetectedEntity } from '../../shared/detected.js';

const DETECTED_KINDS = ['skill', 'agent'] as const;
const DETECTED_INSTRUCTION = ['instruction'] as const;
const EMPTY: readonly never[] = [];

export interface UseCustomizationTreeOptions {
  isHome: boolean;
  localScope?: { scope: 'workspace'; scopeId: string };
  mcpMatchPath?: string;
  query: string;
  filter: TreeFilter;
}

/** The Customizações tree for the current scope: every list read once, built by one pure function. */
export function useCustomizationTree({ isHome, localScope, mcpMatchPath, query, filter }: UseCustomizationTreeOptions): CustomizationTree {
  const skills = useCustomizationList('skill', 'skill.list').data as Skill[] | undefined;
  const agents = useCustomizationList('agent', 'agent.list').data as Agent[] | undefined;
  const instructions = useInstructionsList().data;
  const personalInstruction = usePersonalInstruction().data;
  const mcps = useMcpList().data;
  const hooks = useHooks().data;
  const personalPlugins = usePluginList('personal').data;
  const projectPlugins = usePluginList('project', !isHome).data;
  const detectedEntities = useDetected(DETECTED_KINDS).data;
  const detectedInstructions = useDetected(DETECTED_INSTRUCTION).data;
  const problems = useEntityHealth();
  const routing = useFolderRouting();
  // `useFolderRouting` builds fresh objects every render; key them by the folders so the build memoizes.
  const foldersKey = routing.folders.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `routing` changes identity every render; its folders decide its content.
  const stableRouting = useMemo(() => routing, [foldersKey]);
  const scopeId = localScope?.scopeId;

  return useMemo(() => {
    // Two queries over the same detection: an item must not be listed twice if both return it.
    const byId = new Map<string, DetectedEntity>();
    for (const d of [...(detectedEntities ?? []), ...(detectedInstructions ?? [])]) byId.set(d.id, d);
    const detected = [...byId.values()];
    return buildCustomizationTree(
      {
        skills: skills ?? EMPTY,
        agents: agents ?? EMPTY,
        instructions: instructions ?? EMPTY,
        personalInstruction,
        mcps: mcps ?? EMPTY,
        hooks: hooks ?? EMPTY,
        plugins: [...(personalPlugins ?? []), ...(isHome ? [] : (projectPlugins ?? []))],
        detected,
        problems,
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
      },
    );
  }, [skills, agents, instructions, personalInstruction, mcps, hooks, personalPlugins, projectPlugins, detectedEntities, detectedInstructions, problems, stableRouting, isHome, scopeId, mcpMatchPath, query, filter]);
}
