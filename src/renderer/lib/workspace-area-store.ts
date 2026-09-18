import type { Area } from '../components/shell/nav.js';

// Module-scoped, not a React Context — same rationale as
// `workspace-tabs-guard.ts`: the TopNav sync pill sits ABOVE WorkspaceScreen
// and has no prop path down into its locally-owned Workbench tab state, so
// asking WorkspaceScreen to open its Diagnóstico tab goes through the same
// registered-callback shape WorkspaceScreen already uses for its unsaved-tabs
// guard and history applier. Starter Pack/Marketplaces/Diagnóstico's own
// entry points (the Explorer Panel's pinned rows) are already inside
// WorkspaceScreen, so they call its `openAreaTab` directly — no registry
// needed there.

export type WorkspaceAreaTab = Exclude<Area, 'workspace'>;

let opener: ((area: WorkspaceAreaTab) => void) | null = null;

/** Called by `WorkspaceScreen` while mounted; pass `null` on unmount. */
export function registerAreaOpener(next: ((area: WorkspaceAreaTab) => void) | null): void {
  opener = next;
}

/** Opens (or focuses) the given area's Workbench tab. A no-op if WorkspaceScreen isn't mounted. */
export function openWorkspaceArea(area: WorkspaceAreaTab): void {
  opener?.(area);
}
