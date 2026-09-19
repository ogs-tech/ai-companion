# Workspace View Mode: Project vs Multi-Project — Design

- **Date:** 2026-09-19
- **Status:** Brainstormed, pending author review of this file.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Formalize an ambiguity in the Workspace screen's mental model into an explicit,
  fully-derived view mode — "Project view" vs "Multi-project view" — for non-default workspaces,
  and close the small creation-time gap that causes it. Does **not** touch the existing
  folder-picker creation UI, introduce a new project-switcher UI, or persist any new state.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR, using a visual
> companion for the layout/flow comparisons.

---

## 1. Context and goal

The author found the Workspace screen's mental model ambiguous: they think of it as having a
**Global view** (for creating/switching workspaces) and, for any non-global workspace, two further
views — **"as a Project"** and **"with multiple projects,"** the latter filtering the Control Panel
by whichever tab is selected. Tracing the actual code (`WorkspaceScreen.tsx` and its panels) found
that only the first piece is real, and only informally:

- `activeWorkspace.isDefault` (a plain boolean, not a `WorkspaceViewMode` enum) already branches
  Explorer Panel between `WorkspaceManagementList` (the "Global view") and `FolderTree`, and Control
  Panel between unscoped and scoped content. This matches the author's "Visualização Global" as-is
  and is untouched by this spec.
- "Project view" vs "multi-project view" **does not exist in any form** — not a type, not a state,
  not a test, not a code comment. What exists instead is `selectedProjectId` (`WorkspaceScreen.tsx`
  line 124): a single "project in view," silently re-derived every time the active Workbench tab
  changes (`syncProjectFromTab`, lines 176-181), which already filters Control Panel's Sessões and
  Customizations — just with no visible indicator and no formal distinction between "this workspace
  is effectively one project" and "this workspace juggles several."

This spec closes that gap: it gives the author's three-tier mental model a real, named shape in the
UI, reusing the tab-driven scoping mechanism that already exists rather than building a new one.

### Terminology alignment

The author's pt-BR terms map onto real code identifiers as follows (established during
brainstorming, useful for anyone reading this spec against the code):

| Author's term | Code identifier |
|---|---|
| Explorer Panel | `ExplorerPanelContent` — matches as-is |
| Central Panel | `WorkbenchCanvas` / "Workbench" — never called "Central Panel" in code |
| Control Panel | `ControlPanelContent` — matches as-is |
| Visualização Global | `activeWorkspace.isDefault` (a boolean, not a named view) |
| Visualização como Projeto | This spec's "Project view" — not called a "view" in code today, the closest existing concept is `selectedProjectId` |
| Visualização com múltiplos projetos | This spec's "Multi-project view" — did not exist before this spec |

No rename of `WorkbenchCanvas` is proposed — the mismatch is a naming note, not a change request.

## 2. Decisions made during brainstorming

1. **View mode is fully derived, never persisted.** For a non-default workspace:
   `viewMode = projects.length <= 1 ? 'project' : 'multi-project'`. No new field on `Workspace`,
   no separate "mode" the author sets — it evolves automatically the moment a second `Project` gets
   registered (via the existing "Usar como Project" gesture in `FolderTree`), and regresses back to
   `'project'` if it drops back to one. Considered and rejected: an explicit toggle in the
   workspace header, and a mode chosen once at workspace-creation time and locked in — both add
   state the author didn't want to manage.
2. **Global view is untouched.** It stays exactly `activeWorkspace.isDefault`, sitting above and
   orthogonal to Project/Multi-project — this spec only concerns the two sub-views of a non-default
   workspace.
3. **Multi-project view's Control Panel filtering reuses the existing tab-driven mechanism as-is.**
   Considered and rejected: a new, dedicated project-switcher tab strip (separate from Workbench
   tabs) inside or near the Control Panel. The author chose to keep `selectedProjectId`, derived
   from whichever Workbench tab is active via `syncProjectFromTab`, as the single source of truth —
   no new UI element for selecting "which project."
4. **Workspace creation gains one small new behavior, no new UI.** The folder picked in the
   existing, unchanged "Selecionar pasta" step is automatically registered as that workspace's
   first `Project` (`path` equal to `workspace.rootPath`). This closes the previous gap where a
   fresh workspace had zero registered Projects and no clear view-mode signal. The author confirmed
   explicitly: the folder-picker step itself is not to be touched — this is a behavior change behind
   an existing screen, not a new step or question ("consta ela como projeto" — the root folder
   itself becomes a real, registered `Project` entry, not just an implicit scope).
5. **A visual indicator, not a control.** Control Panel's header shows a small "Projeto: `<name>`"
   chip only when `viewMode === 'multi-project'` **and** the active tab resolves to a specific
   project. In `'project'` view the chip is omitted — nothing to disambiguate with only one project.
   When in multi-project view but the active tab isn't scoped to any project (a workspace-anchored
   session, or a non-project Workbench tab such as Starter Pack/Marketplaces/Diagnóstico), the chip
   becomes a neutral "Workspace" badge and Control Panel falls back to unscoped, workspace-level
   content — reusing the fallback that already exists today whenever `selectedProjectId` is `null`
   (`entityLocalScope`/`historyScope`, `WorkspaceScreen.tsx` lines 516-520 and 534-538). Only the
   badge itself is new; the underlying fallback behavior is not.
