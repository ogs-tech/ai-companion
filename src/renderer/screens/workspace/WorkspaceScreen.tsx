import { useEffect, useRef, useState } from 'react';
import {
  Box, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Group, Panel, usePanelRef } from 'react-resizable-panels';
import {
  Eye, EyeOff, File as FileIcon, FileX, Globe, MoreVertical, NotebookPen,
  History, PanelLeft, PanelRight, RefreshCw, SquareTerminal, Trash2, type LucideIcon,
} from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { EmptyState } from '../../components/ds/EmptyState.js';
import { ResizeHandle } from '../../components/ds/ResizeHandle.js';
import { SidePanel } from '../../components/ds/SidePanel.js';
import { ExplorerPanelContent } from '../../components/workspace/ExplorerPanelContent.js';
import { ControlPanelContent } from '../../components/workspace/ControlPanelContent.js';
import { InstructionTreeRow, ProjectInstructionRow } from '../../components/workspace/InstructionTreeRow.js';
import { SessionHistoryTab } from '../history/SessionHistoryTab.js';
import type { HistoryScope } from '../../../shared/session-history.js';
import { WorkbenchCanvas, type WorkbenchTab } from '../../components/workspace/WorkbenchCanvas.js';
import { EditorPanel, type EditorHiddenField, type PreviewSource } from '../../components/workspace/EditorPanel.js';
import { SessionPanel } from '../../components/SessionPanel.js';
import { WorkspaceRemoveConfirmDialog } from '../../components/shell/WorkspaceRemoveConfirmDialog.js';
import { ENTITY_GROUP_ICONS, ENTITY_ACCENT_COLOR } from '../../components/shell/nav.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { blankCustomization } from '../../lib/blank-customization.js';
import { registerUnsavedTabsGuard } from '../../lib/workspace-tabs-guard.js';
import {
  pushWorkspaceHistoryEntry,
  registerWorkspaceHistoryApplier,
  type ApplyWorkspaceHistoryResult,
  type WorkspaceHistoryEntry,
} from '../../lib/workspace-history-store.js';
import { seedWorkspaceInstruction } from '../../lib/instruction-seed.js';
import { entityBody } from '../../lib/entity-body.js';
import { useActiveWorkspace, useDeleteWorkspace, useSwitchWorkspace } from '../../hooks/use-workspaces.js';
import { useDeleteProject, useFindOrCreateProjectByPath, useProjects } from '../../hooks/use-projects.js';
import { useInvalidateCustomization } from '../../hooks/use-customization-list.js';
import { useSessions, sessionsQueryKey } from '../../hooks/use-sessions.js';
import { useEntityChangeInvalidation } from '../../hooks/use-entity-change-invalidation.js';
import { useRefreshFiles } from '../../hooks/use-file-browser.js';
import {
  useInvalidateInstructions,
  usePersonalInstruction,
  useWorkspaceInstruction,
} from '../../hooks/use-instructions.js';
import { isPersonalInstruction } from '../../../shared/entity.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import type { Workspace } from '../../../shared/workspace.js';
import type { Project } from '../../../shared/project.js';
import type { SessionAnchor, SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';
import { callIpc } from '../../lib/ipc.js';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const PERSONAL_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['name', 'scope', 'description', 'version']);
const SCOPED_HIDDEN: ReadonlySet<EditorHiddenField> = new Set(['scope']);

type EntityKind = 'skill' | 'agent';

type OpenTab =
  | { id: string; kind: 'file'; relPath: string; projectId?: string; dirty?: boolean }
  | { id: string; kind: EntityKind; entity: Skill | Agent; isCreate: boolean; dirty?: boolean }
  | { id: string; kind: 'instruction'; entity: Instruction; isCreate: boolean; dirty?: boolean }
  | { id: string; kind: 'session'; anchor: SessionAnchor; sessionId: string; label: string }
  | { id: string; kind: 'preview'; label: string; source: PreviewSource }
  | { id: string; kind: 'history' };

