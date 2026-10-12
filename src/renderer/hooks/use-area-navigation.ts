import { useActiveWorkspace, useGoHome } from './use-workspaces.js';
import { confirmDiscardUnsavedTabs } from '../lib/workspace-tabs-guard.js';
import { openWorkspaceArea } from '../lib/workspace-area-store.js';
import type { Area } from '../components/shell/nav.js';

/**
 * CommandPalette's "go to X" entries, and the status bar sync entry's fallback
 * when it isn't already at Início. 'workspace' is the "Início" gesture (go
 * home, guarded against unsaved Workbench tabs); the other three open/focus
 * their Workbench tab inside WorkspaceScreen — see workspace-area-store.ts.
 * Starter Pack/Marketplaces/Diagnóstico only ever show as Explorer Panel rows
 * at Início itself, so those rows call `openWorkspaceArea` directly rather
 * than this hook — they never need the 'workspace' branch.
 */
export function useAreaNavigation(): (area: Area) => void {
  const { data: activeWorkspace } = useActiveWorkspace();
  const goHome = useGoHome();

  return (area: Area): void => {
    const inWorkspace = activeWorkspace !== undefined && activeWorkspace !== null;
    if (area === 'workspace') {
      if (inWorkspace) {
        if (!confirmDiscardUnsavedTabs()) return;
        void goHome.mutateAsync();
      }
      return;
    }
    if (inWorkspace) {
      if (!confirmDiscardUnsavedTabs()) return;
      void goHome.mutateAsync().then(() => openWorkspaceArea(area));
      return;
    }
    openWorkspaceArea(area);
  };
}
