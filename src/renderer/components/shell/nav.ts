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

/**
 * The role color each entity kind already reads as elsewhere in the app
 * (info=azul, success=verde, warning=ambar) — shared by the Workbench tab's
 * top-border spine (WorkspaceScreen) and the tree row's left-edge spine
 * (TreeGroupRow's `accentColor`) so an open tab visually traces back to its
 * row in the rail, and vice versa.
 */
export const ENTITY_ACCENT_COLOR = {
  skill: 'info.main',
  agent: 'success.main',
  instruction: 'warning.main',
} as const satisfies Record<'skill' | 'agent' | 'instruction', string>;

export const defaultNav: Nav = { area: 'workspace' };
