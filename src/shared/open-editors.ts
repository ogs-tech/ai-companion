import type { GitDiffSource } from './git.js';
import type { SessionAnchor } from './session.js';

/**
 * The serializable reference a Workbench tab is rebuilt from after a reload.
 * Never the content: files and entities are re-read from disk on restore, so
 * a restored tab is always current. Tabs that can't be rebuilt from a
 * reference (unsaved "new" entities, entity-body previews) aren't persisted,
 * and browser tabs already recover from their own main-process store.
 */
export type PersistedTab =
  | { id: string; kind: 'file'; relPath: string }
  | { id: string; kind: 'file-preview'; relPath: string }
  | { id: string; kind: 'entity'; entityKind: 'skill' | 'agent' | 'instruction'; urn: string; inherited: boolean }
  | { id: string; kind: 'session'; anchor: SessionAnchor; sessionId: string; label: string }
  | { id: string; kind: 'terminal'; terminalId: string }
  | { id: string; kind: 'git-diff'; path: string; source: GitDiffSource }
  | { id: string; kind: 'history' }
  | { id: string; kind: 'area'; area: 'workspaces' | 'starter-pack' | 'marketplaces' | 'diagnostico' };

export interface OpenEditorsState {
  tabs: PersistedTab[];
  /** The focused tab's id; `null` (or an id that didn't survive restore) focuses "Visão geral". */
  activeTabId: string | null;
}

export const EMPTY_OPEN_EDITORS: OpenEditorsState = { tabs: [], activeTabId: null };
