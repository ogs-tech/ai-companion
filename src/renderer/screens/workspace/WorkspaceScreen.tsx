import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import {
  Eye,
  File as FileIcon,
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
import { ExplorerPanelContent } from '../../components/workspace/ExplorerPanelContent.js';
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
import { TreeRow } from '../../components/ds/TreeRow.js';
import { WorkspacesScreen } from '../workspaces/WorkspacesScreen.js';
import { StarterPackScreen } from '../starter-pack/StarterPackScreen.js';
import { MarketplaceList } from '../marketplaces/MarketplaceList.js';
import { HealthScreen } from '../health/HealthScreen.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { registerUnsavedTabsGuard } from '../../lib/workspace-tabs-guard.js';
import {
  pushWorkspaceHistoryEntry,
  registerWorkspaceHistoryApplier,
  type ApplyWorkspaceHistoryResult,
  type WorkspaceHistoryEntry,
} from '../../lib/workspace-history-store.js';
import { registerAreaOpener, type WorkspaceAreaTab } from '../../lib/workspace-area-store.js';
import { publishWorkspacePanels, registerWorkspaceShellCommands } from '../../lib/workspace-shell-store.js';
import {
  closeBrowserTab,
  getBrowserTabsSnapshot,
  reconcileBrowserTabs,
  registerBrowserWorkbenchOpener,
  subscribeBrowserTabs,
} from '../../lib/browser-tabs-store.js';
import { seedWorkspaceInstruction } from '../../lib/instruction-seed.js';
import { entityBody } from '../../lib/entity-body.js';
import { useActiveWorkspace, useGoHome, useOpenWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import { useSessions, sessionsQueryKey } from '../../hooks/use-sessions.js';
import { useCreateTerminal, useTerminals } from '../../hooks/use-terminals.js';
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
import type { SessionAnchor, SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';
import type { TerminalSnapshot } from '../../../shared/terminal.js';
import { callIpc } from '../../lib/ipc.js';
import type { OpenEditorsState } from '../../../shared/open-editors.js';
import { OpenEditorsSection } from '../../components/workspace/OpenEditorsSection.js';
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

function entityTabGlyph(tab: Extract<OpenTab, { kind: EntityKind | 'instruction' }>): LucideIcon {
  if (tab.kind === 'instruction') return isPersonalInstruction(tab.entity) ? Globe : NotebookPen;
  return ENTITY_GROUP_ICONS[tab.kind];
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
  // Both side panels now share one collapse mechanism (resizable, collapses
  // to 0px) via SidePanel — the Control Panel used to be a fixed-width aside
  // with its own 40px icon-strip collapse mode; that's retired.
  const controlPanelRef = usePanelRef();
  const [controlPanelCollapsed, setControlPanelCollapsed] = useState(false);

  const refreshFiles = useRefreshFiles();
  const showHidden = useShowHiddenFiles();

  const openFileTab = (relPath: string): void => {
    const id = `file:${relPath}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'file', relPath }]));
    setActiveTabId(id);
  };

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
    if (!resetTabs()) return;
    goHomeMutation
      .mutateAsync()
      .then(() => {
        if (kind === 'instruction') openInstructionTab(entity as Instruction, false);
        else openEntityTab(kind, entity as Skill | Agent, false);
      })
      .catch(showError);
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

  // Closing the tab only hides the view — the terminal itself lives in the main process until stopped and removed.
  const openTerminalTab = (terminal: Pick<TerminalSnapshot, 'terminalId'>): void => {
    const id = `terminal:${terminal.terminalId}`;
    setOpenTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'terminal', terminalId: terminal.terminalId }]));
    setActiveTabId(id);
  };

  const onEditLaunchJson = (): void => openFileTab('.vscode/launch.json');

  const openTerminalIn = (relCwd: string): void =>
    createTerminal.mutate({ ...(relCwd !== '' ? { relCwd } : {}) }, { onSuccess: openTerminalTab, onError: showError });

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
    return () => registerAreaOpener(null);
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

  // Closes every tab at once, behind the same discard guard as closing one.
  const closeAllTabs = (): void => {
    const dirtyCount = openTabs.filter(isDirty).length;
    if (dirtyCount > 0 && !window.confirm(`${dirtyCount} aba(s) com alterações não salvas. Descartar tudo?`)) return;
    for (const tab of openTabs) if (tab.kind === 'browser') void closeBrowserTab(tab.tabId);
    setOpenTabs([]);
    setActiveTabId(OVERVIEW_TAB_ID);
  };

  const closeTab = (id: string): void => {
    const target = openTabs.find((t) => t.id === id);
    if (target && isDirty(target) && !window.confirm('Descartar alterações não salvas?')) return;
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur === id ? (next[next.length - 1]?.id ?? OVERVIEW_TAB_ID) : cur));
      return next;
    });
  };

  // Returns whether the reset actually happened — false means the caller
  // asked to discard unsaved tabs and the user declined, so the caller's own
  // state change (switching workspace) must not proceed either.
  const resetTabs = (): boolean => {
    const dirtyCount = openTabs.filter(isDirty).length;
    if (dirtyCount > 0 && !window.confirm(`${dirtyCount} aba(s) com alterações não salvas. Descartar tudo?`)) return false;
    // Leaving the workspace ends its terminals (main does it on activation); exited ones don't count.
    const runningCount = (terminals ?? []).filter((t) => t.status === 'running').length;
    if (runningCount > 0 && !window.confirm(`${runningCount} terminal(is) em execução serão encerrados ao trocar. Encerrar e trocar?`)) return false;
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
    return () => registerUnsavedTabsGuard(null);
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
      if (!resetTabs()) return 'declined';
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
    startNewActionSession({ kind: 'workspace', workspaceId: activeWorkspace.id }, relPath);
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
  // The right panel's Sessões lists the scope's own: Global's at Início.
  const sessionsScope: HistoryScope = activeWorkspace
    ? { kind: 'workspace', workspaceId: activeWorkspace.id }
    : { kind: 'personal' };

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

  // The "+" in the Sessões panel header: always a fresh session (coexisting
  // with any already open for the same anchor) wherever the user currently is.
  const handleNewSession = (): void => {
    void (async () => {
      try {
        const session = await callIpc<SessionSnapshotWithOutput>('session.spawn', { anchor: currentAnchor });
        openSessionTab(session);
        void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
      }
    })();
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
    if (!resetTabs()) return;
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

  // "Ver alterações": expands the Explorer if it is collapsed — its tree carries the git state.
  const showGitView = (): void => {
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
          onError={(message) => setToast({ variant: 'error', message })}
        />
      ),
  };

  const canvasTabs: WorkbenchTab[] = openTabs.map((tab): WorkbenchTab => {
    if (tab.kind === 'file') {
      return {
        id: tab.id,
        glyph: FileIcon,
        label: tab.relPath.split('/').pop() || tab.relPath,
        breadcrumb: tab.relPath,
        dense: true,
        dirty: tab.dirty ?? false,
        onClose: () => closeTab(tab.id),
        render: (hidden) => (
          <EditorPanel
            subject="file"
            path={tab.relPath}
            active={!hidden}
            onDirtyChange={(dirty) => setTabDirty(tab.id, dirty)}
          />
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
      return {
        id: tab.id,
        glyph: SquareTerminal,
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
          openPropertiesRequest={tab.id === propertiesRequestTabId}
          onPropertiesRequestHandled={() => setPropertiesRequestTabId(null)}
          {...(tab.inherited ? { inherited: { onEditAtHome: () => editAtHome(tab.entity, tab.kind) } } : {})}
        />
      ),
    };
  });

  // Starter Pack/Marketplaces/Diagnóstico are app-level destinations, not
  // scoped to any one workspace — their entry rows sit below the divider in
  // Início's menu (see HomeNavList); the tabs open in whichever context is
  // current. Workspaces is the menu's own row, so it is left out here.
  const appAreaRows = (
    <>
      {NAV_AREAS.filter(isAreaTabDef)
        .filter((a) => a.area !== 'workspaces')
        .map((a) => {
          const active = activeTabId === a.area;
          const showSeverity =
            a.area === 'diagnostico' && healthReport && healthReport.worst !== 'ok';
          return (
            <TreeRow
              key={a.area}
              testId={`explorer-area-${a.area}`}
              pl={1.5}
              glyph={a.glyph}
              primary={a.label}
              onClick={() => openAreaTab(a.area)}
              {...(active ? { accentColor: 'info.main' } : {})}
              badge={
                showSeverity && healthReport ? (
                  <Box
                    data-testid="explorer-area-diagnostico-severity"
                    sx={(theme) => ({
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor:
                        healthReport.worst === 'error'
                          ? theme.palette.error.main
                          : theme.palette.warning.main,
                    })}
                  />
                ) : undefined
              }
            />
          );
        })}
    </>
  );

  const openTerminalIds = new Set(openTabs.flatMap((t) => (t.kind === 'terminal' ? [t.terminalId] : [])));
  const terminalsSection = activeWorkspace ? (
    <TerminalsSection
      openTerminalIds={openTerminalIds}
      onOpen={openTerminalTab}
      onRemoved={(terminalId) => closeTab(`terminal:${terminalId}`)}
      onEditLaunchJson={onEditLaunchJson}
      onError={(message) => setToast({ variant: 'error', message })}
    />
  ) : undefined;

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

  return (
    <Box component="main" data-testid="workspace-screen" sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
              activeWorkspace={activeWorkspace}
              isHome={isHome}
              gitPolling={!explorerCollapsed}
              toolbarActions={explorerToolbarActions}
              appAreaRows={appAreaRows}
              homeNav={{
                workspacesActive: activeTabId === 'workspaces',
                onOpenWorkspaces: () => openAreaTab('workspaces'),
              }}
              onSelectFile={openFileTab}
              onOpenAsWorkspace={(absolutePath) => void handleOpenAsWorkspace(absolutePath)}
              onPreviewFile={openFilePreviewTab}
              onNewAction={newActionForFile}
              openEditorsSection={openEditorsSection}
              {...(terminalsSection !== undefined ? { terminalsSection } : {})}
              onOpenTerminalHere={openTerminalIn}
              onOpenGitDiff={openGitDiffTab}
            />
          </SidePanel>
          <ResizeHandle />
          <Panel id="workbench-canvas-panel" minSize="30" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Box sx={panelCardSx()}>
              <WorkbenchCanvas tabs={[overviewTab, ...canvasTabs]} activeTabId={activeTabId} onSelect={setActiveTabId} />
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
                ? { seedWorkspaceInstruction: () => seedWorkspaceInstruction(activeWorkspace) }
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
              onOpenSession={openSessionTab}
              onSessionRemoved={removeSessionTab}
              onSeeAllSessions={openHistoryTab}
              canStartSession={activeWorkspace !== undefined}
              onNewSession={handleNewSession}
            />
          </SidePanel>
        </Group>
      </Box>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
