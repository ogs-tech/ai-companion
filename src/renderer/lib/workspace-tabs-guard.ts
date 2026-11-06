// A tiny module-scoped registry, not a React Context — `AppShell` (the
// top-nav "Início" button) sits ABOVE `WorkspaceScreen` in the tree and has
// no prop path down to its locally-owned dirty-tab state, so it can't be
// threaded like `HomeNavList`'s `beforeSwitch` prop is. Only one
// screen in the app ever has unsaved Workbench tabs, so a single registered
// guard (rather than a full Context provider wrapping the whole shell) is
// proportionate.
//
// The guard is async: it may ask the user (Salvar / Não salvar / Cancelar) and
// save before resolving, so every caller awaits it.
let guard: (() => Promise<boolean>) | null = null;
let quitGuard: (() => Promise<boolean>) | null = null;

/** Called by `WorkspaceScreen` while mounted; pass `null` on unmount. */
export function registerUnsavedTabsGuard(next: (() => Promise<boolean>) | null): void {
  guard = next;
}

/** Called by `WorkspaceScreen` while mounted: resolves whether the window may close (nothing dirty, or the user chose Salvar / Não salvar). Never ends terminals. */
export function registerQuitGuard(next: (() => Promise<boolean>) | null): void {
  quitGuard = next;
}

/** Resolves true if it's safe to navigate away — no unsaved tabs, or the registered guard saved/discarded them (and cleared them). */
export function confirmDiscardUnsavedTabs(): Promise<boolean> {
  return guard ? guard() : Promise.resolve(true);
}

/** Resolves true if the window may close — see `registerQuitGuard`. */
export function confirmQuit(): Promise<boolean> {
  return quitGuard ? quitGuard() : Promise.resolve(true);
}
