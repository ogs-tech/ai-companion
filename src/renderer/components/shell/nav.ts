import {
  House, Rocket, Store, Activity, Sparkles, Bot,
  Webhook, Plug, type LucideIcon,
} from 'lucide-react';

export type Area = 'workspace' | 'starter-pack' | 'marketplaces' | 'diagnostico';

// No area carries a `sub` anymore — Skills/Agents/Hooks/MCP/Plugins all moved
// from standalone sub-screens into tree nodes inside the one Workspace screen
// (see WorkspaceScreen + EntityTreeGroup/HooksTreeGroup/McpTreeGroup/PluginsTreeGroup).
export interface Nav { area: Area; }

export interface AreaDef { area: Area; label: string; glyph: LucideIcon; }

// The 'workspace' area leads and is labeled "Início" — it's the landing area
// (see `defaultNav` below) — with Starter Pack demoted to an ordinary page
// reached from the tab bar instead of doubling as home. The area key stays
// `workspace`; only this tab's display label/icon read as "home".
export const NAV_AREAS: ReadonlyArray<AreaDef> = [
  { area: 'workspace', label: 'Início', glyph: House },
  { area: 'starter-pack', label: 'Starter Pack', glyph: Rocket },
  { area: 'marketplaces', label: 'Marketplaces', glyph: Store },
  { area: 'diagnostico', label: 'Diagnóstico', glyph: Activity },
];

/** Icon lookup for the entity-kind tree groups rendered inside WorkspaceScreen. */
export const ENTITY_GROUP_ICONS = {
  skill: Sparkles,
  agent: Bot,
  hook: Webhook,
  mcp: Plug,
} as const satisfies Record<string, LucideIcon>;

export const defaultNav: Nav = { area: 'workspace' };
