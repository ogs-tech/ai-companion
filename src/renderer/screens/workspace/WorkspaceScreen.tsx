import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import {
  Eye,
  Folder,
  GitCompare,
  Globe,
  House,
  NotebookPen,
  History,
  RefreshCw,
  EyeOff,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { ResizeHandle } from '../../components/ds/ResizeHandle.js';
import { panelCardSx, SidePanel } from '../../components/ds/SidePanel.js';
import { BrowserSection } from '../../components/workspace/BrowserSection.js';
import { ExplorerPanelContent } from '../../components/workspace/ExplorerPanelContent.js';
import type { RailItem } from '../../components/workspace/ExplorerRail.js';
import type { ExplorerView } from '../../components/workspace/ExplorerRail.js';
import { HomeOverview } from '../../components/workspace/overview/HomeOverview.js';
import { WorkspaceOverview } from '../../components/workspace/overview/WorkspaceOverview.js';
import { DiffView } from '../../components/workspace/git/DiffView.js';
import type { GitDiffSource } from '../../../shared/git.js';
import { ControlPanelContent } from '../../components/workspace/ControlPanelContent.js';
import { SessionHistoryTab } from '../history/SessionHistoryTab.js';
import type { HistoryScope } from '../../../shared/session-history.js';
import { WorkbenchCanvas, type WorkbenchTab } from '../../components/workspace/WorkbenchCanvas.js';
import { EditorPanel, type EditorHiddenField } from '../../components/workspace/EditorPanel.js';
import { SessionPanel } from '../../components/SessionPanel.js';
import { TerminalsSection } from '../../components/workspace/TerminalsSection.js';
import { TerminalPanel } from '../../components/workspace/TerminalPanel.js';
import { BrowserPane } from '../../components/BrowserPane.js';
import { ENTITY_GROUP_ICONS, ENTITY_ACCENT_COLOR, NAV_AREAS, type AreaDef } from '../../components/shell/nav.js';
import { WorkspacesScreen } from '../workspaces/WorkspacesScreen.js';
import { StarterPackScreen } from '../starter-pack/StarterPackScreen.js';
import { MarketplaceList } from '../marketplaces/MarketplaceList.js';
import { HealthScreen } from '../health/HealthScreen.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { useMenuCommand } from '../../lib/menu-commands.js';
import { openEditorFind } from '../../lib/editor-find.js';
import { publishShellStatus } from '../../lib/shell-status-store.js';
import { askConfirm, askUnsaved } from '../../lib/dialog-host.js';
import { registerQuitGuard, registerUnsavedTabsGuard } from '../../lib/workspace-tabs-guard.js';
import {
  pushWorkspaceHistoryEntry,
  registerWorkspaceHistoryApplier,
  type ApplyWorkspaceHistoryResult,
  type WorkspaceHistoryEntry,
} from '../../lib/workspace-history-store.js';
import { shortcutFor } from '../../lib/shortcut-labels.js';
import { registerAreaOpener, registerConfigOpener, type WorkspaceAreaTab } from '../../lib/workspace-area-store.js';
import { registerPaletteActions } from '../../lib/palette-actions-store.js';
import { ConfigPage } from '../config/ConfigPage.js';
import { DEFAULT_CONFIG_PAGE, configPageOfTabId, configTabId, findConfigPage } from '../config/config-pages.js';
import { publishWorkspacePanels, registerWorkspaceShellCommands } from '../../lib/workspace-shell-store.js';
import {
  closeBrowserTab,
  getBrowserTabsSnapshot,
  openManualTab,
  reconcileBrowserTabs,
  registerBrowserWorkbenchOpener,
  subscribeBrowserTabs,
} from '../../lib/browser-tabs-store.js';
import { seedFolderInstruction, seedWorkspaceInstruction } from '../../lib/instruction-seed.js';
import { entityBody } from '../../lib/entity-body.js';
import { useActiveWorkspace, useGoHome, useOpenWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import { requestObserve } from '../../lib/external-observe-store.js';
import { SessionFileBanner } from '../../components/workspace/SessionFileBanner.js';
import { rowStateOf, sessionStateDetail } from '../../lib/session-attention.js';
import { useSessions, sessionsQueryKey } from '../../hooks/use-sessions.js';
import { useCreateTerminal, useTerminals } from '../../hooks/use-terminals.js';
import { useRunChannels } from '../../hooks/use-run-channels.js';
import type { ChannelId } from '../../../shared/channel.js';
import { harnessGlyph } from '../../components/ChannelMark.js';
import { NewSessionDialog } from '../../components/workspace/NewSessionDialog.js';
import { useFolderRouting } from '../../hooks/use-folder-routing.js';
import { useEntityChangeInvalidation } from '../../hooks/use-entity-change-invalidation.js';
import {
  setShowHiddenFiles,
  useRefreshFiles,
  useShowHiddenFiles,
} from '../../hooks/use-file-browser.js';
import { useHealthReport } from '../../hooks/use-health-report.js';
import { useInvalidateInstructions } from '../../hooks/use-instructions.js';
import { isPersonalInstruction } from '../../../shared/entity.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import type { SessionAnchor, SessionOpenTarget, SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';
import type { TerminalSnapshot } from '../../../shared/terminal.js';
import { callIpc } from '../../lib/ipc.js';
import type { OpenEditorsState } from '../../../shared/open-editors.js';
import { OpenEditorsSection } from '../../components/workspace/OpenEditorsSection.js';
import { ProjectSearchPanel } from '../../components/workspace/ProjectSearchPanel.js';
import type { RowContextMenuAction } from '../../components/workspace/RowContextMenu.js';
import type { PathChange } from '../../components/workspace/use-explorer-actions.js';
import { fileIconFor } from '../../lib/file-icon.js';
import { registerExternalFileOpener, registerFileOpener } from '../../lib/file-opener.js';
import { revealInEditor, type RevealTarget } from '../../lib/editor-navigation.js';
import { noteRecentFile } from '../../lib/recent-files-store.js';
import { Copy, FolderSearch, Plus, History as HistoryGlyph, Pin, PinOff, X as XGlyph } from 'lucide-react';
import { restoreTabs, toPersisted, type EntityKind, type OpenTab, type RestoreContext } from './open-tabs.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads what still exists, to check a saved tab against. Anything unreachable (no terminals at Início) counts as gone. */
async function loadRestoreContext(): Promise<RestoreContext> {
  const settled = async <T,>(call: Promise<T>, fallback: T): Promise<T> => call.catch(() => fallback);
  const [skills, agents, instructions, terminals, sessions] = await Promise.all([
    settled(callIpc<Skill[]>('skill.list', { scope: 'personal' }), []),
    settled(callIpc<Agent[]>('agent.list', { scope: 'personal' }), []),
    settled(callIpc<Instruction[]>('instruction.list', {}), []),
    settled(callIpc<TerminalSnapshot[]>('terminal.list'), []),
    settled(callIpc<SessionSnapshot[]>('session.list'), []),
  ]);
  const entities = [...skills, ...agents, ...instructions];
  return {
    entitiesByUrn: new Map(entities.map((e) => [e.urn, e])),
    terminalIds: new Set(terminals.map((t) => t.terminalId)),
    sessionIds: new Set(sessions.map((s) => s.sessionId)),
    fileExists: (relPath) => callIpc('workspace.readFile', { path: relPath }).then(() => true, () => false),
  };
}

const PERSONAL_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['name', 'scope', 'description', 'version']);
const SCOPED_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['scope']);

/**
 * The pinned "Visão geral" tab — always first, never closed, never part of
 * `openTabs`: every close/reset path only ever touches `openTabs`, so the
 * overview survives them all by construction.
 */
const OVERVIEW_TAB_ID = 'overview';

/** Tabs that can hold unsaved work, and so need a discard guard before closing. */
function isDirty(tab: OpenTab): boolean {
  return (tab.kind === 'file' || tab.kind === 'skill' || tab.kind === 'agent' || tab.kind === 'instruction') && tab.dirty === true;
}

/** What the unsaved-changes dialog calls a tab: the file name, or the entity's name. */
function dirtyTabName(tab: OpenTab): string {
  if (tab.kind === 'file') return tab.relPath.split('/').pop() || tab.relPath;
  if (tab.kind === 'skill' || tab.kind === 'agent' || tab.kind === 'instruction') return tab.entity.name || 'Sem nome';
  return 'Sem nome';
}

/** Tabs that hold a draft the user can save. */
function isEditableTab(tab: OpenTab): boolean {
  return tab.kind === 'file' || tab.kind === 'skill' || tab.kind === 'agent' || tab.kind === 'instruction';
}

function entityTabGlyph(tab: Extract<OpenTab, { kind: EntityKind | 'instruction' }>): LucideIcon {
  if (tab.kind === 'instruction') return isPersonalInstruction(tab.entity) ? Globe : NotebookPen;
  return ENTITY_GROUP_ICONS[tab.kind];
}

