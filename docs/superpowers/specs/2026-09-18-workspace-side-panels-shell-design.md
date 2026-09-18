# Workspace Side Panels — Shell Componentization and Standardization — Design

- **Date:** 2026-09-18
- **Status:** Design approved by author in brainstorming; spec pending author review.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Foundation only — componentize and standardize `WorkspaceScreen`'s two side panels (Explorer
  Panel on the left, Control Panel on the right): a shared `SidePanel` shell, a shared `TreeRow`
  primitive, and a file split of `WorkspaceScreen.tsx`. Per-module UX (Sessions list, Customizations
  tree groups, Explorer file browsing) is explicitly deferred to follow-up specs.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and problem

`WorkspaceScreen.tsx` (`src/renderer/screens/workspace/WorkspaceScreen.tsx`, ~1050 lines) renders the
app's central IDE-like surface: an Explorer Panel on the left (file/entity tree) and a Control Panel on
the right (live sessions + Skills/Agents/Hooks/MCP/Plugins), around a Workbench canvas of tabs.

The two panels were built at different times and never unified:

- **Explorer Panel** is a real `Panel` inside a `react-resizable-panels` `Group`, drag-resizable, and
  collapsible to 0 width via an imperative `panelRef` (`usePanelRef`).
- **Control Panel** is a plain `Box` rendered *after* that `Group` closes, fixed width (260px), and
  collapses instead to a 40px icon strip with its own click targets.
- Each panel builds its own header inline (`Kicker` + icon + actions), with no shared component.
- Each panel's rows are independently implemented: `FolderTree`'s `TreeNode`
  (chevron + icon + label + trailing actions) and `TreeGroup`'s `TreeGroupRow`
  (chevron + icon + label + badge + hover actions + accent spine) solve the same visual problem twice,
  with small, unintentional differences between them.

The result reads as two features stitched together rather than one workbench, and any future change to
"how a side panel behaves" (or "how a tree row looks") has to be made twice, in two different shapes.

## 2. Decisions made during brainstorming

1. **Scope is exactly these two panels** (Explorer Panel + Control Panel of `WorkspaceScreen`). No other
   screen in the app has this two-panel pattern today, and none is being retrofitted into it now.
2. **Split into a foundation spec (this one) plus follow-up specs.** This spec only touches shell/chrome:
   panel header, resize/collapse mechanics, and the shared row primitive. Revisiting the UX *inside* each
   module (Explorer file browsing, Sessions list, Customizations groups) is out of scope here and left to
   dedicated specs that build on top of this foundation (§5).
3. **Collapse mechanic: unify on "resizable, collapses to 0px"** — the mechanic the Explorer Panel
   already uses. The Control Panel adopts it too, becoming a real `Panel` inside the `Group`. This
   retires the 40px icon-strip collapse mode entirely (`WorkspaceScreen.tsx:975-1009`); re-expanding a
   collapsed panel goes through the drag handle or the existing "⋮" menu items
   (`workspace-toggle-files` / `workspace-toggle-customizations`), both of which already exist today.
4. **New shared primitives live in `components/ds/`**, not `components/workspace/`. They are
   content-agnostic visual components with no domain logic, matching the placement of `Kicker`, `Icon`,
   `EmptyState`, etc. — the same place a future screen would look if it ever needed the same pattern.
5. **The tree row is unified in this foundation**, not deferred to the module specs — it is shared
   infrastructure both panels depend on. Building it now means the follow-up module specs can focus on
   behavior/content instead of re-solving row rendering.
6. **Behavior-preserving.** This is a structural/visual refactor. No IPC contract, data flow, or module
   UX/behavior change is part of this spec — only *how* the existing panels are composed and *where*
   their code lives.

## 3. Architecture

### 3.1 New components in `components/ds/`

**`SidePanel`** — the shared shell for a resizable, collapsible side panel:

- Header: `Kicker` + leading icon + title, with an actions slot on the trailing edge (mirrors today's
  `filesHeader`/aside header structure).
- Body: a scrollable content region (`overflowY: auto`) below the header.
- Resize/collapse: wraps a `react-resizable-panels` `Panel`, exposing the same imperative collapse/expand
  API `WorkspaceScreen` already uses via `usePanelRef` for the Explorer Panel today — so both panels are
  driven by one mechanism instead of two.

**`ResizeHandle`** — promoted as-is from `WorkspaceScreen.tsx:91-110` into `components/ds/ResizeHandle.tsx`.
No behavior change.

