import { useActiveWorkspace, useSwitchWorkspace } from './use-workspaces.js';
import { confirmDiscardUnsavedTabs } from '../lib/workspace-tabs-guard.js';
import { openWorkspaceArea } from '../lib/workspace-area-store.js';
import type { Area } from '../components/shell/nav.js';

/**
 * CommandPalette's "go to X" entries, and the TopNav sync pill's fallback
 * when it isn't already on the Default workspace. 'workspace' is the old
 * "Início" gesture (jump back to Default, guarded against unsaved Workbench
 * tabs); the other three open/focus their Workbench tab inside
 * WorkspaceScreen — see workspace-area-store.ts. Starter Pack/Marketplaces/
 * Diagnóstico only ever show as Explorer Panel rows on the Default workspace
 * itself, so those rows call `openWorkspaceArea` directly rather than this
 * hook — they never need the 'workspace' branch.
 */
export function useAreaNavigation(): (area: Area) => void {
  const { data: activeWorkspace } = useActiveWorkspace();
  const switchWorkspace = useSwitchWorkspace();

  return (area: Area): void => {
    if (area === 'workspace') {
      if (activeWorkspace && !activeWorkspace.isDefault) {
        if (!confirmDiscardUnsavedTabs()) return;
        void switchWorkspace.mutateAsync('default');
      }
      return;
    }
    if (activeWorkspace && !activeWorkspace.isDefault) {
      if (!confirmDiscardUnsavedTabs()) return;
      void switchWorkspace.mutateAsync('default').then(() => openWorkspaceArea(area));
      return;
    }
    openWorkspaceArea(area);
  };
}
