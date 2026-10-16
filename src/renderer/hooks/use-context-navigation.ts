import { callIpc } from '../lib/ipc.js';
import { confirmDiscardUnsavedTabs } from '../lib/workspace-tabs-guard.js';
import { focusOverview } from '../lib/workspace-shell-store.js';
import { useActiveWorkspace, useGoHome, useOpenWorkspace, useSwitchWorkspace } from './use-workspaces.js';
import type { Workspace } from '../../shared/workspace.js';

/**
 * The most recently opened workspaces, newest first — what the context
 * switcher and Início's "Recentes" card list. Never-opened ones (no
 * `lastOpenedAt`, including pre-cycle-2 data) sort last, by name.
 */
export function recentWorkspaces(workspaces: readonly Workspace[], excludeId: string | null, limit = 5): Workspace[] {
  return workspaces
    .filter((w) => w.id !== excludeId)
    .sort((a, b) => {
      if (a.lastOpenedAt && b.lastOpenedAt) return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
      if (a.lastOpenedAt) return -1;
      if (b.lastOpenedAt) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export interface ContextNavigation {
  /** `null` at Início; `undefined` while loading. */
  activeWorkspace: Workspace | null | undefined;
  goHome: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  /** Picks a folder and opens it as a workspace. Resolves `null` on cancel or a declined discard. */
  openFolder: () => Promise<Workspace | null>;
}

/**
 * Every context change reachable from the shell (TopNav switcher, ⌘K, ⌘O,
 * Início's cards and rows). Each one goes through the unsaved-tabs guard
 * first; "switching" to the context already open just focuses its Visão
 * geral tab. Errors propagate — callers own their toast.
 */
export function useContextNavigation(): ContextNavigation {
  const { data: activeWorkspace } = useActiveWorkspace();
  const goHomeMutation = useGoHome();
  const switchMutation = useSwitchWorkspace();
  const openMutation = useOpenWorkspace();

  const goHome = async (): Promise<void> => {
    if (activeWorkspace === null) {
      focusOverview();
      return;
    }
    if (!confirmDiscardUnsavedTabs()) return;
    await goHomeMutation.mutateAsync();
  };

  const switchTo = async (id: string): Promise<void> => {
    if (activeWorkspace?.id === id) {
      focusOverview();
      return;
    }
    if (!confirmDiscardUnsavedTabs()) return;
    await switchMutation.mutateAsync(id);
  };

  const openFolder = async (): Promise<Workspace | null> => {
    const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
    if (picked.canceled || !picked.path) return null;
    if (!confirmDiscardUnsavedTabs()) return null;
    return openMutation.mutateAsync(picked.path);
  };

  return { activeWorkspace, goHome, switchTo, openFolder };
}