/** Pinned file tabs first, each group keeping its own order. */
function pinnedFirst(tabs: readonly OpenTab[]): OpenTab[] {
  const pinned = (t: OpenTab): boolean => t.kind === 'file' && t.pinned === true;
  return [...tabs.filter(pinned), ...tabs.filter((t) => !pinned(t))];
}

function isAreaTabDef(a: AreaDef): a is AreaDef & { area: WorkspaceAreaTab } {
  return a.area !== 'workspace';
}

function isAreaTab(tab: OpenTab): tab is Extract<OpenTab, { kind: WorkspaceAreaTab }> {
  return (
    tab.kind === 'workspaces' ||
    tab.kind === 'starter-pack' ||
    tab.kind === 'marketplaces' ||
    tab.kind === 'diagnostico'
  );
}

export function WorkspaceScreen(): React.ReactElement {
  // `null` = Início (Global, no workspace open); `undefined` while loading.
  const { data: activeWorkspace } = useActiveWorkspace();
  const isHome = activeWorkspace === null;
  const switchWorkspace = useSwitchWorkspace();
  const openWorkspace = useOpenWorkspace();
  const goHomeMutation = useGoHome();
  const invalidateCustomization = useInvalidateCustomization();
  const invalidateInstructions = useInvalidateInstructions();
  const { data: sessions } = useSessions();
  const { data: terminals } = useTerminals(activeWorkspace != null);
  const createTerminal = useCreateTerminal();
  const folderRouting = useFolderRouting();
  const { data: healthReport } = useHealthReport('personal');
  const queryClient = useQueryClient();
  useEntityChangeInvalidation();

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const showError = (err: unknown): void => setToast({ variant: 'error', message: errorMessage(err) });

  // Every open file, session, AND entity being edited is a Workbench canvas
  // tab — these used to live in separate models (a file-tab array, a modal
  // slot, and a whole separate AppShell-level sessions dock); unifying them
  // is what makes the editor read as one VS Code-like surface. A session tab
  // only exists while the Workspace screen itself is mounted (navigating to
  // another Area unmounts it, same as any other open tab here) — the
  // `claude` process it's attached to keeps running server-side regardless,
  // and SessionPanel reattaches to it on remount via `session.status`.
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>(OVERVIEW_TAB_ID);
  const newTabSeq = useRef(0);
  // A tree row's right-click "Properties" action opens (or focuses) the
  // entity's own tab, then asks that specific tab's EditorPanel to show its
  // Properties modal — this id is that one-shot request, consumed (reset to
  // null) once the matching EditorPanel instance picks it up.
  const [propertiesRequestTabId, setPropertiesRequestTabId] = useState<string | null>(null);

  const explorerPanelRef = usePanelRef();
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [explorerView, setExplorerView] = useState<ExplorerView>('files');
  // Both side panels now share one collapse mechanism (resizable, collapses
  // to 0px) via SidePanel — the Control Panel used to be a fixed-width aside
  // with its own 40px icon-strip collapse mode; that's retired.
  const controlPanelRef = usePanelRef();
  const [controlPanelCollapsed, setControlPanelCollapsed] = useState(false);

  const refreshFiles = useRefreshFiles();
  const showHidden = useShowHiddenFiles();

  const openFileTab = (relPath: string, reveal?: RevealTarget): void => {
    noteRecentFile(relPath);
    // A renamed or moved tab keeps its original id, so match on the path it shows now.
    const existing = openTabs.find((t) => t.kind === 'file' && t.relPath === relPath && t.external !== true);
    const id = existing?.id ?? `file:${relPath}`;
    if (existing === undefined) setOpenTabs((prev) => [...prev, { id, kind: 'file', relPath }]);
    setActiveTabId(id);
    if (reveal) revealInEditor(relPath, reveal);
  };

  /** A file outside the workspace roots, already granted by main (drop or "Abrir arquivo…"). */
  const openExternalFileTab = (absPath: string): void => {
    const id = `ext:${absPath}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'file', relPath: absPath, external: true }]));
    setActiveTabId(id);
  };

  // Always calls the latest closure, so the registered openers never go stale.
  const openFileLatest = useEffectEvent((relPath: string, reveal?: RevealTarget) => openFileTab(relPath, reveal));
  const openExternalLatest = useEffectEvent((absPath: string) => openExternalFileTab(absPath));
  useEffect(() => {
    registerFileOpener((relPath, reveal) => openFileLatest(relPath, reveal));
    registerExternalFileOpener((paths) => paths.forEach((p) => openExternalLatest(p)));
    return () => {
      registerFileOpener(null);
      registerExternalFileOpener(null);
    };
  }, []);

  const openEntityTab = (kind: EntityKind, entity: Skill | Agent, isCreate: boolean): void => {
    const id = isCreate ? `entity-new:${kind}:${++newTabSeq.current}` : `entity:${entity.urn}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind, entity, isCreate }]));
    setActiveTabId(id);
  };

  const openInstructionTab = (entity: Instruction, isCreate: boolean): void => {
    const id = isCreate ? `entity-new:instruction:${++newTabSeq.current}` : `entity:${entity.urn}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'instruction', entity, isCreate }]));
    setActiveTabId(id);
  };

  // A Global entity seen from a workspace: its own tab id, so it never
  // collides with an editable tab for the same urn.
  const openInheritedTab = (entity: Skill | Agent | Instruction, kind: EntityKind | 'instruction'): void => {
    const id = `inherited:${entity.urn}`;
    setOpenTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      const tab: OpenTab =
        kind === 'instruction'
          ? { id, kind, entity: entity as Instruction, isCreate: false, inherited: true }
          : { id, kind, entity: entity as Skill | Agent, isCreate: false, inherited: true };
      return [...prev, tab];
    });
    setActiveTabId(id);
  };

  // "Editar no Início": leave the workspace (same discard guard as any
  // switch), then open the entity's real, editable tab there.
  const editAtHome = (entity: Skill | Agent | Instruction, kind: EntityKind | 'instruction'): void => {
    void resetTabs().then((ok) => {
      if (!ok) return;
      goHomeMutation
        .mutateAsync()
        .then(() => {
          if (kind === 'instruction') openInstructionTab(entity as Instruction, false);
          else openEntityTab(kind, entity as Skill | Agent, false);
        })
        .catch(showError);
    });
  };

  // Tab identity is keyed by the concrete sessionId (not the anchor), so a
  // workspace/personal anchor with several coexisting sessions gets one tab
  // per session — the caller always already has this id in hand, from a
  // spawn/resume response or an existing SessionSnapshot row.
  const openSessionTab = (session: Pick<SessionSnapshot, 'sessionId' | 'anchor' | 'label'>): void => {
    const id = `session:${session.sessionId}`;
    setOpenTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [...prev, { id, kind: 'session', anchor: session.anchor, sessionId: session.sessionId, label: session.label }],
    );
    setActiveTabId(id);
  };

  // A clicked notification: bring up that session's tab, or the read-only view of an external one.
  const onNotificationOpen = useEffectEvent((target: { id: string; external: boolean }): void => {
    if (target.external) {
      requestObserve(target.id);
      return;
    }
    const session = sessions?.find((s) => s.sessionId === target.id);
    if (session) openSessionTab(session);
  });
  useEffect(() => window.api.session.onOpenRequest((target) => onNotificationOpen(target)), []);

  // Main silences a notification for the session whose tab is in front; it needs to know which one that is.
  const focusedSessionId = openTabs.find((t) => t.id === activeTabId && t.kind === 'session');
  const focusedId = focusedSessionId?.kind === 'session' ? focusedSessionId.sessionId : null;
  useEffect(() => {
    void callIpc('session.setFocused', { sessionId: focusedId }).catch(() => {});
  }, [focusedId]);

  // Closing the tab only hides the view — the terminal itself lives in the main process until stopped and removed.
  const openTerminalTab = (terminal: Pick<TerminalSnapshot, 'terminalId'>): void => {
    const id = `terminal:${terminal.terminalId}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'terminal', terminalId: terminal.terminalId }]));
    setActiveTabId(id);
  };

  const onEditLaunchJson = (): void => openFileTab('.vscode/launch.json');

  const openTerminalIn = (relPath: string): void => {
    const { folder, rel } = folderRouting.split(relPath);
    createTerminal.mutate(
      { ...(rel !== '' ? { relCwd: rel } : {}), ...(folder !== undefined ? { folder } : {}) },
      { onSuccess: openTerminalTab, onError: showError },
    );
  };

  // Ctrl+`: a shell at the workspace root.
  useEffect(() => {
    if (!activeWorkspace) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'Backquote') {
        e.preventDefault();
        openTerminalIn('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A rendered, read-only view of a file's Markdown — reached via the tree's
  // right-click "Preview" menu, never via the normal click-to-open path.
  // Kept as its own tab (rather than a mode toggle inside the file's own
  // editing tab) so opening it never disturbs an already-open, in-progress
  // edit of the same file.
  const openFilePreviewTab = (relPath: string): void => {
    const id = `preview:file:${relPath}`;
    setOpenTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              kind: 'preview',
              label: relPath.split('/').pop() || relPath,
              source: { kind: 'file', path: relPath },
            },
          ],
    );
    setActiveTabId(id);
  };

  // Same idea as `openFilePreviewTab`, for a Skill/Agent/Instruction body —
  // the entity's already-loaded body is rendered straight away, no fetch.
  const openEntityPreviewTab = (urn: string, label: string, body: string): void => {
    const id = `preview:entity:${urn}`;
    setOpenTabs((prev) =>
      prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'preview', label, source: { kind: 'entity', body } }],
    );
    setActiveTabId(id);
  };

  // Starter Pack/Marketplaces/Diagnóstico read as ordinary, singleton
  // Workbench tabs (one fixed id each, same idea as `HISTORY_TAB_ID` below).
  // Their own entry point is the Explorer Panel's pinned rows (Início
  // only, built below as `appAreaRows`), which call this directly;
  // it's also registered externally (workspace-area-store.ts) so the TopNav
  // sync pill — outside this screen, with no prop path in — can focus the
  // Diagnóstico tab too.
  const openAreaTab = (kind: WorkspaceAreaTab): void => {
    setOpenTabs((prev) => (prev.some((t) => t.id === kind) ? prev : [...prev, { id: kind, kind }]));
    setActiveTabId(kind);
  };


  useEffect(() => {
    registerAreaOpener(openAreaTab);
    return () => {
      registerAreaOpener(null);
    };
  });

  // A browser tab is identity-keyed by its own `tabId` (a `sessionId` for one
  // opened via a `SessionPanel` toggle, a fresh id for a manual one) — same
  // registered-callback shape as `openAreaTab` above, since the things that
  // open one (that same `SessionPanel`, buried inside this very canvas; a
  // marketplace/footer link or the TopNav button, outside this screen
  // entirely) have no prop path in either way. `browser-tabs-store.ts` is the
  // source of truth for which tabs exist; this only decides which of them is
  // a Workbench tab and which one is active.
  const openBrowserWorkbenchTab = (tabId: string, focus = true): void => {
    const id = `browser:${tabId}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'browser', tabId }]));
    if (focus) setActiveTabId(id);
  };

  useEffect(() => {
    registerBrowserWorkbenchOpener(openBrowserWorkbenchTab);
    return () => registerBrowserWorkbenchOpener(null);
  });

  // Mount-only: recovers whichever browser tabs survived a renderer reload
  // main-process side, reopening each as a Workbench tab. Must run after the
  // opener registration above (same-commit effect order guarantees that).
  useEffect(() => {
    void reconcileBrowserTabs();
  }, []);

  const { tabs: browserTabs } = useSyncExternalStore(subscribeBrowserTabs, getBrowserTabsSnapshot);

  // The only thing an EditorPanel reports upward about its own edits — never
  // its draft content, never CodeMirror/Entity internals — so a tab's dirty
  // dot and the discard guards below stay simple boolean bookkeeping. Preview
  // tabs are read-only and never report dirty, same as session tabs.
  const setTabDirty = (id: string, dirty: boolean): void =>
    setOpenTabs((prev) => prev.map((t) => (t.id === id && t.kind !== 'session' && t.kind !== 'preview' ? { ...t, dirty } : t)));

  // Restores the tabs this workspace (or Início) had open before a reload, then
  // keeps them saved. `hydratedKey` gates saving: until the saved list has
  // been read back for the current workspace, an empty `openTabs` must not
  // overwrite it.
  const workspaceKey = activeWorkspace === undefined ? undefined : (activeWorkspace?.id ?? 'home');
  const [hydratedKey, setHydratedKey] = useState<string | undefined>(undefined);
  // `resetTabs` empties the list on its way out of a workspace; that must not
  // be saved over the workspace being left.
  const skipSaveRef = useRef(false);

  useEffect(() => {
    if (workspaceKey === undefined) return;
    let cancelled = false;
    skipSaveRef.current = false;
    void (async () => {
      try {
        const saved = await callIpc<OpenEditorsState>('openEditors.get');
        const savedTabs = Array.isArray(saved?.tabs) ? saved.tabs : [];
        const restored = await restoreTabs(savedTabs, await loadRestoreContext());
        if (cancelled) return;
        // Tabs opened while this was loading (a browser tab recovered from main) stay.
        setOpenTabs((prev) => [...restored, ...prev.filter((t) => !restored.some((r) => r.id === t.id))]);
        if (saved?.activeTabId && restored.some((t) => t.id === saved.activeTabId)) {
          setActiveTabId((cur) => (cur === OVERVIEW_TAB_ID ? saved.activeTabId! : cur));
        }
      } catch (err) {
        console.warn('Could not restore the open editors', err);
      }
      if (!cancelled) setHydratedKey(workspaceKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceKey]);

  useEffect(() => {
    if (workspaceKey === undefined || hydratedKey !== workspaceKey) return;
    if (skipSaveRef.current) {
      if (openTabs.length === 0) return;
      skipSaveRef.current = false;
    }
    const timer = setTimeout(() => {
      callIpc('openEditors.save', { tabs: toPersisted(openTabs), activeTabId }).catch((err: unknown) =>
        console.warn('Could not save the open editors', err),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [openTabs, activeTabId, workspaceKey, hydratedKey]);

  // Each mounted editor registers how to save itself (it owns its draft), so the
  // unsaved-changes dialog's Salvar / Salvar tudo and the menu's ⌘S can reach it.
  const saveFnsRef = useRef(new Map<string, () => Promise<boolean>>());
  const registerTabSave =
    (tabId: string) =>
    (save: (() => Promise<boolean>) | null): void => {
      if (save) saveFnsRef.current.set(tabId, save);
      else saveFnsRef.current.delete(tabId);
    };

  // Asks what to do with the unsaved work in `tabs`. True = safe to drop them
  // (saved, or the user chose Não salvar); false = the user cancelled, or a save failed.
  const settleDirtyTabs = async (tabs: readonly OpenTab[]): Promise<boolean> => {
    const dirty = tabs.filter(isDirty);
    if (dirty.length === 0) return true;
    const decision = await askUnsaved(dirty.map(dirtyTabName));
    if (decision === 'cancel') return false;
    if (decision === 'discard') return true;
    for (const tab of dirty) {
      const save = saveFnsRef.current.get(tab.id);
      if (!save || !(await save())) return false;
    }
    return true;
  };

  // The last 20 closed file tabs, most recent first, for "Reabrir aba fechada".
  const [closedTabs, setClosedTabs] = useState<Array<{ relPath: string; pinned: boolean }>>([]);
  const rememberClosed = (tab: OpenTab | undefined): void => {
    if (tab?.kind !== 'file' || tab.external === true || tab.removed === true) return;
    setClosedTabs((prev) => [{ relPath: tab.relPath, pinned: tab.pinned === true }, ...prev].slice(0, 20));
  };
  const reopenClosedTab = (): void => {
    const [last, ...rest] = closedTabs;
    if (!last) return;
    setClosedTabs(rest);
    const id = `file:${last.relPath}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'file', relPath: last.relPath, ...(last.pinned ? { pinned: true } : {}) }]));
    setActiveTabId(id);
  };

  const removeTab = (id: string): void => {
    rememberClosed(openTabs.find((t) => t.id === id));
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur === id ? (next[next.length - 1]?.id ?? OVERVIEW_TAB_ID) : cur));
      return next;
    });
  };

  const isPinnedTab = (t: OpenTab): boolean => t.kind === 'file' && t.pinned === true;

  /** Every tab a bulk close may touch: never the pinned ones. */
  const closeMany = (targets: readonly OpenTab[]): void => {
    const closable = targets.filter((t) => !isPinnedTab(t));
    if (closable.length === 0) return;
    void settleDirtyTabs(closable).then((ok) => {
      if (!ok) return;
      const ids = new Set(closable.map((t) => t.id));
      for (const tab of closable) {
        rememberClosed(tab);
        if (tab.kind === 'browser') void closeBrowserTab(tab.tabId);
      }
      setOpenTabs((prev) => prev.filter((t) => !ids.has(t.id)));
      setActiveTabId((cur) => (ids.has(cur) ? OVERVIEW_TAB_ID : cur));
    });
  };

  const togglePin = (id: string): void =>
    setOpenTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.kind !== 'file') return t;
        const { pinned: _was, ...rest } = t;
        return t.pinned === true ? rest : { ...rest, pinned: true };
      }),
    );

  /** Drag-reorder; a tab never crosses the pinned/unpinned divider. */
  const reorderTabs = (fromId: string, toId: string): void =>
    setOpenTabs((prev) => {
      const from = prev.find((t) => t.id === fromId);
      const to = prev.find((t) => t.id === toId);
      if (!from || !to || isPinnedTab(from) !== isPinnedTab(to)) return prev;
      const without = prev.filter((t) => t.id !== fromId);
      without.splice(without.findIndex((t) => t.id === toId) + (prev.indexOf(from) < prev.indexOf(to) ? 1 : 0), 0, from);
      return without;
    });

  const underPath = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

  /** Open tabs follow a renamed or moved file or folder: same tab, same text, new path. */
  const retargetTabs = (changes: PathChange[]): void =>
    setOpenTabs((prev) =>
      prev.map((t) => {
        if (t.kind !== 'file' || t.external === true) return t;
        for (const { from, to } of changes) {
          if (underPath(t.relPath, from)) return { ...t, relPath: `${to}${t.relPath.slice(from.length)}`, removed: false };
        }
        return t;
      }),
    );

  /** Files or folders went to the trash: their tabs stay, flagged, keeping unsaved text. */
  const markTabsRemoved = (paths: string[]): void =>
    setOpenTabs((prev) => prev.map((t) => (t.kind === 'file' && t.external !== true && paths.some((p) => underPath(t.relPath, p)) ? { ...t, removed: true } : t)));

  // The tree changed on disk outside the app: re-read listings, and flag open
  // tabs whose file vanished (a rename done in Finder looks like a removal).
  const queryClientForTree = queryClient;
  const onTreeChanged = useEffectEvent(() => {
    void queryClientForTree.invalidateQueries({ queryKey: ['workspace', 'listDir'] });
    void queryClientForTree.invalidateQueries({ queryKey: ['workspace', 'listFiles'] });
    const files = openTabs.filter((t): t is Extract<OpenTab, { kind: 'file' }> => t.kind === 'file' && t.external !== true);
    void Promise.all(
      files.map(async (t) => ({ id: t.id, gone: !(await callIpc('workspace.readFile', { path: t.relPath }).then(() => true, () => false)) })),
    ).then((results) => {
      const goneIds = new Set(results.filter((r) => r.gone).map((r) => r.id));
      setOpenTabs((prev) =>
        prev.map((t) => {
          if (t.kind !== 'file' || t.external === true || !results.some((r) => r.id === t.id)) return t;
          const gone = goneIds.has(t.id);
          return (t.removed === true) === gone ? t : { ...t, removed: gone };
        }),
      );
    });
  });
  useEffect(() => window.api.workspace?.onTreeChanged(() => onTreeChanged()), []);

  // Closes every tab at once, behind the same unsaved-changes dialog as closing one.
  const closeAllTabs = (): void => {
    void settleDirtyTabs(openTabs).then((ok) => {
      if (!ok) return;
      for (const tab of openTabs) if (tab.kind === 'browser') void closeBrowserTab(tab.tabId);
      setOpenTabs([]);
      setActiveTabId(OVERVIEW_TAB_ID);
    });
  };

  const closeTab = (id: string): void => {
    const target = openTabs.find((t) => t.id === id);
    if (target && isDirty(target)) {
      void settleDirtyTabs([target]).then((ok) => {
        if (ok) removeTab(id);
      });
      return;
    }
    removeTab(id);
  };

  // Returns whether the reset actually happened — false means the caller
  // asked to leave unsaved tabs behind and the user declined (or a save
  // failed), so the caller's own state change (switching workspace) must not
  // proceed either.
  const resetTabs = async (): Promise<boolean> => {
    if (!(await settleDirtyTabs(openTabs))) return false;
    // Leaving the workspace ends its terminals (main does it on activation); exited ones don't count.
    const runningCount = (terminals ?? []).filter((t) => t.status === 'running').length;
    if (
      runningCount > 0 &&
      !(await askConfirm({
        title: 'Encerrar terminais?',
        message: `${runningCount} terminal(is) em execução serão encerrados ao trocar.`,
        confirmLabel: 'Encerrar e trocar',
      }))
    )
      return false;
    skipSaveRef.current = true;
    setOpenTabs([]);
    setActiveTabId(OVERVIEW_TAB_ID);
    return true;
  };

  // AppShell's "Início" nav button switches the active workspace from
  // outside this screen entirely (it's an ancestor, not a descendant, so it
  // has no prop path to `resetTabs`) — register the same guard it already
  // uses for every switch reachable from inside this screen.
  useEffect(() => {
    registerUnsavedTabsGuard(resetTabs);
    // Quitting only needs the unsaved-changes question: terminals live in main and are not ours to end here.
    registerQuitGuard(() => settleDirtyTabs(openTabs));
    return () => {
      registerUnsavedTabsGuard(null);
      registerQuitGuard(null);
    };
  });

  // Records the open workspace (or Início) + active tab as a Workbench
  // "location" every time either changes, so TopNav's back/forward buttons
  // have somewhere to navigate to — see workspace-history-store.ts for the
  // full picture.
  useEffect(() => {
    if (activeWorkspace === undefined) return;
    pushWorkspaceHistoryEntry({ workspaceId: activeWorkspace?.id ?? null, activeTabId });
  }, [activeWorkspace, activeTabId]);

  // Applies one history entry. A workspace change reuses `resetTabs()` (same
  // confirm-then-wipe every workspace switch already needs — a different
  // workspace's tabs and entities don't exist here). Reporting 'stale' for a
  // since-closed tab instead lets the store prune it and keep walking
  // back/forward.
  const applyWorkspaceHistoryEntry = async (entry: WorkspaceHistoryEntry): Promise<ApplyWorkspaceHistoryResult> => {
    const workspaceChanged = entry.workspaceId !== (activeWorkspace?.id ?? null);
    if (workspaceChanged) {
      if (!(await resetTabs())) return 'declined';
      try {
        if (entry.workspaceId === null) await goHomeMutation.mutateAsync();
        else await switchWorkspace.mutateAsync(entry.workspaceId);
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
        return 'declined';
      }
      return 'applied';
    }
    const target = entry.activeTabId ?? OVERVIEW_TAB_ID;
    if (target !== OVERVIEW_TAB_ID && !openTabs.some((t) => t.id === target)) return 'stale';
    setActiveTabId(target);
    return 'applied';
  };

  useEffect(() => {
    registerWorkspaceHistoryApplier(applyWorkspaceHistoryEntry);
    return () => registerWorkspaceHistoryApplier(null);
  });

  // A tab keeps its identity across a save: an in-progress "new skill" tab
  // becomes that skill's real `entity:<urn>` tab in place, the same way
  // saving a file doesn't open a second tab for it.
  const handleTabSaved = (id: string, saved: Skill | Agent | Instruction): void => {
    const savedId = `entity:${saved.urn}`;
    setOpenTabs((prev) =>
      prev.map((t) => (t.id === id && t.kind !== 'file' && t.kind !== 'session' ? ({ ...t, id: savedId, entity: saved, isCreate: false, dirty: false } as OpenTab) : t)),
    );
    setActiveTabId((cur) => (cur === id ? savedId : cur));
  };

  const openInstructionEditor = (entity: Instruction, isCreate: boolean): void => openInstructionTab(entity, isCreate);

  const previewEntity = (entity: Skill | Agent | Instruction): void =>
    openEntityPreviewTab(entity.urn, entity.name, entityBody(entity));

  // Opens (or focuses) an already-saved entity's own tab, then asks that tab
  // to show its Properties modal — the tab id it targets (`entity:${urn}`)
  // matches exactly what `openEntityTab`/`openInstructionTab` give an
  // existing (non-create) entity's tab.
  const requestEntityProperties = (kind: EntityKind, entity: Skill | Agent): void => {
    openEntityTab(kind, entity, false);
    setPropertiesRequestTabId(`entity:${entity.urn}`);
  };
  const requestInstructionProperties = (entity: Instruction): void => {
    openInstructionTab(entity, false);
    setPropertiesRequestTabId(`entity:${entity.urn}`);
  };

  // Where a session started from "here" runs: the open workspace's root, or
  // the home dir at Início.
  const currentAnchor: SessionAnchor = activeWorkspace
    ? { kind: 'workspace', workspaceId: activeWorkspace.id }
    : { kind: 'personal' };

  // The item's own workspace scope, never its `entity` urn — an `entity`
  // anchor would reuse an already-running session for that item instead of
  // the fresh one "New Action" always wants. `personal`-scoped entities (no
  // workspace of their own) run wherever the user currently is.
  const anchorForEntityScope = (entity: Pick<Skill | Agent | Instruction, 'scopes' | 'scopeId'>): SessionAnchor =>
    entity.scopes[0] === 'workspace' && entity.scopeId
      ? { kind: 'workspace', workspaceId: entity.scopeId }
      : currentAnchor;

  // Right-click → "New Action": always a brand-new session whose first
  // message is a draft `@<path>` reference the user reviews and edits before
  // sending — never auto-submitted. Written immediately if the spawn
  // response already carries startup output (`outputBuffer`), otherwise
  // deferred to the session's first live output chunk, so the draft never
  // races the `claude` REPL's own readiness.
  const startNewActionSession = (anchor: SessionAnchor, path: string): void => {
    void (async () => {
      try {
        const session = await callIpc<SessionSnapshotWithOutput>('session.spawn', { anchor });
        openSessionTab(session);
        void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
        const draft = `@${path} — describe the new action you want to create based on this`;
        const write = (): void => void callIpc('session.write', { sessionId: session.sessionId, data: draft });
        if (session.outputBuffer) {
          write();
        } else {
          const unsubscribe = window.api.session.onOutput(session.sessionId, () => {
            unsubscribe();
            write();
          });
        }
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
      }
    })();
  };

  // "Perguntar à IA" in the command palette: a fresh session in `channel` whose
  // input holds the question as an unsent draft — the user reviews it and
  // presses Enter, same contract as `startNewActionSession`.
  const startDraftSession = (anchor: SessionAnchor, harness: ChannelId, draft: string): void => {
    void (async () => {
      try {
        const session = await callIpc<SessionSnapshotWithOutput>('session.spawn', { anchor, harness });
        openSessionTab(session);
        void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
        const write = (): void => void callIpc('session.write', { sessionId: session.sessionId, data: draft });
        if (session.outputBuffer) {
          write();
        } else {
          const unsubscribe = window.api.session.onOutput(session.sessionId, () => {
            unsubscribe();
            write();
          });
        }
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
      }
    })();
  };

  const newActionFromResolvedPath = (anchor: SessionAnchor, resolvePath: () => Promise<string>): void => {
    void (async () => {
      try {
        startNewActionSession(anchor, await resolvePath());
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
      }
    })();
  };

  // Files/folders already sit inside the workspace's own tree, so their
  // relPath already matches a workspace-anchored session's cwd — no path
  // resolution IPC round trip needed, unlike entities (see below).
  const newActionForFile = (relPath: string): void => {
    if (!activeWorkspace) return;
    // Multi-folder: the session sees only the file's folder, so the draft path is relative to it.
    const { folder, rel } = folderRouting.split(relPath);
    if (folder === undefined) {
      startNewActionSession({ kind: 'workspace', workspaceId: activeWorkspace.id }, relPath);
      return;
    }
    startNewActionSession({ kind: 'workspace', workspaceId: activeWorkspace.id, folders: [folder] }, rel === '' ? '.' : rel);
  };

  const newActionForEntity = (kind: EntityKind, entity: Skill | Agent): void =>
    newActionFromResolvedPath(anchorForEntityScope(entity), async () => {
      const { absolutePath } = await callIpc<{ absolutePath: string }>(`${kind}.resolvePath`, { id: entity.name });
      return absolutePath;
    });

  const newActionForInstruction = (entity: Instruction): void =>
    newActionFromResolvedPath(anchorForEntityScope(entity), async () => {
      const params = isPersonalInstruction(entity) ? {} : { id: entity.name };
      const { absolutePath } = await callIpc<{ absolutePath: string }>('instruction.resolvePath', params);
      return absolutePath;
    });

  // Skills/Agents split into the open workspace's own vs Global; Hooks have
  // no workspace tier of their own yet, and MCP's own local tier
  // ('project-local'/'project-shared') keys off a filesystem path instead.
  const entityLocalScope = activeWorkspace ? { scope: 'workspace' as const, scopeId: activeWorkspace.id } : undefined;
  const mcpMatchPath = activeWorkspace?.rootPath;

  const removeSessionTab = (sessionId: string): void => closeTab(`session:${sessionId}`);

  // What the Histórico tab means by "here": the open workspace, or every
  // conversation on the machine at Início.
  const historyScope: HistoryScope | null = activeWorkspace
    ? { kind: 'workspace', workspaceId: activeWorkspace.id }
    : isHome
      ? { kind: 'all' }
      : null;
  // The right panel's Sessões lists the same set the Histórico tab opens by
  // "Ver as N sessões": the workspace's own, or every conversation at Início.
  const sessionsScope: HistoryScope = activeWorkspace
    ? { kind: 'workspace', workspaceId: activeWorkspace.id }
    : { kind: 'all' };

  // One fixed id, so "Ver todas" focuses the tab that is already open rather
  // than stacking a second copy of the same dashboard beside it.
  const HISTORY_TAB_ID = 'history';
  const openHistoryTab = (): void => {
    setOpenTabs((prev) => (prev.some((t) => t.id === HISTORY_TAB_ID) ? prev : [...prev, { id: HISTORY_TAB_ID, kind: 'history' }]));
    setActiveTabId(HISTORY_TAB_ID);
  };

  // One tab per (source, path): re-clicking a changed file focuses its diff,
  // while the staged and unstaged sides of the same file stay distinct.
  const openGitDiffTab = ({ path, source }: { path: string; source: GitDiffSource }): void => {
    const sourceKey = source.kind === 'commit' ? `commit-${source.sha}` : source.kind;
    const id = `git-diff:${sourceKey}:${path}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'git-diff', path, source }]));
    setActiveTabId(id);
  };

  // A session keeps running when you leave its scope, so one listed from here
  // may belong to another workspace (or Início): go there first — same discard
  // guard as any switch — then open its tab. Its tab is saved with that scope's
  // own editors, so it is restored there too.
  const openSessionAnywhere = (session: SessionOpenTarget): void => {
    const here = activeWorkspace?.id ?? null;
    if (session.scopeId === undefined || session.scopeId === here) {
      openSessionTab(session);
      return;
    }
    const targetScope = session.scopeId;
    void resetTabs().then((ok) => {
      if (!ok) return;
      const switched = targetScope === null ? goHomeMutation.mutateAsync() : switchWorkspace.mutateAsync(targetScope);
      switched.then(() => openSessionTab(session)).catch(showError);
    });
  };

  // The "+" in the Sessões panel header: always a fresh session (coexisting
  // with any already open for the same anchor) wherever the user currently is.
  const spawnSession = (anchor: SessionAnchor, harness: ChannelId = 'claude'): void => {
    void (async () => {
      try {
        const session = await callIpc<SessionSnapshotWithOutput>('session.spawn', { anchor, harness });
        openSessionTab(session);
        void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
      }
    })();
  };
  // A multi-folder workspace asks which folders the session sees; otherwise it starts right away.
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const runHarnesses = useRunChannels();
  // The dialog also opens when a second harness is enabled, so the harness can be chosen.
  const handleNewSession = (): void => {
    if ((activeWorkspace && folderRouting.multi) || runHarnesses.options.length > 1) {
      runHarnesses.refresh();
      setNewSessionOpen(true);
    } else spawnSession(currentAnchor);
  };

  // The imperative collapse()/expand() calls drive the real (pixel-measured)
  // layout, but the boolean below is what the menu label and the
  // `data-collapsed` test hook read — set directly here rather than derived
  // solely from `onResize`, since jsdom never lays elements out (offsetWidth
  // is always 0), so the library's own resize feedback never settles there.
  const toggleExplorerPanel = (): void => {
    const panel = explorerPanelRef.current;
    if (!panel) return;
    setExplorerCollapsed((collapsed) => {
      if (collapsed) panel.expand();
      else panel.collapse();
      return !collapsed;
    });
  };

  // Config pages are singleton Workbench tabs too, one fixed id per page.
  // Global settings: every scope's Config tabs edit the same thing.
  const lastConfigPageRef = useRef<string>(DEFAULT_CONFIG_PAGE);
  const openConfigPage = (page: string): void => {
    const id = configTabId(page);
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'config', page }]));
    setActiveTabId(id);
  };
  // Header button and ⌘,: show the Config view and focus a page (last one in front, else the default).
  const openConfigView = (page?: string): void => {
    setExplorerView('config');
    if (explorerCollapsed) toggleExplorerPanel();
    openConfigPage(page ?? lastConfigPageRef.current);
  };
  const activeConfigPage = activeTabId.startsWith('config:') ? configPageOfTabId(activeTabId) : null;
  useEffect(() => {
    if (activeConfigPage !== null) lastConfigPageRef.current = activeConfigPage;
  }, [activeConfigPage]);
  useEffect(() => {
    registerConfigOpener(openConfigView);
    return () => registerConfigOpener(null);
  });

  // The command palette (above this screen) opens sessions and customizations,
  // and starts a session with a draft question, through these.
  useEffect(() => {
    registerPaletteActions({
      openSession: openSessionAnywhere,
      openEntity: (kind, entity) => openEntityTab(kind, entity, false),
      startSession: ({ prompt, channel }) => startDraftSession(currentAnchor, channel, prompt),
    });
    return () => registerPaletteActions(null);
  });

  const toggleControlPanel = (): void => {
    const panel = controlPanelRef.current;
    if (!panel) return;
    setControlPanelCollapsed((collapsed) => {
      if (collapsed) panel.expand();
      else panel.collapse();
      return !collapsed;
    });
  };

  // A folder row's "Abrir como workspace": leaves this workspace for that
  // folder's own (existing or new) — a real switch, so the same discard guard.
  const handleOpenAsWorkspace = async (absolutePath: string): Promise<void> => {
    if (!(await resetTabs())) return;
    try {
      const opened = await openWorkspace.mutateAsync(absolutePath);
      setToast({ variant: 'success', message: `Workspace aberto: ${opened.name}` });
    } catch (err) {
      showError(err);
    }
  };

  const focusOverviewTab = (): void => setActiveTabId(OVERVIEW_TAB_ID);

  // The TopNav (switcher, panel toggles) and ⌘K live above this screen.
  useEffect(() => {
    registerWorkspaceShellCommands({
      focusOverview: focusOverviewTab,
      togglePanel: (side) => (side === 'explorer' ? toggleExplorerPanel() : toggleControlPanel()),
    });
    return () => registerWorkspaceShellCommands(null);
  });

  useEffect(() => {
    publishWorkspacePanels({ explorerCollapsed, controlCollapsed: controlPanelCollapsed });
  }, [explorerCollapsed, controlPanelCollapsed]);

  // ⌘0 / Ctrl+0: Visão geral.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        setActiveTabId(OVERVIEW_TAB_ID);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // "Ver alterações": opens the Explorer's Git view, expanding the panel if it is collapsed.
  const showGitView = (): void => {
    setExplorerView('git');
    if (explorerCollapsed) toggleExplorerPanel();
  };

  const overviewTab: WorkbenchTab = {
    id: OVERVIEW_TAB_ID,
    glyph: activeWorkspace ? Folder : House,
    label: 'Visão geral',
    iconOnly: true,
    dense: true,
    render: (hidden) =>
      activeWorkspace ? (
        <WorkspaceOverview
          workspace={activeWorkspace}
          visible={!hidden}
          onShowGit={showGitView}
          onNewSession={handleNewSession}
          onOpenSession={openSessionTab}
          onOpenInstruction={openInstructionTab}
          onOpenTerminal={openTerminalTab}
          onError={(message) => setToast({ variant: 'error', message })}
        />
      ) : (
        <HomeOverview
          onOpenSession={openSessionTab}
          onOpenHistory={openHistoryTab}
          onOpenDiagnostics={() => openAreaTab('diagnostico')}
        />
      ),
  };

  // Pinned tabs always sit left of the others, in their own relative order.
  const orderedTabs = pinnedFirst(openTabs);
  const dirtyFilePaths = new Set(openTabs.flatMap((t) => (t.kind === 'file' && t.dirty === true ? [t.relPath] : [])));
  const canvasTabs: WorkbenchTab[] = orderedTabs.map((tab): WorkbenchTab => {
    if (tab.kind === 'file') {
      const name = tab.relPath.split('/').pop() || tab.relPath;
      const icon = fileIconFor(name);
      return {
        id: tab.id,
        glyph: icon.glyph,
        glyphTone: icon.tone,
        label: tab.removed === true ? `${name} (removido)` : name,
        breadcrumb: tab.relPath,
        pinned: tab.pinned === true,
        dense: true,
        dirty: tab.dirty ?? false,
        onClose: () => closeTab(tab.id),
        render: (hidden) => (
          <>
            <SessionFileBanner
              relPath={tab.relPath}
              dirty={tab.dirty === true}
              onViewDiff={() => openGitDiffTab({ path: tab.relPath, source: { kind: 'worktree' } })}
            />
            <EditorPanel
              subject="file"
              path={tab.relPath}
              external={tab.external === true}
              removed={tab.removed === true}
              active={!hidden}
              onDirtyChange={(dirty) => setTabDirty(tab.id, dirty)}
              registerSave={registerTabSave(tab.id)}
            />
          </>
        ),
      };
    }
    if (tab.kind === 'git-diff') {
      const name = tab.path.slice(tab.path.lastIndexOf('/') + 1);
      return {
        id: tab.id,
        glyph: GitCompare,
        label: `${name} ${tab.source.kind === 'index' ? '(stage)' : '(alterações)'}`,
        breadcrumb: tab.path,
        dense: true,
        onClose: () => closeTab(tab.id),
        render: () => (
          <DiffView path={tab.path} source={tab.source} />
        ),
      };
    }
    if (tab.kind === 'history') {
      return {
        id: tab.id,
        glyph: History,
        label: 'Histórico',
        dense: true,
        onClose: () => closeTab(tab.id),
        render: () => <SessionHistoryTab projectScope={historyScope} onOpenSession={openSessionTab} />,
      };
    }
    if (tab.kind === 'preview') {
      return {
        id: tab.id,
        glyph: Eye,
        label: tab.label,
        dense: true,
        onClose: () => closeTab(tab.id),
        render: () => <EditorPanel subject="preview" source={tab.source} />,
      };
    }
    if (isAreaTab(tab)) {
      const areaDef = NAV_AREAS.find((a) => a.area === tab.kind);
      const areaScreen =
        tab.kind === 'workspaces' ? (
          <WorkspacesScreen />
        ) : tab.kind === 'starter-pack' ? (
          <StarterPackScreen />
        ) : tab.kind === 'marketplaces' ? (
          <MarketplaceList />
        ) : (
          <HealthScreen />
        );
      return {
        id: tab.id,
        glyph: areaDef?.glyph ?? Eye,
        label: areaDef?.label ?? tab.kind,
        dense: true,
        onClose: () => closeTab(tab.id),
        render: () => areaScreen,
      };
    }
    if (tab.kind === 'config') {
      const pageDef = findConfigPage(tab.page);
      return {
        id: tab.id,
        glyph: pageDef?.glyph ?? Eye,
        label: pageDef?.label ?? 'Configurações',
        breadcrumb: `Configurações › ${pageDef?.label ?? tab.page}`,
        dense: true,
        onClose: () => closeTab(tab.id),
        render: () => <ConfigPage page={tab.page} />,
      };
    }
    if (tab.kind === 'browser') {
      // The label tracks the tab's live url (kept in `browser-tabs-store.ts`,
      // updated by `BrowserPane` as it navigates) rather than anything
      // captured at open time, so it doesn't go stale as the tab is used.
      const liveTab = browserTabs.find((t) => t.tabId === tab.tabId);
      return {
        id: tab.id,
        glyph: Globe,
        label: liveTab?.url || 'Nova aba',
        dense: true,
        onClose: () => {
          void closeBrowserTab(tab.tabId);
          closeTab(tab.id);
        },
        render: () => <BrowserPane tabId={tab.tabId} />,
      };
    }
    if (tab.kind === 'session') {
      // The session itself keeps running server-side regardless of this
      // tab's fate (see `openTabs`' own comment) — closing it while its
      // process is still 'running' is a minimize, not a real close, so the
      // action reads that way instead of implying the session is gone.
      const running = sessions?.some((s) => s.sessionId === tab.sessionId && s.status === 'running') ?? false;
      const tabSession = sessions?.find((s) => s.sessionId === tab.sessionId);
      const tabHarness = tabSession?.harness;
      const tabDetail = tabSession ? sessionStateDetail(tabSession) : undefined;
      return {
        id: tab.id,
        ...(tabSession ? { sessionState: rowStateOf(tabSession) } : {}),
        ...(tabHarness ? { sessionChannel: tabHarness } : {}),
        ...(tabDetail ? { sessionDetail: tabDetail } : {}),
        glyph: tabHarness ? harnessGlyph(tabHarness) : SquareTerminal,
        label: tab.label,
        closeLabel: running ? 'Minimizar' : 'Fechar',
        // Manages its own edge-to-edge spacing (padding only around the
        // header, none around the terminal itself) — the canvas's own p:2
        // would otherwise leave a margin around the terminal that breaks the
        // "this is the whole page" effect.
        dense: true,
        onClose: () => closeTab(tab.id),
        render: (hidden) => <SessionPanel anchor={tab.anchor} sessionId={tab.sessionId} visible={!hidden} />,
      };
    }
    if (tab.kind === 'terminal') {
      const terminal = terminals?.find((t) => t.terminalId === tab.terminalId);
      const dot = terminal?.status === 'exited' && terminal.exitCode === 0 ? '○' : '●';
      return {
        id: tab.id,
        glyph: SquareTerminal,
        label: terminal ? `${dot} ${terminal.name} · ${terminal.relCwd === '' ? 'raiz' : terminal.relCwd}` : 'terminal',
        // The process outlives the tab either way; the label says so.
        closeLabel: 'Fechar aba',
        dense: true,
        onClose: () => closeTab(tab.id),
        render: (hidden) => (
          <TerminalPanel key={`${tab.terminalId}:${terminal?.generation ?? 0}`} terminalId={tab.terminalId} visible={!hidden} />
        ),
      };
    }
    const isPersonal = tab.kind === 'instruction' && isPersonalInstruction(tab.entity);
    // An instruction's own `entity.name` is just its workspace's basename (see
    // `instruction-seed.ts`) — the same name a file/skill tab for that same
    // scope could also carry — so the tab label alone can't tell two tabs
    // apart. The scope name below is what actually does.
    const scopeName = tab.inherited
      ? 'Global'
      : tab.entity.scopes[0] === 'workspace'
        ? activeWorkspace?.name
        : undefined;
    const breadcrumb =
      tab.kind === 'instruction'
        ? scopeName
          ? `${scopeName} › INSTRUCTIONS`
          : 'INSTRUCTIONS'
        : scopeName
          ? `${scopeName} › ${tab.kind === 'skill' ? 'Skills' : 'Agents'} › ${tab.entity.name || 'Novo'}`
          : `${tab.kind === 'skill' ? 'Skills' : 'Agents'} › ${tab.entity.name || 'Novo'}`;
    return {
      id: tab.id,
      glyph: entityTabGlyph(tab),
      label: tab.entity.name || (tab.isCreate ? 'Novo' : tab.entity.name),
      breadcrumb,
      accentColor: ENTITY_ACCENT_COLOR[tab.kind],
      dense: true,
      dirty: tab.dirty ?? false,
      onClose: () => closeTab(tab.id),
      render: (hidden) => (
        <EditorPanel
          subject="entity"
          initial={tab.entity}
          isCreate={tab.isCreate}
          active={!hidden}
          {...(tab.kind === 'instruction' ? { hiddenFields: isPersonal ? PERSONAL_HIDDEN : SCOPED_HIDDEN } : {})}
          onSaved={async (saved) => {
            handleTabSaved(tab.id, saved);
            if (tab.kind === 'instruction') {
              await invalidateInstructions();
              setToast({ variant: 'success', message: 'Instruction salva' });
            } else {
              await invalidateCustomization(tab.kind);
              setToast({ variant: 'success', message: `${saved.name} salvo` });
            }
          }}
          onDirtyChange={(dirty) => setTabDirty(tab.id, dirty)}
          registerSave={registerTabSave(tab.id)}
          openPropertiesRequest={tab.id === propertiesRequestTabId}
          onPropertiesRequestHandled={() => setPropertiesRequestTabId(null)}
          {...(tab.inherited ? { inherited: { onEditAtHome: () => editAtHome(tab.entity, tab.kind) } } : {})}
        />
      ),
    };
  });

  // Workspaces, Starter Pack, Marketplaces and Diagnóstico are app-level
  // destinations, not scoped to any one workspace: at Início they are the
  // Explorer rail's items (the body is the workspaces list), and each opens
  // its page as a tab in whichever context is current.
  const homeRailItems: RailItem[] = NAV_AREAS.filter(isAreaTabDef).map((a) => ({
    testId: `explorer-area-${a.area}`,
    label: a.label,
    glyph: a.glyph,
    active: activeTabId === a.area,
    onClick: () => {
      if (explorerView === 'config') setExplorerView('files');
      openAreaTab(a.area);
    },
    ...(a.area === 'diagnostico' && healthReport && healthReport.worst !== 'ok'
      ? { severity: healthReport.worst === 'error' ? ('error' as const) : ('warning' as const) }
      : {}),
  }));

  const openTerminalIds = new Set(openTabs.flatMap((t) => (t.kind === 'terminal' ? [t.terminalId] : [])));
  const terminalsSection = activeWorkspace ? (
    <TerminalsSection
      openTerminalIds={openTerminalIds}
      onOpen={openTerminalTab}
      onRemoved={(terminalId) => closeTab(`terminal:${terminalId}`)}
      onEditLaunchJson={onEditLaunchJson}
      onError={(message) => setToast({ variant: 'error', message })}
      fill
    />
  ) : undefined;

  // Everything that becomes a Workbench tab. Shortcut hints only where a real accelerator exists.
  const newMenu: RowContextMenuAction[] = activeWorkspace
    ? [
        { key: 'session', label: 'Nova sessão', glyph: Plus, onSelect: handleNewSession, ...(shortcutFor('new-session') ? { shortcut: shortcutFor('new-session') as string } : {}) },
        { key: 'terminal', label: 'Novo terminal', glyph: SquareTerminal, onSelect: () => openTerminalIn('') },
        { key: 'browser', label: 'Novo navegador', glyph: Globe, onSelect: () => void openManualTab().catch(showError) },
      ]
    : [];

  const tabMenu = (canvasTab: WorkbenchTab): RowContextMenuAction[] => {
    if (canvasTab.id === OVERVIEW_TAB_ID) return [];
    const tab = orderedTabs.find((t) => t.id === canvasTab.id);
    if (!tab) return [];
    const index = orderedTabs.indexOf(tab);
    const fileTab = tab.kind === 'file' ? tab : undefined;
    return [
      { key: 'tab-close', label: 'Fechar', glyph: XGlyph, shortcut: '⌘W', onSelect: () => closeTab(tab.id) },
      { key: 'tab-close-others', label: 'Fechar outras', glyph: XGlyph, onSelect: () => closeMany(orderedTabs.filter((t) => t.id !== tab.id)) },
      { key: 'tab-close-right', label: 'Fechar à direita', glyph: XGlyph, onSelect: () => closeMany(orderedTabs.slice(index + 1)) },
      { key: 'tab-close-saved', label: 'Fechar salvas', glyph: XGlyph, onSelect: () => closeMany(orderedTabs.filter((t) => !isDirty(t))) },
      ...(fileTab
        ? [
            { key: 'tab-pin', label: fileTab.pinned === true ? 'Desafixar aba' : 'Fixar aba', glyph: fileTab.pinned === true ? PinOff : Pin, separatorBefore: true, onSelect: () => togglePin(tab.id) },
            {
              key: 'tab-copy-path',
              label: 'Copiar caminho',
              glyph: Copy,
              onSelect: () => {
                const write = (abs: string): Promise<void> => navigator.clipboard.writeText(abs);
                (fileTab.external === true
                  ? write(fileTab.relPath)
                  : callIpc<{ absolutePath: string }>('workspace.resolvePath', { path: fileTab.relPath }).then((r) => write(r.absolutePath))
                ).catch(showError);
              },
            },
            ...(fileTab.external === true
              ? []
              : [{ key: 'tab-reveal', label: 'Revelar no Explorer', glyph: FolderSearch, onSelect: () => showExplorerView('files') }]),
          ]
        : []),
      { key: 'tab-reopen', label: 'Reabrir aba fechada', glyph: HistoryGlyph, shortcut: '⇧⌘T', separatorBefore: true, onSelect: reopenClosedTab },
    ];
  };

  const dropOnEditor = ({ files, treePaths }: { files: File[]; treePaths: string[] }): void => {
    if (treePaths.length > 0) {
      for (const path of treePaths) openFileTab(path);
      return;
    }
    const paths = files.map((f) => window.api.getPathForFile(f)).filter((p) => p !== '');
    if (paths.length === 0) return;
    callIpc<string[]>('externalFile.grantDropped', { paths })
      .then((granted) => granted.forEach(openExternalFileTab))
      .catch(showError);
  };

  // Dropping a folder on the empty window (Início) opens it as a workspace.
  const dropOnHome = (e: React.DragEvent): void => {
    if (!isHome) return;
    const item = e.dataTransfer.items[0];
    const file = e.dataTransfer.files[0];
    if (!item?.webkitGetAsEntry()?.isDirectory || !file) return;
    e.preventDefault();
    void handleOpenAsWorkspace(window.api.getPathForFile(file));
  };

  const openEditorsSection = (
    <OpenEditorsSection tabs={canvasTabs} activeTabId={activeTabId} onSelect={setActiveTabId} onCloseAll={closeAllTabs} />
  );

  const hiddenLabel = showHidden ? 'Ocultar arquivos ocultos' : 'Mostrar arquivos ocultos';
  const explorerToolbarActions = (
    <>
      <Tooltip title={hiddenLabel}>
        <IconButton
          size="small"
          data-testid="workspace-toggle-hidden-files"
          aria-label={hiddenLabel}
          aria-pressed={showHidden}
          onClick={() => setShowHiddenFiles(!showHidden)}
        >
          <Icon glyph={showHidden ? Eye : EyeOff} size={14} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Reler do disco">
        <IconButton
          size="small"
          data-testid="workspace-refresh-files"
          aria-label="Reler do disco"
          onClick={() => void refreshFiles()}
        >
          <Icon glyph={RefreshCw} size={14} />
        </IconButton>
      </Tooltip>
    </>
  );

  // ── Desktop shell ──────────────────────────────────────────────────────
  // What the title bar and status bar show about the tab in front, and the
  // native-menu commands this screen owns (the rest live in AppShell).
  const dirtyBeforeRef = useRef(new Map<string, boolean>());
  const savedAtRef = useRef(new Map<string, number>());
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const activeLabel = canvasTabs.find((t) => t.id === activeTabId)?.label;
  const activeDirty = activeTab !== undefined && isDirty(activeTab);
  useEffect(() => {
    // A tab that was dirty and no longer is has just been saved.
    for (const tab of openTabs) {
      const nowDirty = isDirty(tab);
      if (dirtyBeforeRef.current.get(tab.id) === true && !nowDirty) savedAtRef.current.set(tab.id, Date.now());
      dirtyBeforeRef.current.set(tab.id, nowDirty);
    }
    publishShellStatus({
      workspaceName: activeWorkspace?.name ?? null,
      tab:
        activeTab === undefined || activeLabel === undefined
          ? null
          : {
              title: activeTab.kind === 'git-diff' ? `${activeTab.path} (diff)` : activeTab.kind === 'config' ? `Configurações · ${activeLabel}` : activeLabel,
              dirty: activeDirty,
              editable: isEditableTab(activeTab),
              savedAt: savedAtRef.current.get(activeTab.id) ?? null,
            },
    });
  }, [openTabs, activeTab, activeLabel, activeDirty, activeWorkspace]);
  useEffect(() => {
    publishShellStatus({ cursor: null });
  }, [activeTabId]);
  useEffect(
    () => () => publishShellStatus({ workspaceName: null, tab: null, cursor: null }),
    [],
  );

  useMenuCommand('save', () => void saveFnsRef.current.get(activeTabId)?.());
  useMenuCommand('save-all', () => {
    for (const tab of openTabs.filter(isDirty)) void saveFnsRef.current.get(tab.id)?.();
  });
  // ⌘W with no tab to close closes the window (main then asks about unsaved work).
  useMenuCommand('close-tab', () => {
    if (activeTabId === OVERVIEW_TAB_ID) window.close();
    else closeTab(activeTabId);
  });
  useMenuCommand('close-workspace', () => {
    if (!activeWorkspace) return;
    void resetTabs().then((ok) => (ok ? goHomeMutation.mutateAsync().catch(showError) : undefined));
  });
  useMenuCommand('find', openEditorFind);
  const showExplorerView = (view: ExplorerView): void => {
    if (!activeWorkspace) return;
    setExplorerView(view);
    if (explorerCollapsed) toggleExplorerPanel();
  };
  useMenuCommand('view-files', () => showExplorerView('files'));
  useMenuCommand('reopen-closed-tab', reopenClosedTab);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  useMenuCommand('search-project', () => {
    if (!activeWorkspace) return;
    showExplorerView('search');
    setSearchFocusSignal((n) => n + 1);
  });
  useMenuCommand('view-git', () => showExplorerView('git'));
  useMenuCommand('view-terminals', () => showExplorerView('terminals'));
  useMenuCommand('new-session', handleNewSession);
  useMenuCommand('go-needs-attention', () => {
    const waiting = (sessions ?? []).find((s) => s.status === 'running' && s.activity === 'needs-input');
    if (waiting) openSessionAnywhere(waiting);
  });
  useMenuCommand('end-session', () => {
    if (activeTab?.kind !== 'session') return;
    callIpc('session.kill', { sessionId: activeTab.sessionId })
      .then(() => queryClient.invalidateQueries({ queryKey: sessionsQueryKey }))
      .catch(showError);
  });

  return (
    <Box
      component="main"
      data-testid="workspace-screen"
      onDragOver={(e) => {
        if (isHome && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
      }}
      onDrop={dropOnHome}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      {/* Three cards on the canvas: the Explorer Panel leads on the left
          (file/entity tree, plus the workspace's own identity and actions —
          same convention as any file-tree-driven IDE), the Workbench in the
          middle, and the Control Panel trails as a collapsible card on the
          right (sessions + customizations). The side cards share the
          `SidePanel` shell; the 6px gaps between cards are the resize handles. */}
      <Box sx={{ flex: 1, minHeight: 420, overflow: 'hidden', display: 'flex', px: 0.75 }}>
        <Group orientation="horizontal" style={{ flex: 1, minWidth: 0 }}>
          <SidePanel
            panelId="workspace-files-panel"
            panelRef={explorerPanelRef}
            defaultSize="22"
            minSize="15"
            maxSize="36"
            collapsed={explorerCollapsed}
            onResize={(size) => setExplorerCollapsed(size.asPercentage === 0)}
            cardTestId="workspace-explorer-panel-label"
          >
            <ExplorerPanelContent
              dirtyFiles={dirtyFilePaths}
              activeWorkspace={activeWorkspace}
              isHome={isHome}
              gitPolling={!explorerCollapsed}
              toolbarActions={explorerToolbarActions}
              homeRailItems={homeRailItems}
              onOpenWorkspaces={() => openAreaTab('workspaces')}
              onSelectFile={(relPath) => openFileTab(relPath)}
              onRetarget={retargetTabs}
              onRemoved={markTabsRemoved}
              searchSection={
                <ProjectSearchPanel
                  focusSignal={searchFocusSignal}
                  onOpenMatch={(m) => openFileTab(m.path, { line: m.line, start: m.start, end: m.end })}
                />
              }
              onOpenAsWorkspace={(absolutePath) => void handleOpenAsWorkspace(absolutePath)}
              onPreviewFile={openFilePreviewTab}
              onNewAction={newActionForFile}
              openEditorsSection={openEditorsSection}
              {...(terminalsSection !== undefined ? { terminalsSection } : {})}
              browserSection={<BrowserSection activeWorkbenchTabId={activeTabId} onError={(message) => setToast({ variant: 'error', message })} />}
              onOpenTerminalHere={openTerminalIn}
              onOpenGitDiff={openGitDiffTab}
              view={explorerView}
              onViewChange={setExplorerView}
              activeConfigPage={activeConfigPage}
              onOpenConfigPage={openConfigPage}
              onCollapse={toggleExplorerPanel}
            />
          </SidePanel>
          <ResizeHandle />
          <Panel id="workbench-canvas-panel" minSize="30" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Box sx={panelCardSx()}>
              <WorkbenchCanvas tabs={[overviewTab, ...canvasTabs]} activeTabId={activeTabId} onSelect={setActiveTabId} onReorder={reorderTabs} tabMenu={tabMenu} newMenu={newMenu} onDropFiles={dropOnEditor} />
            </Box>
          </Panel>
          <ResizeHandle />
          <SidePanel
            panelId="workspace-customizations-aside"
            panelRef={controlPanelRef}
            defaultSize={260}
            minSize={200}
            maxSize={420}
            collapsed={controlPanelCollapsed}
            onResize={(size) => setControlPanelCollapsed(size.asPercentage === 0)}
            cardTestId="workspace-control-panel-label"
          >
            <ControlPanelContent
              isHome={isHome}
              {...(activeWorkspace
                ? {
                    seedWorkspaceInstruction: () => seedWorkspaceInstruction(activeWorkspace),
                    seedFolderInstruction: (folder: string, takenNames: ReadonlySet<string>) =>
                      seedFolderInstruction(activeWorkspace, folder, takenNames),
                  }
                : {})}
              {...(entityLocalScope ? { localScope: entityLocalScope } : {})}
              {...(mcpMatchPath ? { mcpMatchPath } : {})}
              onEditEntity={openEntityTab}
              onPreviewEntity={previewEntity}
              onEntityProperties={requestEntityProperties}
              onNewActionForEntity={newActionForEntity}
              onOpenInstruction={openInstructionEditor}
              onInstructionProperties={requestInstructionProperties}
              onNewActionForInstruction={newActionForInstruction}
              onOpenInherited={openInheritedTab}
              sessionsScope={sessionsScope}
              onOpenSession={openSessionAnywhere}
              onSessionRemoved={removeSessionTab}
              onSeeAllSessions={openHistoryTab}
              canStartSession={activeWorkspace !== undefined}
              onNewSession={handleNewSession}
            />
          </SidePanel>
        </Group>
      </Box>

      <NewSessionDialog
        open={newSessionOpen}
        folders={activeWorkspace && folderRouting.multi ? folderRouting.folders : []}
        aliases={folderRouting.aliases}
        harnesses={runHarnesses.options}
        onCancel={() => setNewSessionOpen(false)}
        onStart={(folders, harness) => {
          setNewSessionOpen(false);
          spawnSession(
            activeWorkspace && folderRouting.multi ? { kind: 'workspace', workspaceId: activeWorkspace.id, folders } : currentAnchor,
            harness,
          );
        }}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
