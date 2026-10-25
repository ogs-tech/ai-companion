import {
  House, FolderOpen, Rocket, Store, Activity, Sparkles, Bot,
  Webhook, Plug, type LucideIcon,
} from 'lucide-react';

export type Area = 'workspace' | 'workspaces' | 'starter-pack' | 'marketplaces' | 'diagnostico';

// No area carries a `sub` anymore — Skills/Agents/Hooks/MCP/Plugins all moved
// from standalone sub-screens into tree nodes inside the one Workspace screen
// (see WorkspaceScreen + EntityTreeGroup/HooksTreeGroup/McpTreeGroup/PluginsTreeGroup).
// Workspaces/Starter Pack/Marketplaces/Diagnóstico followed the same trend: they're
// Workbench tabs now (see workspace-area-store.ts), opened from the Explorer
// Panel's own pinned rows on the Default/Global workspace (WorkspaceScreen's
// `appAreaRows`) rather than a TopNav tab. 'workspace' itself needs no tab —
// it's what's already showing underneath — and stays "Início"'s "go home"
// gesture (see useAreaNavigation), still used by CommandPalette and the
// TopNav sync pill.
export interface AreaDef { area: Area; label: string; glyph: LucideIcon; }

export const NAV_AREAS: ReadonlyArray<AreaDef> = [
  { area: 'workspace', label: 'Início', glyph: House },
  { area: 'workspaces', label: 'Workspaces', glyph: FolderOpen },
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
  // Integrações share one color (ink), matching the "Integrações" chip and bar segment.
  hook: 'primary.main',
  mcp: 'primary.main',
  plugin: 'primary.main',
} as const satisfies Record<'skill' | 'agent' | 'instruction' | 'hook' | 'mcp' | 'plugin', string>;