**`TreeRow`** — the single row primitive that replaces both `FolderTree`'s `TreeNode` row markup and
`TreeGroup`'s `TreeGroupRow`/group-header row. Props: an optional leading chevron (expandable rows), a
leading icon, a truncated primary label, an optional trailing badge/chip (e.g. entity count, "Global"
tag), an optional left accent-color spine, and trailing actions that are either always visible or
hover/focus-revealed. `TreeGroup` keeps its own domain logic (count, "Nada aqui ainda" empty state,
create action) but renders through `TreeRow` instead of duplicating the row markup; `FolderTree`'s
`TreeNode` does the same for file/folder rows. Visual output stays equivalent to today at both call
sites — this is deduplication, not a redesign.

### 3.2 File split in `components/workspace/`

`WorkspaceScreen.tsx` keeps only cross-cutting state (open tabs, selected project, workspace history,
toasts) and top-level composition. Panel content moves out:

- **`ExplorerPanelContent.tsx`** — today's `filesHeader` + `filesContent` (breadcrumb, header menu,
  `FolderTree`/`WorkspaceManagementList`).
- **`ControlPanelContent.tsx`** — today's `customizationsAside` body: the Sessions block and the
  Customizations block (`EntityTreeGroup`/`HooksTreeGroup`/`McpTreeGroup`/`PluginsTreeGroup`), each still
  owning its own local accordion state (`sessionsExpanded`, `customizationsExpanded` become local to this
  component).

Both mount as children of a `SidePanel`, as siblings inside the same `Group`:

```
<Group orientation="horizontal">
  <Panel><SidePanel side="left">...<ExplorerPanelContent/></SidePanel></Panel>
  <ResizeHandle/>
  <Panel><WorkbenchCanvas/></Panel>
  <ResizeHandle/>
  <Panel><SidePanel side="right">...<ControlPanelContent/></SidePanel></Panel>
</Group>
```

(Today the Control Panel sits in a `Box` after the `Group` closes; it becomes a third `Panel` inside it.)

### 3.3 State changes

- `filesCollapsed` and the outer-collapse sense of `customizationsExpanded` in `WorkspaceScreen.tsx` are
  replaced by two `panelRef`-driven booleans (`explorerCollapsed`, `controlPanelCollapsed`), following the
  pattern already used for the Explorer Panel today.
- `sessionsExpanded` and the *local*, body-only sense of `customizationsExpanded` move into
  `ControlPanelContent`, since nothing outside that component reads them.
- No change to `openTabs`, `selectedProjectId`, session/entity data flow, or any IPC call.

## 4. Testing

- Existing `data-testid`s that describe the icon-strip collapse mode (e.g. `workspace-sessions-expand`,
  `workspace-customizations-expand`, and the icon-strip markup around `WorkspaceScreen.tsx:975-1009`) are
  removed along with that mode; tests asserting on them are updated to assert the new collapse-to-0
  behavior instead (mirroring how `workspace-files-panel`'s `data-collapsed` is already tested today).
- `data-testid`s that describe panel identity (`workspace-explorer-panel-label`,
  `workspace-control-panel-label`, `workspace-customizations-aside`, `workspace-sessions-panel`) are
  preserved wherever the element they label still exists, so higher-level integration tests keep working
  unchanged.
- `SidePanel` and `TreeRow` get their own unit tests in isolation (render, collapse/expand, row variants),
  independent of mounting the whole `WorkspaceScreen`.
- `FolderTree.test.tsx` and `WorkspaceScreen`'s own tests are updated to match the new file structure and
  the dropped icon-strip mode, but keep asserting the same observable behavior (open a file, resize,
  collapse/expand) wherever that behavior didn't change.

## 5. Out of scope (candidate follow-up specs)

Explicitly deferred, each to become its own brainstorming session once this foundation lands:

- Explorer Panel content UX (file tree browsing, breadcrumb, "use as project"/"open project" affordances).
- Sessions module UX (list density, status, empty state).
- Customizations module UX (the five entity `TreeGroup`s: Skills, Agents, Hooks, MCP, Plugins).

## 6. Risks / notes

- **Pre-existing dirty working tree.** The repo currently has unrelated in-progress work on an "Open
  With" feature (`components/workspace/OpenWithMenu.tsx`, `use-open-with.ts`, and several `src/main`
  files, per `git status`). None of it overlaps with the files this spec touches conceptually, but the
  implementation plan should land this redesign as its own change, not mixed with that unrelated work.
- **`FolderTree.tsx` and `RowContextMenu.tsx` are already modified** by that in-progress Open With work
  (uncommitted). The implementation must read their current on-disk state — not this document's line
  numbers — before editing, since `TreeNode`'s exact shape may already have shifted.