6. **`FolderTree` gains a "root is itself a Project" match case.** Today it only recognizes a
   `Project` as a direct child of the workspace root (`joinRootPath(workspaceRootPath, entry.name)`,
   `FolderTree.tsx` lines 92-108). Decision #4 requires it to also recognize a `Project` whose `path`
   equals the workspace's own `rootPath`.

## 3. Architecture

No new bounded context — this is additive behavior inside the existing `workspace`/`project` slice
described in `docs/superpowers/specs/2026-08-22-workspace-project-scope-design.md` (§2.5, §2.11) and
the renderer components it already produced.

- **Workspace creation flow** (renderer, wherever it currently sequences `workspace.create`): gains
  one follow-up `project.create({ name: <folder name>, path: rootPath })` call. Whether this is
  orchestrated by `WorkspaceService.create` itself (main process) or sequenced as two IPC calls from
  the renderer's creation flow is left as an implementation-time call — either keeps `ProjectService`
  unchanged, since `project.create` already accepts an arbitrary path (§2.11 of the referenced spec).
- **`viewMode` derivation** — a small computed value (`projects.length <= 1 ? 'project' :
  'multi-project'`), likely colocated in `WorkspaceScreen.tsx` next to where `projects` is already
  fetched, passed down to `ControlPanelContent` (either as a new prop, or `ControlPanelContent`
  computes it inline from a `projects` array it already/could receive — implementation-time call).
- **`ControlPanelContent.tsx`** gains the chip/badge rendering described in decision #5, driven by
  `viewMode` and the existing `selectedProject`/`localScope`. No new IPC, no new store.
- **`FolderTree.tsx`**'s existing `matchedProject`/`effectiveProjectId` logic (lines 92-108) gets a
  second match branch: `project.path === activeWorkspace.rootPath`, alongside the existing
  child-of-root branch.

## 4. Data flow

1. **Create workspace** (existing, unchanged folder-picker UI) → `workspace.create` → **new:**
   `project.create({ name: folderName, path: rootPath })` → the workspace's `projects.json` gains
   one entry whose `path` equals the workspace's own `rootPath`.
2. **Renderer loads the workspace** → `project.list` returns length 1 → `viewMode = 'project'` →
   Control Panel renders scoped to that one project, no chip.
3. **Author registers a second Project** via the existing "Usar como Project" gesture on a subfolder
   in `FolderTree` → `project.create` → `project.list` length becomes 2 → `viewMode` flips to
   `'multi-project'` automatically on the next render. No explicit mode switch by the author.
4. **Author switches Workbench tabs** → existing `syncProjectFromTab` updates `selectedProjectId` →
   existing `entityLocalScope`/`historyScope` re-derive → Control Panel's session list and
   Customizations tree re-scope (all unchanged) → **new:** the chip text updates to the newly active
   project's name, or turns into the neutral "Workspace" badge if the new tab isn't project-scoped.

## 5. Error handling

- The follow-up `project.create` call at workspace creation fails (name collision, permission
  error, etc.) → surfaced the same way any `project.create` failure is today; workspace creation
  itself should still succeed — the workspace simply starts with zero registered Projects, falling
  back to today's pre-existing unscoped display (`viewMode` still computes to `'project'` at
  `projects.length === 0`, consistent with decision #1's formula). Not rolling workspace creation
  back on this failure is a recommendation from this spec, not yet confirmed as an explicit
  decision — flagging for implementation-time confirmation.
- Author deletes the root-anchored Project (or any Project) after creation → `viewMode` simply
  recomputes from the new count on next render; no new error state beyond what `project.delete`
  already handles.
- `FolderTree`'s new root-equals-project match case has no failure mode of its own — it's a pure
  comparison against already-loaded `Project`/`Workspace` data.

## 6. Testing

- Workspace creation flow: creating a workspace registers exactly one `Project` whose `path` matches
  the picked root.
- `viewMode` derivation: covers 0, 1, and 2+ registered Projects.
- `ControlPanelContent`: chip shows the project name when `multi-project` + a project-scoped tab is
  active; shows the neutral "Workspace" badge when `multi-project` + a non-project tab is active; no
  chip at all in `project` view.
- `FolderTree`: the new root-equals-project match case, alongside the existing child-of-root case.

## 7. Explicitly out of scope

- Any new question/screen in the workspace-creation flow — the author confirmed the existing
  "Selecionar pasta" step stays exactly as-is; the only change is the automatic `Project` it now
  registers behind that same step.
- A dedicated project-switcher tab strip inside or near Control Panel — considered and rejected in
  decision #3 in favor of reusing the existing Workbench-tab-driven scoping.
- Persisting `viewMode` (or any "single vs multi" intent) as a field on `Workspace` — considered and
  rejected in decision #1; it is always derived from the live `Project` count.
- Reopening "one active workspace at a time" from
  `docs/superpowers/specs/2026-08-22-workspace-project-scope-design.md` §2.3/§7 — this spec is
  entirely about view state *within* one already-active workspace's registered Projects, not about
  running multiple workspaces concurrently.
- Renaming `WorkbenchCanvas` to match the author's "Central Panel" term in code — a terminology
  mismatch noted during brainstorming, not a rename request.
