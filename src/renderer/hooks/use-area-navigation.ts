import { useActiveWorkspace, useGoHome } from './use-workspaces.js';
import { confirmDiscardUnsavedTabs } from '../lib/workspace-tabs-guard.js';
import { openWorkspaceArea } from '../lib/workspace-area-store.js';
import type { Area } from '../components/shell/nav.js';

/**
 * CommandPalette's "go to X" entries and the status bar's health entry.
 * 'workspace' is the "Início" gesture (go home, guarded against unsaved
 * Workbench tabs). Starter Pack/Marketplaces/Diagnóstico are app-level tabs:
 * they open in whichever context is current — see workspace-area-store.ts.
 */
export function useAreaNavigation(): (area: Area) => void {
  const { data: activeWorkspace } = useActiveWorkspace();
  const goHome = useGoHome();

  return (area: Area): void => {
    if (area !== 'workspace') {
      openWorkspaceArea(area);
      return;
    }
    const inWorkspace = activeWorkspace !== undefined && activeWorkspace !== null;
    if (!inWorkspace) return;
    if (!confirmDiscardUnsavedTabs()) return;
    void goHome.mutateAsync();
  };
}
