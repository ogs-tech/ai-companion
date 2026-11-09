// Module-scoped, same shape as `workspace-shell-store.ts`: the status bar and
// the window title sit ABOVE WorkspaceScreen and have no prop path into its
// locally-owned tab state. The screen publishes what is in front of the user
// (active tab, cursor); the CodeMirror surface publishes the cursor.

export interface ActiveTabStatus {
  /** What the title bar shows for this tab, without the unsaved dot: file name, entity name, session title, "path (diff)". */
  title: string;
  /** Only tabs that hold an editable draft can be dirty. */
  dirty: boolean;
  /** Whether the tab has a draft to save at all (file / entity). Session, terminal and diff tabs don't. */
  editable: boolean;
  /** `Date.now()` of the last save seen this run, or null. */
  savedAt: number | null;
}

export interface ShellStatus {
  /** The open workspace's name, or null at Início. */
  workspaceName: string | null;
  /** null when the "Visão geral" tab (or nothing) is in front. */
  tab: ActiveTabStatus | null;
  cursor: { line: number; column: number } | null;
}

const EMPTY: ShellStatus = { workspaceName: null, tab: null, cursor: null };

let snapshot: ShellStatus = EMPTY;
const listeners = new Set<() => void>();

export function getShellStatus(): ShellStatus {
  return snapshot;
}

export function subscribeShellStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Merges `patch` into the snapshot; a no-op (same reference) when nothing changed, so subscribers don't re-render. */
export function publishShellStatus(patch: Partial<ShellStatus>): void {
  const next = { ...snapshot, ...patch };
  const unchanged = (Object.keys(next) as Array<keyof ShellStatus>).every((key) => shallowSame(snapshot[key], next[key]));
  if (unchanged) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function shallowSame(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((k) => left[k] === right[k]);
}

/** Test seam. */
export function resetShellStatus(): void {
  snapshot = EMPTY;
  for (const listener of listeners) listener();
}
