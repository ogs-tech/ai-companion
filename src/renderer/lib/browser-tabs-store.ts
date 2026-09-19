import { callIpc } from './ipc.js';

// Module-scoped, not a React Context — same reasoning as
// `workspace-area-store.ts`: `WorkspaceScreen` owns the Workbench tab strip
// every browser tab actually opens into, but the things that ask for one
// (a `SessionPanel` toggle deep inside the Workbench; a marketplace/footer
// link, or the `TopNav` button, elsewhere entirely) have no prop path down
// into it — so they register a callback here the same way
// `registerAreaOpener` already lets `TopNav`'s sync pill focus the
// Diagnóstico tab. This store also holds the list of tabs that exist, for
// `WorkspaceScreen` to render into `OpenTab`/`WorkbenchTab` entries.

/** One embedded browser tab. `sessionId` set only for a tab opened via a `SessionPanel` toggle — the agent-drivable kind; absent for a manually opened one. */
export interface BrowserTab {
  readonly tabId: string;
  readonly sessionId?: string;
  readonly url: string;
}

export interface BrowserTabsSnapshot {
  readonly tabs: readonly BrowserTab[];
}

let tabs: BrowserTab[] = [];
let snapshot: BrowserTabsSnapshot = { tabs };
const listeners = new Set<() => void>();

/** Called by `WorkspaceScreen` while mounted; pass `null` on unmount — mirrors `registerAreaOpener`. */
let workbenchOpener: ((tabId: string) => void) | null = null;

function notify(): void {
  snapshot = { tabs };
  listeners.forEach((listener) => listener());
}

export function subscribeBrowserTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBrowserTabsSnapshot(): BrowserTabsSnapshot {
  return snapshot;
}

export function registerBrowserWorkbenchOpener(fn: ((tabId: string) => void) | null): void {
  workbenchOpener = fn;
}

function removeTab(tabId: string): void {
  if (!tabs.some((tab) => tab.tabId === tabId)) return;
  tabs = tabs.filter((tab) => tab.tabId !== tabId);
  notify();
}

/**
 * Re-establishes a session's already-existing tab without opening a
 * Workbench tab for it — used when a `SessionPanel` re-attaches to a session
 * whose browser was already enabled before this mount (its tab lives on,
 * main-process side; the renderer's own store just forgot about it).
 */
export function registerSessionTab(sessionId: string): void {
  if (tabs.some((tab) => tab.tabId === sessionId)) return;
  tabs = [...tabs, { tabId: sessionId, sessionId, url: '' }];
  notify();
}

/**
 * A fresh, user-initiated enable — call once `browser.enable` has resolved
 * (the IPC call is `SessionPanel`'s own, not repeated here). Registers the
 * tab if needed and opens/focuses its Workbench tab.
 */
export function openSessionTab(sessionId: string): void {
  registerSessionTab(sessionId);
  workbenchOpener?.(sessionId);
}

/** Call once `browser.disable` has resolved (again, `SessionPanel`'s own IPC call) — just forgets the tab here. */
export function closeSessionTab(sessionId: string): void {
  removeTab(sessionId);
}

function commitTab(tabId: string, url: string): void {
  tabs = [...tabs, { tabId, url }];
  notify();
  workbenchOpener?.(tabId);
}

/** Opens a manual tab (the "+" affordance, or a redirected external link), and opens/focuses its Workbench tab. */
export async function openManualTab(url?: string): Promise<void> {
  const { tabId } = await callIpc<{ tabId: string }>('browser.openTab', url ? { url } : {});
  commitTab(tabId, url ?? '');
}

/**
 * Registers and focuses a manual tab that was minted by a different IPC call
 * than `browser.openTab` — e.g. `openWith.openInBrowser`, which resolves a
 * file tree row to a sandboxed `file://` URL before opening the tab. Mirrors
 * the finishing half of `openManualTab`; the actual URL is picked up once
 * `BrowserPane` mounts and reads it back via `browser.status`.
 */
export function focusManualTab(tabId: string): void {
  commitTab(tabId, '');
}

/**
 * Closes a browser tab — the Workbench tab's own close button, the one place
 * a session's browser can be turned off besides `SessionPanel`'s toggle
 * (unlike a manual tab, which has no other way to close). Unlike
 * `closeSessionTab`, this makes the IPC call itself, since nothing else
 * already has by the time a tab strip's own 'x' is clicked.
 */
export async function closeBrowserTab(tabId: string): Promise<void> {
  const tab = tabs.find((t) => t.tabId === tabId);
  if (!tab) return;
  if (tab.sessionId !== undefined) {
    await callIpc('browser.disable', { sessionId: tab.sessionId });
  } else {
    await callIpc('browser.closeTab', { tabId });
  }
  removeTab(tabId);
}

/** Called by `BrowserPane` after a successful navigation, so the tab strip's label tracks what the tab is actually showing. */
export function setTabUrl(tabId: string, url: string): void {
  const idx = tabs.findIndex((tab) => tab.tabId === tabId);
  if (idx === -1) return;
  tabs = [...tabs.slice(0, idx), { ...tabs[idx]!, url }, ...tabs.slice(idx + 1)];
  notify();
}

/** Test-only: clears the whole module-scoped singleton between test files. */
export function resetBrowserTabsForTests(): void {
  tabs = [];
  snapshot = { tabs };
  listeners.clear();
  workbenchOpener = null;
}
