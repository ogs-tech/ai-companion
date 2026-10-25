// Module-scoped, same shape as `workspace-area-store.ts`: the TopNav (context
// switcher, panel toggles) and the command palette sit ABOVE WorkspaceScreen
// and have no prop path into its locally-owned tab and panel state. The
// screen registers the commands while mounted and publishes the panels'
// collapse state, which the TopNav toggles read through `useSyncExternalStore`.

export type WorkspacePanelSide = 'explorer' | 'control';

export interface WorkspaceShellCommands {
  /** Focuses the pinned "Visão geral" tab. */
  focusOverview: () => void;
  togglePanel: (side: WorkspacePanelSide) => void;
}

export interface WorkspacePanelsSnapshot {
  explorerCollapsed: boolean;
  controlCollapsed: boolean;
}

let commands: WorkspaceShellCommands | null = null;
let panels: WorkspacePanelsSnapshot = { explorerCollapsed: false, controlCollapsed: false };
const listeners = new Set<() => void>();

/** Called by `WorkspaceScreen` while mounted; pass `null` on unmount. */
export function registerWorkspaceShellCommands(next: WorkspaceShellCommands | null): void {
  commands = next;
}

/** A no-op if WorkspaceScreen isn't mounted. */
export function focusOverview(): void {
  commands?.focusOverview();
}

/** A no-op if WorkspaceScreen isn't mounted. */
export function toggleWorkspacePanel(side: WorkspacePanelSide): void {
  commands?.togglePanel(side);
}

/** Called by `WorkspaceScreen` whenever either panel collapses or expands. */
export function publishWorkspacePanels(next: WorkspacePanelsSnapshot): void {
  if (next.explorerCollapsed === panels.explorerCollapsed && next.controlCollapsed === panels.controlCollapsed) return;
  panels = next;
  for (const listener of listeners) listener();
}

export function subscribeWorkspacePanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkspacePanelsSnapshot(): WorkspacePanelsSnapshot {
  return panels;
}
