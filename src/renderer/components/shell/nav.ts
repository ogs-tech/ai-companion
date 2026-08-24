import {
  House, SlidersHorizontal, Puzzle, Activity, Sparkles, Bot,
  Webhook, NotebookPen, Store, Plug, FolderTree as FolderTreeIcon, type LucideIcon,
} from 'lucide-react';

export type Area = 'inicio' | 'workspace' | 'biblioteca' | 'plugins' | 'diagnostico';
export type LibrarySub = 'skills' | 'agents' | 'hooks' | 'instructions' | 'mcps';
export type PluginsSub = 'plugins' | 'marketplaces';

export type Nav =
  | { area: 'inicio' }
  | { area: 'workspace' }
  | { area: 'biblioteca'; sub: LibrarySub }
  | { area: 'plugins'; sub: PluginsSub }
  | { area: 'diagnostico' };

export interface AreaDef { area: Area; label: string; glyph: LucideIcon; }
export interface SubDef<S> { sub: S; label: string; glyph: LucideIcon; }

export const NAV_AREAS: ReadonlyArray<AreaDef> = [
  { area: 'inicio', label: 'Início', glyph: House },
  { area: 'workspace', label: 'Workspace', glyph: FolderTreeIcon },
  { area: 'biblioteca', label: 'Biblioteca', glyph: SlidersHorizontal },
  { area: 'plugins', label: 'Plugins', glyph: Puzzle },
  { area: 'diagnostico', label: 'Diagnóstico', glyph: Activity },
];

export const LIBRARY_SUBS: ReadonlyArray<SubDef<LibrarySub>> = [
  { sub: 'skills', label: 'Skills', glyph: Sparkles },
  { sub: 'agents', label: 'Agents', glyph: Bot },
  { sub: 'hooks', label: 'Hooks', glyph: Webhook },
  { sub: 'instructions', label: 'Instructions', glyph: NotebookPen },
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
  biblioteca: LIBRARY_SUBS,
  plugins: PLUGINS_SUBS,
};

/** True when `area`'s `Nav` variant carries a `sub` field. */
export function areaHasSub(area: Area): boolean {
  return area in AREA_SUBS;
}

export const defaultNav: Nav = { area: 'inicio' };

/** Stable `nav-<id>` testid: the sub id when present, else the area id. */
export function navTestId(nav: Nav): string {
  return 'sub' in nav ? `nav-${nav.sub}` : `nav-${nav.area}`;
}

/** Default sub when an area with subs is first entered. */
export function defaultSubFor(area: Area): Nav {
  if (area === 'biblioteca') return { area, sub: 'skills' };
  if (area === 'plugins') return { area, sub: 'plugins' };
  return { area } as Nav;
}
