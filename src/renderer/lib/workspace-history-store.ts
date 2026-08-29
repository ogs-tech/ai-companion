// Module-scoped, not a React Context — same rationale as
// `workspace-tabs-guard.ts`: `TopNav` (inside `AppShell`) sits ABOVE
// `WorkspaceScreen` and has no prop path down into its locally-owned
// scope/tab state, so `WorkspaceScreen` registers an applier here the same
// way it registers its unsaved-tabs guard. The one addition this store needs
// over that plain registry is reactivity — the back/forward buttons' enabled
// state must re-render `TopNav` on every push/navigate — so it also exposes
// a `useSyncExternalStore`-compatible subscribe/snapshot pair.

/** A single Workbench "location": which workspace/project scope was active, and which tab (if any) was focused within it. */
export interface WorkspaceHistoryEntry {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly activeTabId: string | null;
}

export type WorkspaceHistoryDirection = 'back' | 'forward';

/**
 * Outcome of trying to apply one history entry:
 * - 'applied' — the entry's location is now current; stop walking.
 * - 'stale' — the entry's tab has since been closed; prune it and keep
 *   walking further in the same direction (VS Code's "Go Back" behavior).
 * - 'declined' — applying would discard unsaved Workbench tabs and the user
 *   declined; stop walking in place, without touching the entry or cursor.
 */
export type ApplyWorkspaceHistoryResult = 'applied' | 'stale' | 'declined';
export type ApplyWorkspaceHistoryEntry = (entry: WorkspaceHistoryEntry) => Promise<ApplyWorkspaceHistoryResult>;

export interface WorkspaceHistorySnapshot {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** Session-lifetime cap, not persisted — same spirit as a browser tab's own history stack. */
const MAX_ENTRIES = 50;

let entries: WorkspaceHistoryEntry[] = [];
let cursor = -1;
let applier: ApplyWorkspaceHistoryEntry | null = null;
/** True only while `applier` is registered — gates reachability so back/forward read as disabled the moment `WorkspaceScreen` unmounts (i.e. outside the Workspace area), without discarding the stack itself. */
let hasApplier = false;
/** True for the whole `navigate()` call, including the awaited applier — suppresses `pushWorkspaceHistoryEntry` so the state changes navigate() itself causes don't get re-recorded as a new forward step. */
let navigating = false;

let snapshot: WorkspaceHistorySnapshot = { canGoBack: false, canGoForward: false };
const listeners = new Set<() => void>();

function sameEntry(a: WorkspaceHistoryEntry, b: WorkspaceHistoryEntry): boolean {
  return a.workspaceId === b.workspaceId && a.projectId === b.projectId && a.activeTabId === b.activeTabId;
}

function notify(): void {
  const next: WorkspaceHistorySnapshot = {
    canGoBack: hasApplier && cursor > 0,
    canGoForward: hasApplier && cursor >= 0 && cursor < entries.length - 1,
  };
  if (next.canGoBack === snapshot.canGoBack && next.canGoForward === snapshot.canGoForward) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeWorkspaceHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkspaceHistorySnapshot(): WorkspaceHistorySnapshot {
  return snapshot;
}

/** Called by `WorkspaceScreen` while mounted; pass `null` on unmount. */
export function registerWorkspaceHistoryApplier(fn: ApplyWorkspaceHistoryEntry | null): void {
  applier = fn;
  hasApplier = fn !== null;
  notify();
}

/**
 * Records the current location as a new history step. A no-op while
 * `navigate()` is applying an entry (that's a replay, not a new visit), and
 * deduped against the current entry (e.g. a location effect re-running
 * without an actual change).
 */
export function pushWorkspaceHistoryEntry(entry: WorkspaceHistoryEntry): void {
  if (navigating) return;
  const current = cursor >= 0 ? entries[cursor] : undefined;
  if (current && sameEntry(current, entry)) return;
  entries = [...entries.slice(0, cursor + 1), entry];
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  cursor = entries.length - 1;
  notify();
}

/**
 * Walks one step `direction` from the cursor, pruning any stale (closed-tab)
 * entries it passes over along the way. See index-shift note inline below —
 * this is the one part of the store worth reading carefully before editing.
 */
export async function navigateWorkspaceHistory(direction: WorkspaceHistoryDirection): Promise<void> {
  if (!applier) return;
  navigating = true;
  try {
    let i = direction === 'back' ? cursor - 1 : cursor + 1;
    while (i >= 0 && i < entries.length) {
      const entry = entries[i];
      if (!entry) break;
      // Sequential by design: each candidate is only tried once the previous one is known to be stale.
      const result = await applier(entry);
      if (result === 'applied') {
        cursor = i;
        return;
      }
      if (result === 'declined') return;
      // 'stale': splice(i, 1) shifts every later index down by one. Going
      // back, the cursor sits AFTER i, so it shifts too, and the next
      // (earlier) candidate is now at i - 1. Going forward, the cursor sits
      // BEFORE i (untouched by the shift), and the next candidate slides
      // into i itself, so i is left unchanged.
      entries.splice(i, 1);
      if (direction === 'back') {
        cursor -= 1;
        i -= 1;
      }
    }
  } finally {
    navigating = false;
    notify();
  }
}

/** Test-only: clears the whole module-scoped singleton between test files. */
export function resetWorkspaceHistoryForTests(): void {
  entries = [];
  cursor = -1;
  applier = null;
  hasApplier = false;
  navigating = false;
  snapshot = { canGoBack: false, canGoForward: false };
  listeners.clear();
}
