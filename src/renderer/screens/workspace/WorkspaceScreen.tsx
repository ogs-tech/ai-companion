import { useEffect, useRef, useState } from 'react';
import {
  Box, Divider, IconButton, List, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Tooltip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import {
  ChevronsLeft, ChevronsRight, Eye, EyeOff, File as FileIcon, FileX, Globe, MoreVertical, NotebookPen,
  PanelLeft, PanelRight, Plus, Sparkles, SquareTerminal, Trash2, type LucideIcon,
} from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { EmptyState } from '../../components/ds/EmptyState.js';
import { Kicker } from '../../components/ds/Kicker.js';
import { FolderTree } from '../../components/workspace/FolderTree.js';
import { WorkspaceBreadcrumbHeader } from '../../components/workspace/WorkspaceBreadcrumbHeader.js';
import { WorkspaceManagementList } from '../../components/workspace/WorkspaceManagementList.js';
import { InstructionTreeRow, ProjectInstructionRow } from '../../components/workspace/InstructionTreeRow.js';
import { EntityTreeGroup } from '../../components/workspace/EntityTreeGroup.js';
import { HooksTreeGroup } from '../../components/workspace/HooksTreeGroup.js';
import { McpTreeGroup } from '../../components/workspace/McpTreeGroup.js';
import { PluginsTreeGroup } from '../../components/workspace/PluginsTreeGroup.js';
import { SessionsTreeGroup } from '../../components/workspace/SessionsTreeGroup.js';
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
import {
  useInvalidateInstructions,
  usePersonalInstruction,
  useWorkspaceInstruction,
} from '../../hooks/use-instructions.js';
import { isPersonalInstruction } from '../../../shared/entity.js';
import type { Agent, Instruction, Skill } from '../../../shared/entity.js';
import type { Workspace } from '../../../shared/workspace.js';
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
  | { id: string; kind: 'preview'; label: string; source: PreviewSource };

function entityTabGlyph(tab: Extract<OpenTab, { kind: EntityKind | 'instruction' }>): LucideIcon {
  if (tab.kind === 'instruction') return isPersonalInstruction(tab.entity) ? Globe : NotebookPen;
  return ENTITY_GROUP_ICONS[tab.kind];
}

/**
 * A thin drag handle between two panels, colored `divider` at rest and
 * `secondary.main` on hover/focus/drag — matches "fio antes de sombra"
 * (hairline first, no shadow) instead of a heavier grip affordance.
 */
function ResizeHandle(): React.ReactElement {
  const theme = useTheme();
  const [active, setActive] = useState(false);
  return (
    <Separator
      aria-label="Redimensionar painel"
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        width: 4,
        flexShrink: 0,
        cursor: 'col-resize',
        backgroundColor: active ? theme.palette.secondary.main : theme.palette.divider,
        transition: 'background-color 120ms ease',
      }}
    />
  );
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

  const filesPanelRef = usePanelRef();
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  // Customizations reads as an aside (icon strip when collapsed, matching
  // the same expand/collapse affordance the old AppShell-level SessionsPanel
  // used) rather than a resizable react-resizable-panels Panel — there's
  // nothing to drag-resize here, just a fixed-width tree to show or hide.
  const [customizationsExpanded, setCustomizationsExpanded] = useState(true);
  // The Sessões block sits stacked above Customizations inside the same
  // aside, not nested as one more of its tree rows — its own collapse is a
  // local accordion toggle (body only), independent of `customizationsExpanded`,
  // which still hides the whole aside down to the 40px icon strip.
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const { data: workspaceInstruction } = useWorkspaceInstruction(activeWorkspace?.id ?? '');

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
    if (target && target.kind !== 'session' && target.kind !== 'preview' && target.dirty && !window.confirm('Descartar alterações não salvas?')) return;
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
    const dirtyCount = openTabs.filter((t) => t.kind !== 'session' && t.kind !== 'preview' && t.dirty).length;
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

  const customizationRows = (
    <>
      <EntityTreeGroup kind="skill" label="Skills" showGlobal={showGlobal} onEdit={openEntityTab} onPreview={previewEntity} onProperties={requestEntityProperties} onNewAction={newActionForEntity} {...(entityLocalScope ? { localScope: entityLocalScope } : {})} />
      <EntityTreeGroup kind="agent" label="Agents" showGlobal={showGlobal} onEdit={openEntityTab} onPreview={previewEntity} onProperties={requestEntityProperties} onNewAction={newActionForEntity} {...(entityLocalScope ? { localScope: entityLocalScope } : {})} />
      <HooksTreeGroup isProjectContext showGlobal={showGlobal} />
      <McpTreeGroup showGlobal={showGlobal} {...(mcpMatchPath ? { matchPath: mcpMatchPath } : {})} />
      <PluginsTreeGroup isProjectContext showGlobal={showGlobal} />
    </>
  );

  const defaultWorkspaceCustomizationRows = (
    <>
      <EntityTreeGroup kind="skill" label="Skills" showGlobal={false} onEdit={openEntityTab} onPreview={previewEntity} onProperties={requestEntityProperties} onNewAction={newActionForEntity} />
      <EntityTreeGroup kind="agent" label="Agents" showGlobal={false} onEdit={openEntityTab} onPreview={previewEntity} onProperties={requestEntityProperties} onNewAction={newActionForEntity} />
      <HooksTreeGroup showGlobal={false} />
      <McpTreeGroup showGlobal={false} />
      <PluginsTreeGroup showGlobal={false} />
    </>
  );

  const toggleCustomizations = (): void => setCustomizationsExpanded((v) => !v);
  const toggleSessions = (): void => setSessionsExpanded((v) => !v);
  // Re-expands the whole aside AND makes sure the Sessões block itself isn't
  // sitting locally collapsed — clicking this icon in the 40px strip should
  // reliably land the user on visible session rows, not just an expanded
  // Customizations panel with Sessões still accordioned shut underneath it.
  const expandToSessions = (): void => {
    setCustomizationsExpanded(true);
    setSessionsExpanded(true);
  };

  // The imperative collapse()/expand() calls drive the real (pixel-measured)
  // layout, but the boolean below is what the menu label and the
  // `data-collapsed` test hook read — set directly here rather than derived
  // solely from `onResize`, since jsdom never lays elements out (offsetWidth
  // is always 0), so the library's own resize feedback never settles there.
  const toggleFilesPanel = (): void => {
    const panel = filesPanelRef.current;
    if (!panel) return;
    setFilesCollapsed((collapsed) => {
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

  // Lives at the top of the Explorer Panel now (see `filesContent` below),
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
        <MenuItem data-testid="workspace-toggle-files" onClick={() => { toggleFilesPanel(); closeHeaderMenu(); }}>
          <ListItemIcon><Icon glyph={PanelLeft} size={16} /></ListItemIcon>
          <ListItemText>{filesCollapsed ? 'Mostrar arquivos' : 'Ocultar arquivos'}</ListItemText>
        </MenuItem>
        <MenuItem data-testid="workspace-toggle-customizations" onClick={() => { toggleCustomizations(); closeHeaderMenu(); }}>
          <ListItemIcon><Icon glyph={PanelRight} size={16} /></ListItemIcon>
          <ListItemText>{customizationsExpanded ? 'Ocultar Customizations' : 'Mostrar Customizations'}</ListItemText>
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

  const customizationsListContent = (
    <List disablePadding>{isDefaultWorkspace ? defaultWorkspaceCustomizationRows : customizationRows}</List>
  );

  // The Explorer Panel owns the screen's identity now — its own "EXPLORER
  // PANEL" kicker, then the workspace/project breadcrumb (with the "⋮" menu
  // that used to sit in a full-width header above every panel) — followed by
  // the file/entity tree. Only the tree region scrolls; the identity block
  // above it stays put, same fixed-header-over-scrolling-body shape the
  // Sessões/Customizations blocks in the Control Panel already use.
  const filesHeader = (
    <Box sx={{ flexShrink: 0 }}>
      <Box sx={{ px: 1.5, py: 1 }} data-testid="workspace-explorer-panel-label">
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Icon glyph={PanelLeft} size={14} />
          <Kicker>Explorer Panel</Kicker>
        </Stack>
      </Box>
      <Box sx={{ px: 1.5, pb: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <WorkspaceBreadcrumbHeader
          workspaceName={activeWorkspace?.name ?? '…'}
          isDefaultWorkspace={activeWorkspace?.isDefault ?? false}
          {...(selectedProject ? { projectName: selectedProject.name } : {})}
          path={selectedProject ? selectedProject.path : (activeWorkspace?.rootPath ?? '')}
          onNavigateToWorkspace={exitProjectScope}
          actions={headerMenu}
        />
      </Box>
    </Box>
  );

  const filesContent = (
    <Box sx={(theme) => ({ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: theme.ogs.surfaces.rail })}>
      {filesHeader}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {isDefaultWorkspace ? (
          <WorkspaceManagementList
            beforeSwitch={resetTabs}
            instructionRow={
              <InstructionTreeRow
                kind="personal"
                instruction={personalInstruction}
                seed={() => blankCustomization('instruction') as Instruction}
                onOpen={openInstructionEditor}
                onPreview={previewEntity}
                onNewAction={newActionForInstruction}
              />
            }
          />
        ) : (
          <FolderTree
            onSelectFile={openFileTab}
            onUseAsProject={(absolutePath) => void handleUseAsProject(absolutePath)}
            onPreviewFile={openFilePreviewTab}
            onNewAction={newActionForFile}
            projects={projects}
            instructionRow={instructionRow}
            renderProjectInstructionRow={(project, depth) => (
              <ProjectInstructionRow
                project={project}
                onPreview={previewEntity}
                onOpen={(entity, isCreate) => {
                  // Opening a Project's own INSTRUCTIONS row — even browsed
                  // in place, before "entering" it — scopes the Control
                  // Panel/breadcrumb to that Project too, same as opening one
                  // of its files does (see `syncProjectFromTab`).
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
            )}
            {...(activeWorkspace ? { workspaceRootPath: activeWorkspace.rootPath } : {})}
          />
        )}
      </Box>
    </Box>
  );

  // Docked to the right of the Workbench, outside the resizable Group — a
  // fixed-width aside that collapses to a 40px icon strip (click anywhere
  // on it to expand again), the same interaction shape the old AppShell-level
  // SessionsPanel used, rather than a drag-resizable Panel: there's nothing
  // here worth resizing, only a tree to show or hide.
  const customizationsAside = (
    <Box
      data-testid="workspace-customizations-aside"
      data-collapsed={!customizationsExpanded}
      sx={{ display: 'flex', borderLeft: 1, borderColor: 'divider', flexShrink: 0 }}
    >
      {customizationsExpanded ? (
        <Box sx={(theme) => ({ width: 260, height: '100%', display: 'flex', flexDirection: 'column', bgcolor: theme.ogs.surfaces.rail })}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }} data-testid="workspace-control-panel-label">
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Icon glyph={PanelRight} size={14} />
              <Kicker>Control Panel</Kicker>
            </Stack>
          </Box>
          {/* Stacked above Customizations, not nested inside it as one more
              tree row — a session is reachable/actionable even when its own
              entity/project/workspace tab isn't open, so it earns its own
              always-visible section instead of hiding inside a collapsed
              group. Its collapse only hides this block's own body (a local
              accordion), unlike Customizations' below, which hides the whole
              aside down to the 40px icon strip. */}
          <Box
            data-testid="workspace-sessions-panel"
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              maxHeight: sessionsExpanded ? 260 : 'auto',
              overflow: 'hidden',
            }}
          >
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, flexShrink: 0 }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Icon glyph={SquareTerminal} size={14} />
                <Kicker>Sessões</Kicker>
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Tooltip title="Nova sessão">
                  {/* span wrapper keeps the tooltip working while the button is disabled (no project/workspace in view yet) */}
                  <span>
                    <IconButton
                      size="small"
                      data-testid="workspace-sessions-new"
                      aria-label="Nova sessão"
                      disabled={!selectedProject && !activeWorkspace}
                      onClick={handleNewSession}
                    >
                      <Icon glyph={Plus} size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
                <IconButton
                  size="small"
                  data-testid="workspace-sessions-collapse"
                  aria-label={sessionsExpanded ? 'Ocultar sessões' : 'Mostrar sessões'}
                  onClick={toggleSessions}
                >
                  <Icon glyph={sessionsExpanded ? ChevronsLeft : ChevronsRight} size={16} />
                </IconButton>
              </Stack>
            </Stack>
            {sessionsExpanded && (
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <SessionsTreeGroup onOpen={openSessionTab} onRemoved={removeSessionTab} />
              </Box>
            )}
          </Box>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
          >
            <Kicker>Customizations</Kicker>
            <IconButton
              size="small"
              data-testid="workspace-customizations-collapse"
              aria-label="Ocultar Customizations"
              onClick={toggleCustomizations}
            >
              <Icon glyph={ChevronsLeft} size={16} />
            </IconButton>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{customizationsListContent}</Box>
        </Box>
      ) : (
        <Box sx={{ width: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5, gap: 2 }}>
          <Box
            role="button"
            tabIndex={0}
            aria-label="Mostrar sessões"
            data-testid="workspace-sessions-expand"
            onClick={expandToSessions}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              if (e.key === ' ') e.preventDefault();
              expandToSessions();
            }}
            sx={{ cursor: 'pointer' }}
          >
            <Icon glyph={SquareTerminal} size={18} />
          </Box>
          <Box
            role="button"
            tabIndex={0}
            aria-label="Mostrar Customizations"
            data-testid="workspace-customizations-expand"
            onClick={toggleCustomizations}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              if (e.key === ' ') e.preventDefault();
              toggleCustomizations();
            }}
            sx={{ cursor: 'pointer' }}
          >
            <Icon glyph={Sparkles} size={18} />
          </Box>
        </Box>
      )}
    </Box>
  );

  return (
    <Box component="main" data-testid="workspace-screen" sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Panels run edge-to-edge with the window, not boxed in a bordered,
          margined card — a workbench reads as part of the app shell, not as
          a widget floating inside one. The Explorer Panel leads on the left
          (file/entity tree, plus the workspace's own identity and actions —
          same convention as any file-tree-driven IDE); the Control Panel
          trails as a collapsible aside on the right (sessions + customizations). */}
      <Box sx={{ flex: 1, minHeight: 420, overflow: 'hidden', display: 'flex' }}>
        <Group orientation="horizontal" style={{ flex: 1, minWidth: 0 }}>
          <Panel
            id="workspace-files-panel"
            panelRef={filesPanelRef}
            collapsible
            collapsedSize="0"
            defaultSize="22"
            minSize="15"
            maxSize="36"
            onResize={(size) => setFilesCollapsed(size.asPercentage === 0)}
            style={{ overflow: 'hidden' }}
            data-collapsed={filesCollapsed}
          >
            {filesContent}
          </Panel>
          <ResizeHandle />
          <Panel id="workbench-canvas-panel" minSize="30" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <WorkbenchCanvas tabs={canvasTabs} activeTabId={activeTabId} onSelect={handleSelectTab} emptyState={emptyCanvasState} />
          </Panel>
        </Group>
        {customizationsAside}
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
