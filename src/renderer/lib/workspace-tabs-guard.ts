// A tiny module-scoped registry, not a React Context — `AppShell` (the
// top-nav "Início" button) sits ABOVE `WorkspaceScreen` in the tree and has
// no prop path down to its locally-owned dirty-tab state, so it can't be
// threaded like `WorkspaceManagementList`'s `beforeSwitch` prop is. Only one
// screen in the app ever has unsaved Workbench tabs, so a single registered
// guard (rather than a full Context provider wrapping the whole shell) is
// proportionate.
let guard: (() => boolean) | null = null;

/** Called by `WorkspaceScreen` while mounted; pass `null` on unmount. */
export function registerUnsavedTabsGuard(next: (() => boolean) | null): void {
  guard = next;
}

/** Returns true if it's safe to navigate away — no unsaved tabs, or the registered guard confirmed discarding them (and cleared them). */
export function confirmDiscardUnsavedTabs(): boolean {
  return guard ? guard() : true;
}
