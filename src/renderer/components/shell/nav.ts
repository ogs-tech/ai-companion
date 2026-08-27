import {
  House, Rocket, LayoutDashboard, Puzzle, Activity, Sparkles, Bot,
  Webhook, Store, Plug, type LucideIcon,
} from 'lucide-react';

export type Area = 'workspace' | 'starter-pack' | 'plugins' | 'diagnostico';
export type WorkspaceSub = 'visao-geral' | 'skills' | 'agents' | 'hooks' | 'mcps';
export type PluginsSub = 'plugins' | 'marketplaces';

export type Nav =
  | { area: 'workspace'; sub: WorkspaceSub }
  | { area: 'starter-pack' }
  | { area: 'plugins'; sub: PluginsSub }
  | { area: 'diagnostico' };

export interface AreaDef { area: Area; label: string; glyph: LucideIcon; }
export interface SubDef<S> { sub: S; label: string; glyph: LucideIcon; }

// The 'workspace' area leads and is labeled "Início" — it's the landing area
// (see `defaultNav` below) — with Starter Pack demoted to an ordinary page
// reached from the tab bar instead of doubling as home. The area key stays
// `workspace` (routing, SubRail's "Workspace" section, etc. are unaffected);
// only this tab's display label/icon read as "home".
export const NAV_AREAS: ReadonlyArray<AreaDef> = [
  { area: 'workspace', label: 'Início', glyph: House },
  { area: 'starter-pack', label: 'Starter Pack', glyph: Rocket },
  { area: 'plugins', label: 'Plugins', glyph: Puzzle },
  { area: 'diagnostico', label: 'Diagnóstico', glyph: Activity },
];

// Skills/Agents/Hooks/MCP live under the active workspace — its data (which
// entities exist) already changes per workspace on the backend, this just
// makes that ownership legible in the nav. Instructions is managed inline on
// Visão geral instead of as its own sub — see WorkspaceScreen.
export const WORKSPACE_SUBS: ReadonlyArray<SubDef<WorkspaceSub>> = [
  { sub: 'visao-geral', label: 'Visão geral', glyph: LayoutDashboard },
  { sub: 'skills', label: 'Skills', glyph: Sparkles },
  { sub: 'agents', label: 'Agents', glyph: Bot },
  { sub: 'hooks', label: 'Hooks', glyph: Webhook },
  { sub: 'mcps', label: 'MCP', glyph: Plug },
];

export const PLUGINS_SUBS: ReadonlyArray<SubDef<PluginsSub>> = [
  { sub: 'plugins', label: 'Plugins', glyph: Puzzle },
  { sub: 'marketplaces', label: 'Marketplaces', glyph: Store },
];

/**
 * Areas whose `Nav` variant carries a `sub` field, keyed to the sub list that
 * backs it. Any `Area` not present here has no `sub` on its `Nav` variant.
 * Single source of truth for "does this area have subs" — derive from this
 * (or from `'sub' in nav` when a `Nav` value, not just an `Area`, is in hand)
 * instead of re-hardcoding the sub-less area list.
 */
const AREA_SUBS: Partial<Record<Area, ReadonlyArray<SubDef<string>>>> = {
  workspace: WORKSPACE_SUBS,
  plugins: PLUGINS_SUBS,
};

/** True when `area`'s `Nav` variant carries a `sub` field. */
export function areaHasSub(area: Area): boolean {
  return area in AREA_SUBS;
}

export const defaultNav: Nav = { area: 'workspace', sub: 'visao-geral' };

/** Stable `nav-<id>` testid: the sub id when present, else the area id. */
export function navTestId(nav: Nav): string {
  return 'sub' in nav ? `nav-${nav.sub}` : `nav-${nav.area}`;
}

/** Default sub when an area with subs is first entered. */
export function defaultSubFor(area: Area): Nav {
  if (area === 'workspace') return { area, sub: 'visao-geral' };
  if (area === 'plugins') return { area, sub: 'plugins' };
  return { area } as Nav;
}