/** Tabs that can hold unsaved work, and so need a discard guard before closing. */
function isDirty(tab: OpenTab): boolean {
  return (tab.kind === 'file' || tab.kind === 'skill' || tab.kind === 'agent' || tab.kind === 'instruction') && tab.dirty === true;
}

function entityTabGlyph(tab: Extract<OpenTab, { kind: EntityKind | 'instruction' }>): LucideIcon {
  if (tab.kind === 'instruction') return isPersonalInstruction(tab.entity) ? Globe : NotebookPen;
  return ENTITY_GROUP_ICONS[tab.kind];
}

export function WorkspaceScreen(): React.ReactElement {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: projects = [] } = useProjects();
  const { data: personalInstruction } = usePersonalInstruction();
  const findOrCreateProject = useFindOrCreateProjectByPath();
  const deleteProject = useDeleteProject();
  const switchWorkspace = useSwitchWorkspace();
  const deleteWorkspace = useDeleteWorkspace();
  const invalidateCustomization = useInvalidateCustomization();
  const invalidateInstructions = useInvalidateInstructions();
  const { data: sessions } = useSessions();
  const queryClient = useQueryClient();
  useEntityChangeInvalidation();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Hidden by default inside a project workspace, to keep the tree focused on
  // what's actually local to it — plugin-provided and Personal-scope entities
  // are already visible everywhere else, so they're the ones worth hiding.
  const [showGlobal, setShowGlobal] = useState(false);
  // Captured when the dialog opens, not read live off `activeWorkspace` — see SubRail's old WorkspaceContext, which this replaces.
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null);

  // Every open file, session, AND entity being edited is a Workbench canvas
  // tab — these used to live in separate models (a file-tab array, a modal
  // slot, and a whole separate AppShell-level sessions dock); unifying them
  // is what makes the editor read as one VS Code-like surface. A session tab
  // only exists while the Workspace screen itself is mounted (navigating to
  // another Area unmounts it, same as any other open tab here) — the
  // `claude` process it's attached to keeps running server-side regardless,
  // and SessionPanel reattaches to it on remount via `session.status`.
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
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
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const { data: workspaceInstruction } = useWorkspaceInstruction(activeWorkspace?.id ?? '');

  const refreshFiles = useRefreshFiles();

  // `projectId` is the file's own scope, as resolved by FolderTree — a
  // root-level Project folder can be *browsed* expanded-in-place, from the
  // unscoped workspace view, purely to look around, without changing scope.
  // But *opening* something scoped to it — one of its files, or its own
  // INSTRUCTIONS row (see `renderProjectInstructionRow` below) — does:
  // `selectedProjectId`, and with it the whole Control Panel (Skills/Agents/
  // Hooks/MCP/Plugins), always follows whichever file is the active Workbench
  // tab, derived here and in `handleSelectTab`/`closeTab` below, rather than
  // through a dedicated "enter project" gesture. No confirmation needed:
  // unlike a real workspace switch, this never discards a tab, it just
  // changes which scope's customizations the Control Panel is currently
  // showing.
  const syncProjectFromTab = (tab: OpenTab | undefined): void => {
    if (tab?.kind === 'file') setSelectedProjectId(tab.projectId ?? null);
  };

  const openFileTab = (relPath: string, projectId?: string): void => {
    const id = `file:${projectId ?? ''}:${relPath}`;
    setOpenTabs((prev) =>
      prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'file', relPath, ...(projectId ? { projectId } : {}) }],
    );
    setActiveTabId(id);
    setSelectedProjectId(projectId ?? null);
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

  // Tab identity is keyed by the concrete sessionId (not the anchor), so a
  // workspace/project anchor with several coexisting sessions gets one tab
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

  // A rendered, read-only view of a file's Markdown — reached via the tree's
  // right-click "Preview" menu, never via the normal click-to-open path.
  // Kept as its own tab (rather than a mode toggle inside the file's own
  // editing tab) so opening it never disturbs an already-open, in-progress
  // edit of the same file.
  const openFilePreviewTab = (relPath: string, projectId?: string): void => {
    const id = `preview:file:${projectId ?? ''}:${relPath}`;
    setOpenTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              kind: 'preview',
              label: relPath.split('/').pop() || relPath,
              source: { kind: 'file', path: relPath, ...(projectId ? { projectId } : {}) },
            },
          ],
    );
    setActiveTabId(id);
    setSelectedProjectId(projectId ?? null);
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

  // The only thing an EditorPanel reports upward about its own edits — never
  // its draft content, never CodeMirror/Entity internals — so a tab's dirty
  // dot and the discard guards below stay simple boolean bookkeeping. Preview
  // tabs are read-only and never report dirty, same as session tabs.
  const setTabDirty = (id: string, dirty: boolean): void =>
    setOpenTabs((prev) => prev.map((t) => (t.id === id && t.kind !== 'session' && t.kind !== 'preview' ? { ...t, dirty } : t)));

  const closeTab = (id: string): void => {
    const target = openTabs.find((t) => t.id === id);
    if (target && isDirty(target) && !window.confirm('Descartar alterações não salvas?')) return;
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) syncProjectFromTab(next[next.length - 1]);
      setActiveTabId((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur));
      return next;
    });
  };

  // The Workbench canvas' own tab strip selects among already-open tabs —
  // routed through here (instead of the bare `setActiveTabId` setter) so
  // switching back to an already-open file tab re-syncs the Control Panel's
  // scope too, the same as opening one fresh.
  const handleSelectTab = (id: string): void => {
    setActiveTabId(id);
    syncProjectFromTab(openTabs.find((t) => t.id === id));
  };

  // Returns whether the reset actually happened — false means the caller
  // asked to discard unsaved tabs and the user declined, so the caller's own
  // state change (switching workspace) must not proceed either.
  const resetTabs = (): boolean => {
    const dirtyCount = openTabs.filter(isDirty).length;
    if (dirtyCount > 0 && !window.confirm(`${dirtyCount} aba(s) com alterações não salvas. Descartar tudo?`)) return false;
    setOpenTabs([]);
    setActiveTabId(null);
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

  // Records the current scope + active tab as a Workbench "location" every
  // time either changes, so TopNav's back/forward buttons have somewhere to
  // navigate to — see workspace-history-store.ts for the full picture.
  useEffect(() => {
    if (!activeWorkspace) return;
    pushWorkspaceHistoryEntry({ workspaceId: activeWorkspace.id, projectId: selectedProjectId, activeTabId });
  }, [activeWorkspace, selectedProjectId, activeTabId]);

  // Applies one history entry. A real workspace change still reuses
  // `resetTabs()` (same confirm-then-wipe every workspace switch already
  // needs — a different workspace's tabs and entities don't exist here).
  // A project-only change — same workspace, `projectId` differs — is no
  // longer a "scope transition" at all: `selectedProjectId` is just a view
  // of whichever tab is active, so it's resynced alongside `activeTabId`
  // with no discard prompt, same as any other same-workspace navigation.
  // Reporting 'stale' for a since-closed tab instead lets the store prune
  // it and keep walking back/forward.
  const applyWorkspaceHistoryEntry = async (entry: WorkspaceHistoryEntry): Promise<ApplyWorkspaceHistoryResult> => {
    const workspaceChanged = entry.workspaceId !== activeWorkspace?.id;
    if (workspaceChanged) {
      if (!resetTabs()) return 'declined';
      try {
        await switchWorkspace.mutateAsync(entry.workspaceId);
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
        return 'declined';
      }
      setSelectedProjectId(entry.projectId);
      return 'applied';
    }
    if (entry.activeTabId !== null && !openTabs.some((t) => t.id === entry.activeTabId)) return 'stale';
    setActiveTabId(entry.activeTabId);
    if (entry.projectId !== selectedProjectId) setSelectedProjectId(entry.projectId);
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

  // The item's own project/workspace scope, never its `entity` urn — an
  // `entity` anchor would reuse an already-running session for that item
  // instead of the fresh one "New Action" always wants. `personal`-scoped
  // entities (no project/workspace of their own) fall back to the active
  // workspace, whose cwd is where their canonical source actually lives.
  const anchorForEntityScope = (entity: Pick<Skill | Agent | Instruction, 'scopes' | 'scopeId'>): SessionAnchor | null => {
    const scope = entity.scopes[0];
    if (scope === 'project' && entity.scopeId) return { kind: 'project', projectId: entity.scopeId };
    if (scope === 'workspace' && entity.scopeId) return { kind: 'workspace', workspaceId: entity.scopeId };
    return activeWorkspace ? { kind: 'workspace', workspaceId: activeWorkspace.id } : null;
  };

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

  const newActionFromResolvedPath = (anchor: SessionAnchor | null, resolvePath: () => Promise<string>): void => {
    if (!anchor) return;
    void (async () => {
      try {
        startNewActionSession(anchor, await resolvePath());
      } catch (err) {
        setToast({ variant: 'error', message: errorMessage(err) });
      }
    })();
  };

  // Files/folders already sit inside the target project's own tree, so their
  // relPath already matches a project-anchored session's cwd — no path
  // resolution IPC round trip needed, unlike entities (see below).
  const newActionForFile = (relPath: string, projectId?: string): void => {
    const anchor: SessionAnchor | null = projectId
      ? { kind: 'project', projectId }
      : activeWorkspace
        ? { kind: 'workspace', workspaceId: activeWorkspace.id }
        : null;
    if (!anchor) return;
    startNewActionSession(anchor, relPath);
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

  // Pinned at the top of the Explorer Panel's FolderTree (not the Control
  // Panel) — always the active workspace's own INSTRUCTIONS row, regardless
  // of which Project (if any) the Control Panel is currently scoped to. It
  // never swaps to a Project's own instruction, so it stays a reliable
  // "back to the workspace" anchor — opening it also drops any Project
  // scope, the same way opening a Project's own INSTRUCTIONS row (nested
  // under its folder, see `renderProjectInstructionRow` below) enters one.
  const instructionRow = !activeWorkspace ? undefined : (
    <InstructionTreeRow
      kind="workspace"
      instruction={workspaceInstruction}
      seed={() => seedWorkspaceInstruction(activeWorkspace)}
      onOpen={(entity, isCreate) => {
        setSelectedProjectId(null);
        openInstructionEditor(entity, isCreate);
      }}
      onPreview={previewEntity}
      onProperties={requestInstructionProperties}
      onNewAction={newActionForInstruction}
    />
  );

  // Skills/Agents are scoped to whichever node is currently in view (a
  // selected Project, or the active workspace itself); Hooks have no
  // project/workspace tier of their own yet, and MCP's own local tier
  // ('project-local'/'project-shared') keys off a filesystem path instead.
  const entityLocalScope = selectedProject
    ? { scope: 'project' as const, scopeId: selectedProject.id }
    : activeWorkspace
      ? { scope: 'workspace' as const, scopeId: activeWorkspace.id }
      : undefined;
  const mcpMatchPath = selectedProject ? selectedProject.path : activeWorkspace?.rootPath;

  const removeSessionTab = (sessionId: string): void => closeTab(`session:${sessionId}`);

  // Anchors a new session to whatever's currently in view (a selected
  // Project, or the active workspace itself) — the "+" in the Sessões panel
  // header is the only entry point for starting one now, so it always
  // targets the current scope rather than asking which anchor to use.
  // Always spawns a fresh session (coexisting with any already open for the
  // same anchor) rather than refocusing one, since `session.spawn` mints a
  // new sessionId on every call for a workspace/project anchor.
  // What the Sessões panel and the Histórico tab both mean by "here": the
  // project in view, or the workspace itself when no project is selected.
  const historyScope: HistoryScope | null = selectedProject
    ? { kind: 'project', projectId: selectedProject.id }
    : activeWorkspace
      ? { kind: 'workspace', workspaceId: activeWorkspace.id }
      : null;

  // One fixed id, so "Ver todas" focuses the tab that is already open rather
  // than stacking a second copy of the same dashboard beside it.
  const HISTORY_TAB_ID = 'history';
  const openHistoryTab = (): void => {
    setOpenTabs((prev) => (prev.some((t) => t.id === HISTORY_TAB_ID) ? prev : [...prev, { id: HISTORY_TAB_ID, kind: 'history' }]));
    setActiveTabId(HISTORY_TAB_ID);
  };

  const handleNewSession = (): void => {
    const anchor: SessionAnchor | null = selectedProject
      ? { kind: 'project', projectId: selectedProject.id }
      : activeWorkspace
        ? { kind: 'workspace', workspaceId: activeWorkspace.id }
        : null;
    if (!anchor) return;
    void (async () => {
      try {
        const session = await callIpc<SessionSnapshotWithOutput>('session.spawn', { anchor });
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

  // Manual override for the derived scope above — lets the breadcrumb (and a
  // successful project delete) pin the Control Panel back to workspace scope
  // even while a project's file tab is still open. No `resetTabs()` guard:
  // nothing is discarded, it's just a view switch.
  const exitProjectScope = (): void => setSelectedProjectId(null);

  const handleDeleteProject = async (id: string): Promise<void> => {
    try {
      await deleteProject.mutateAsync(id);
      exitProjectScope();
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleUseAsProject = async (absolutePath: string): Promise<void> => {
    try {
      const project = await findOrCreateProject.mutateAsync(absolutePath);
      // Immediately shows the new Project's (empty) Skills/Agents/etc, so
      // "+" is reachable without needing to open a file from it first.
      setSelectedProjectId(project.id);
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const handleRemoveWorkspace = async (): Promise<void> => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (!target) return;
    if (!resetTabs()) return;
    try {
      await switchWorkspace.mutateAsync('default');
      await deleteWorkspace.mutateAsync(target.id);
      setToast({ variant: 'success', message: `${target.name} removido` });
    } catch (err) {
      setToast({ variant: 'error', message: errorMessage(err) });
    }
  };

  const closeHeaderMenu = (): void => setMenuAnchor(null);
  const showGlobalToggle = activeWorkspace !== undefined && !activeWorkspace.isDefault;
  const isDefaultWorkspace = activeWorkspace?.isDefault ?? false;
  const showRemoveAction = selectedProject !== null || (showGlobalToggle && activeWorkspace !== undefined);

  // Lives at the top of the Explorer Panel now (see `ExplorerPanelContent`),
  // anchored to the same breadcrumb row it always shared — these actions
  // (global-entity visibility, panel toggles, destructive remove) apply to
  // the whole screen, not just the tree, but the breadcrumb is still the
  // most natural place to reach them from.
  const headerMenu = (
    <>
      <Tooltip title="Mais ações">
        <IconButton
          data-testid="workspace-header-menu-button"
          aria-label="Mais ações"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          <Icon glyph={MoreVertical} size={18} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={closeHeaderMenu} data-testid="workspace-header-menu">
        {showGlobalToggle && (
          <MenuItem data-testid="workspace-toggle-global" onClick={() => { setShowGlobal((v) => !v); closeHeaderMenu(); }}>
            <ListItemIcon><Icon glyph={showGlobal ? EyeOff : Eye} size={16} /></ListItemIcon>
            <ListItemText>{showGlobal ? 'Ocultar entidades globais' : 'Mostrar entidades globais'}</ListItemText>
          </MenuItem>
        )}
        <MenuItem data-testid="workspace-toggle-files" onClick={() => { toggleExplorerPanel(); closeHeaderMenu(); }}>
          <ListItemIcon><Icon glyph={PanelLeft} size={16} /></ListItemIcon>
          <ListItemText>{explorerCollapsed ? 'Mostrar arquivos' : 'Ocultar arquivos'}</ListItemText>
        </MenuItem>
        <MenuItem data-testid="workspace-toggle-customizations" onClick={() => { toggleControlPanel(); closeHeaderMenu(); }}>
          <ListItemIcon><Icon glyph={PanelRight} size={16} /></ListItemIcon>
          <ListItemText>{controlPanelCollapsed ? 'Mostrar Customizations' : 'Ocultar Customizations'}</ListItemText>
        </MenuItem>
        {showRemoveAction && <Divider />}
        {selectedProject ? (
          <MenuItem
            data-testid={`project-delete-${selectedProject.id}`}
            onClick={() => { closeHeaderMenu(); void handleDeleteProject(selectedProject.id); }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}><Icon glyph={Trash2} size={16} /></ListItemIcon>
            <ListItemText>Remover projeto</ListItemText>
          </MenuItem>
        ) : (
          showGlobalToggle &&
          activeWorkspace && (
            <MenuItem
              data-testid="workspace-context-remove"
              onClick={() => { closeHeaderMenu(); setPendingRemoval(activeWorkspace); }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}><Icon glyph={Trash2} size={16} /></ListItemIcon>
              <ListItemText>Remover workspace</ListItemText>
            </MenuItem>
          )
        )}
      </Menu>
    </>
  );

  const canvasTabs: WorkbenchTab[] = openTabs.map((tab): WorkbenchTab => {
    if (tab.kind === 'file') {
      return {
        id: tab.id,
        glyph: FileIcon,
        label: tab.relPath.split('/').pop() || tab.relPath,
        dense: true,
        dirty: tab.dirty ?? false,
        onClose: () => closeTab(tab.id),
        render: (hidden) => (
          <EditorPanel
            subject="file"
            path={tab.relPath}
            active={!hidden}
            {...(tab.projectId ? { projectId: tab.projectId } : {})}
            onDirtyChange={(dirty) => setTabDirty(tab.id, dirty)}
          />
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
    const isPersonal = tab.kind === 'instruction' && isPersonalInstruction(tab.entity);
    return {
      id: tab.id,
      glyph: entityTabGlyph(tab),
      label: tab.entity.name || (tab.isCreate ? 'Novo' : tab.entity.name),
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
        />
      ),
    };
  });

  const emptyCanvasState = (
    <EmptyState
      glyph={FileX}
      title="Nenhuma aba aberta"
      description="Escolha um arquivo, skill, agent ou instruction nos painéis ao lado para abrir aqui."
      testId="workbench-empty"
    />
  );

  const personalInstructionRow = (
    <InstructionTreeRow
      kind="personal"
      instruction={personalInstruction}
      seed={() => blankCustomization('instruction') as Instruction}
      onOpen={openInstructionEditor}
      onPreview={previewEntity}
      onNewAction={newActionForInstruction}
    />
  );

  const renderProjectInstructionRow = (project: Project, depth: number): React.ReactNode => (
    <ProjectInstructionRow
      project={project}
      onPreview={previewEntity}
      onOpen={(entity, isCreate) => {
        // Opening a Project's own INSTRUCTIONS row — even browsed in place,
        // before "entering" it — scopes the Control Panel/breadcrumb to that
        // Project too, same as opening one of its files does (see
        // `syncProjectFromTab`).
        setSelectedProjectId(project.id);
        openInstructionEditor(entity, isCreate);
      }}
      onProperties={(entity) => {
        setSelectedProjectId(project.id);
        requestInstructionProperties(entity);
      }}
      onNewAction={(entity) => {
        setSelectedProjectId(project.id);
        newActionForInstruction(entity);
      }}
      testId={`tree-node-instructions-${project.name}`}
      depth={depth}
    />
  );

  const explorerHeaderActions = (
    <Tooltip title="Reler do disco">
      <IconButton size="small" data-testid="workspace-refresh-files" aria-label="Reler do disco" onClick={() => void refreshFiles()}>
        <Icon glyph={RefreshCw} size={14} />
      </IconButton>
    </Tooltip>
  );

  return (
    <Box component="main" data-testid="workspace-screen" sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Panels run edge-to-edge with the window, not boxed in a bordered,
          margined card — a workbench reads as part of the app shell, not as
          a widget floating inside one. The Explorer Panel leads on the left
          (file/entity tree, plus the workspace's own identity and actions —
          same convention as any file-tree-driven IDE); the Control Panel
          trails as a collapsible panel on the right (sessions + customizations),
          both driven by the same shared `SidePanel` shell. */}
      <Box sx={{ flex: 1, minHeight: 420, overflow: 'hidden', display: 'flex' }}>
        <Group orientation="horizontal" style={{ flex: 1, minWidth: 0 }}>
          <SidePanel
            panelId="workspace-files-panel"
            panelRef={explorerPanelRef}
            defaultSize="22"
            minSize="15"
            maxSize="36"
            collapsed={explorerCollapsed}
            onResize={(size) => setExplorerCollapsed(size.asPercentage === 0)}
            glyph={PanelLeft}
            title="Explorer Panel"
            headerTestId="workspace-explorer-panel-label"
            headerDivider={false}
            headerActions={explorerHeaderActions}
          >
            <ExplorerPanelContent
              activeWorkspace={activeWorkspace}
              isDefaultWorkspace={isDefaultWorkspace}
              selectedProject={selectedProject}
              onNavigateToWorkspace={exitProjectScope}
              headerMenu={headerMenu}
              beforeSwitch={resetTabs}
              personalInstructionRow={personalInstructionRow}
              projects={projects}
              onSelectFile={openFileTab}
              onUseAsProject={(absolutePath) => void handleUseAsProject(absolutePath)}
              onPreviewFile={openFilePreviewTab}
              onNewAction={newActionForFile}
              instructionRow={instructionRow}
              renderProjectInstructionRow={renderProjectInstructionRow}
              {...(activeWorkspace ? { workspaceRootPath: activeWorkspace.rootPath } : {})}
            />
          </SidePanel>
          <ResizeHandle />
          <Panel id="workbench-canvas-panel" minSize="30" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <WorkbenchCanvas tabs={canvasTabs} activeTabId={activeTabId} onSelect={handleSelectTab} emptyState={emptyCanvasState} />
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
            glyph={PanelRight}
            title="Control Panel"
            headerTestId="workspace-control-panel-label"
          >
            <ControlPanelContent
              isDefaultWorkspace={isDefaultWorkspace}
              showGlobal={showGlobal}
              {...(entityLocalScope ? { localScope: entityLocalScope } : {})}
              {...(mcpMatchPath ? { mcpMatchPath } : {})}
              onEditEntity={openEntityTab}
              onPreviewEntity={previewEntity}
              onEntityProperties={requestEntityProperties}
              onNewActionForEntity={newActionForEntity}
              historyScope={historyScope}
              onOpenSession={openSessionTab}
              onSessionRemoved={removeSessionTab}
              onSeeAllSessions={openHistoryTab}
              canStartSession={selectedProject !== null || activeWorkspace !== undefined}
              onNewSession={handleNewSession}
            />
          </SidePanel>
        </Group>
      </Box>

      <WorkspaceRemoveConfirmDialog
        open={pendingRemoval !== null}
        workspaceName={pendingRemoval?.name ?? ''}
        onConfirm={() => void handleRemoveWorkspace()}
        onCancel={() => setPendingRemoval(null)}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}
