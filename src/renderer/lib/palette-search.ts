import type { Entity } from '../../shared/entity.js';
import type { SessionSnapshot } from '../../shared/session.js';
import { compareRows, rowStateOf, type SessionRowState } from './session-attention.js';

/**
 * What the raw input is asking for. `all` is the unified search (⌘K): sessions,
 * customizations, files and actions in grouped sections. A one-character prefix
 * narrows it to a single section; `files` is also the base of ⌘P.
 */
export type SearchMode = 'all' | 'commands' | 'files' | 'sessions' | 'customizations' | 'line';

/** The prefix chips the palette shows, in display order. */
export const PREFIX_HINTS: ReadonlyArray<{ prefix: string; label: string; mode: Exclude<SearchMode, 'all'> }> = [
  { prefix: '@', label: 'arquivos', mode: 'files' },
  { prefix: '#', label: 'sessões', mode: 'sessions' },
  { prefix: '/', label: 'customizações', mode: 'customizations' },
  { prefix: '>', label: 'ações', mode: 'commands' },
];

const PREFIX_TO_MODE: Readonly<Record<string, Exclude<SearchMode, 'all'>>> = {
  '>': 'commands',
  ':': 'line',
  '@': 'files',
  '#': 'sessions',
  '/': 'customizations',
};

/** The mode a raw input is in and the text after its prefix (no prefix = the base mode). */
export function parseSearchQuery(raw: string, base: SearchMode): { mode: SearchMode; prefix: string; term: string } {
  const first = raw.charAt(0);
  const mode = PREFIX_TO_MODE[first];
  if (mode !== undefined) return { mode, prefix: first, term: raw.slice(1) };
  return { mode: base, prefix: '', term: raw };
}

export interface SessionHit {
  session: SessionSnapshot;
  state: SessionRowState;
}

/**
 * Sessions the palette offers. No term: the live ones (needing input first, then
 * working, then idle), capped at `limit`. With a term: any session — live or
 * exited — whose label contains it, in the same order.
 */
export function searchSessions(sessions: readonly SessionSnapshot[], term: string, limit = 6): SessionHit[] {
  const needle = term.trim().toLowerCase();
  return sessions
    .map((session) => ({ session, state: rowStateOf(session) }))
    .filter((hit) => (needle === '' ? hit.state !== 'exited' : hit.session.label.toLowerCase().includes(needle)))
    .sort((a, b) =>
      compareRows(
        { state: a.state, sortAt: a.session.activitySince ?? 0, waitingSince: a.session.activitySince ?? null },
        { state: b.state, sortAt: b.session.activitySince ?? 0, waitingSince: b.session.activitySince ?? null },
      ),
    )
    .slice(0, limit);
}

/** Skills and agents whose name or description contains the term. An empty term matches nothing — the list is never dumped unasked. */
export function searchCustomizations<T extends Entity>(entities: readonly T[], term: string, limit = 6): T[] {
  const needle = term.trim().toLowerCase();
  if (needle === '') return [];
  return entities
    .filter((e) => e.name.toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.name.toLowerCase().includes(needle)) - Number(a.name.toLowerCase().includes(needle)))
    .slice(0, limit);
}
