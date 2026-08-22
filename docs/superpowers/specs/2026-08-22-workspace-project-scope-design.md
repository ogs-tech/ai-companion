# Workspace / Project Scoping — Design

- **Date:** 2026-08-22
- **Status:** Revised after author feedback — read-only workspace browsing, Project creation from
  the browser, and Workspace/Project-anchored sessions were pulled into this spec's base. Pending
  author re-review.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Introduce `Workspace` and `Project` as first-class, non-synced concepts; replace
  Instruction's closed `PersonalInstruction | ProjectInstruction` union with a single, generic
  scoping mechanism (`scopes` + `scopeId`) shared across `Entity`; and give the author a real
  Workspace screen — pick a folder, see its `Project`s, browse its folders/files read-only with
  content preview, and open a `claude` session directly against the workspace root or a project. It
  does **not** build file writing/editing, a general file manager (rename/move/delete), or
  Skill/Agent scope-picking UI.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

The author's original ask was narrow: Instructions today only support a personal singleton (`GI`)
or one instruction per git-repo root (`ProjectInstruction.repoPath`), and the author wants that
expanded to cover "project, lib, module, or N things." During brainstorming this widened into a
larger, standing product direction already recorded in `new-version.md`: AI Companion's
differentiator is becoming an "orquestrador multi-agent e tool caller... centralizando a interface
de trabalho... no desktop" — and the author confirmed a further, longer-term ambition that
`Workspace` is meant to eventually **replace the code editor** as the place real project files are
browsed and worked in.

The first version of this spec treated that ambition as entirely out of scope and limited itself to
a data-model foundation with no real UI beyond a workspace switcher. The author corrected that after
reading it: "o que quero para workspace é selecionar uma pasta como workspace, me permitir ver os
projetos, listar pastas e arquivos, abrir sessão" — i.e. the base itself should already be a usable
Workspace surface, not just inert scoping plumbing. This revision folds that in: a Workspace is
something you open, see the `Project`s inside it, browse its folders and files (read-only, with
content preview), and launch a `claude` session against directly. Full file **editing** — the part
that would actually replace a code editor — stays out of this spec (see §7); what lands here is the
first real, navigable slice of that ambition, plus the generic scoping mechanism it's built on. The
author's stated principle for sequencing this work was "criar a base e evoluir aos poucos" (build the
base, evolve incrementally) — this spec is that base.

## 2. Decisions made during brainstorming

1. **Workspace is plural, not the app's one fixed directory.** Today `~/.ai-companion/` is a single
   hardcoded root (`WorkspaceBootstrapService.create(workspacePath)`, called once in
   `src/main/index.ts`). Going forward, `Workspace.rootPath` is any folder on disk the author picks
   (via a native OS folder-picker dialog); the app's own data (skills/agents/instructions) lives
   inside it at `<rootPath>/.ai-companion/`. The existing default is unchanged by this: for the
   default workspace, `rootPath` is the user's home directory, so its data dir is exactly today's
   `~/.ai-companion/` — **no physical migration for the default case.**
2. **Storage is per-workspace, not centralized.** Explicitly confirmed over the alternative (one
   shared entity store with Workspace/Project as a pure index) — each workspace has its own
   independent skills/agents/instructions storage, mirroring how a code editor's multi-root
   workspaces keep separate local config per root. This reuses `WorkspaceBootstrapService` and
   `FsEntityRepository` completely unchanged — both already take an arbitrary root path.
3. **One active workspace at a time.** Not all workspaces are mounted simultaneously; switching is
   closer to opening a different project in an IDE than to a multi-window model. Switching
   reconstructs the workspace-scoped slice of the main-process service graph (`FsEntityRepository`,
   `EntityService`, `AdapterManager`, `SymlinkManager`, `FileMaterializer`, `InstructionService`,
   `SessionService`, `FileBrowserService` (§2.10), etc. — everything `src/main/index.ts` currently
   wires once against a single `workspacePath`) against the new root, and kills any live `claude`
   sessions belonging to the outgoing workspace first (`SessionService.killAll()`, same mechanism
   already built for `before-quit` per the embedded-sessions design).
4. **The workspace registry lives at a fixed, always-discoverable location.** A `workspaces.json` at
   `~/.ai-companion/workspaces.json` (the default workspace's own root, which is itself
   unconditionally derivable from `home` before any "active workspace" concept exists) lists every
   known workspace (`id`, `name`, `rootPath`, `isDefault`, `createdAt`) plus which one is active. This
   avoids inventing a second fixed location.
5. **`Project` generalizes today's `repoPath`.** A `Project` is a named reference to an external
   path on disk (typically, but not strictly, a subfolder of the active workspace's `rootPath`) that
   acts as a sync target for scoped entities — exactly the role `ProjectInstruction.repoPath` played,
   now reusable across multiple instructions instead of being duplicated inline per-entity. Stored at
   `<workspace.rootPath>/.ai-companion/projects.json`, scoped to its owning workspace.
6. **Neither `Workspace` nor `Project` becomes an `EntityKind`.** Both are confirmed purely
   organizational/internal — never synced to `~/.claude/`, `.cursor/`, or any adapter target
   themselves. They get their own bounded context, not a slot in `EntityKind`.
7. **Scoping becomes generic and shared across `Entity`, not Instruction-specific.** `Scope` gains a
   `'workspace'` value (`'personal' | 'workspace' | 'project'`), and `Entity` gains an optional
   `scopeId: string` resolved against `Project.id` or `Workspace.id` depending on `scopes[0]`. This
   collapses `PersonalInstruction | ProjectInstruction` into one flat `Instruction` shape — the
   "personal must be the singleton `default`" rule moves from the type system into validation. The
   fields live on the shared `Entity` base, so `Skill`/`Agent` inherit them too, which is what
   unblocks the TODO already documented in `entity-schema.ts` ("Skill/agent scopes: ['project'] is
   temporarily rejected... reintroduce it once each carries a per-entity repoPath too"). **Only the
   schema/type unlocks in this slice** — the editor UI for picking a workspace/project scope stays
   Instruction-only; Skill/Agent keep validating `['personal']` only until a later pass adds their
   UI (§7).
8. **No `repoPath` field, persisted or derived.** An earlier version of this design kept `repoPath`
   as a field re-derived from `scopeId` on every read/write, to avoid touching adapters/session code.
   Once scoping went generic, that became unnecessary complexity: a shared `resolveScopePath(entity)`
   helper (used by the adapters, `AdapterManager`, and `SessionService`) resolves `scopeId` to an
   absolute path at the point of use — sync time or session-spawn time — and is never persisted on
   the entity. This removes the staleness problem a cached/denormalized path would have had if a
   `Project`'s path were edited after entities already referenced it.
9. **Existing `ProjectInstruction`s migrate lazily, on first read.** An entity found with the old
   on-disk `repoPath` field and no `scopeId` gets a matching `Project` found-or-created (deduped by
   exact path) under the default workspace, and its `scopes`/`scopeId` backfilled and persisted. No
   separate migration script or startup pass.
10. **The active workspace gets a read-only file/folder browser.** Rooted at the workspace's
    `rootPath`: a folder tree with on-demand expansion, and a file preview pane that shows plain-text
    content, capped in size (large files and anything non-text return "not previewable" instead of
    raw/garbled bytes). This is the first concrete slice of the "replace the code editor" ambition
    from §1 — it is navigation and visibility only. No writing, renaming, deleting, or moving of
    files/folders, and no code-editing surface (syntax highlighting or saving edits is later work,
    not this spec — see §7).
11. **Creating a `Project` is driven by browsing that tree.** The author navigates the workspace root
    in the browser and picks an existing folder to register as a `Project` (name defaults to the
    folder's name, editable before saving). The `project.create(name, path)` API itself is unchanged
    from the original design (§2.5) — only the renderer flow feeding it changes, from a bare path
    field to a pick-from-tree action.
12. **Sessions can be opened directly against a Workspace or a Project, not only against a
    customization entity.** This revises decision #2 of the embedded-claude-sessions design ("not
    per-project — per customization"), which predates the `Workspace`/`Project` concept and was
    written when "project" meant the since-removed `settings.linkedRepos`. `SessionService.spawn`
    now takes a `SessionAnchor` — `{ kind: 'entity'; urn }` | `{ kind: 'workspace'; workspaceId }` |
    `{ kind: 'project'; projectId }` — and the one-live-session invariant becomes "one per anchor
    key" instead of "one per entity urn." The entity-anchored flow from that design (open a session
    from a customization's own editor) is unchanged and additive, not replaced.

## 3. Architecture

New bounded context, `workspace`, mirroring the existing `entity`/`session` hexagonal split
(`domain` / `application/{ports,services}` / `infrastructure` / `ipc`):

- **`WorkspaceService`** — CRUD over the `workspaces.json` registry; owns "which workspace is
  active"; on `switchTo(id)`, calls `SessionService.killAll()` for the outgoing workspace then
  signals the composition root to re-wire (see below). Seeds the registry with the default workspace
  entry on first run if it doesn't exist yet.
- **`ProjectService`** — CRUD over the active workspace's `projects.json`. Scoped to whichever
  workspace is currently active; re-pointed at a different `projects.json` whenever the active
  workspace changes, the same way `EntityService`/`FsEntityRepository` are.
- **Storage:** both registries are flat JSON files, following the existing
  `FsSettingsRepository`(`settings.json`)-style pattern already used in `src/main/index.ts` rather
  than introducing a new storage abstraction.
- **`resolveScopePath(entity, { workspaceService, projectService })`** — a shared function (not a
  method on any one service, since it's needed by adapters, `AdapterManager`, and `SessionService`
  alike) that maps `scopes[0] === 'project' | 'workspace'` + `scopeId` to the concrete absolute path,
  throwing `DomainError('not_found')` if the reference no longer resolves. `'personal'` scope has no
  path — callers already branch on this today (adapters materialize personal-scope entities to fixed
  targets like `~/.claude/CLAUDE.md`, not a resolved path).
- **`FileBrowserPort`** (`src/main/application/ports/file-browser-port.ts`) —
  `listDir(absPath): Promise<FileBrowserEntry[]>` (name, `kind: 'file' | 'dir'`, size for files) and
  `readFile(absPath): Promise<FilePreview>` (`{ content: string; truncated: boolean }` for previewable
  text, or `{ previewable: false; reason }` for binary/oversized files). Implemented by
  `NodeFileBrowserAdapter` via `node:fs/promises` — same "service depends on port, adapter does I/O"
  split used everywhere else in `src/main/`.
- **`FileBrowserService`** — resolves a caller-supplied relative path against the active workspace's
  `rootPath`, rejects anything that escapes it (`..` segments, absolute paths, or a symlink resolving
  outside the root) with a validation `DomainError`, then delegates to `FileBrowserPort`. Re-created
  on every workspace switch, same as the other workspace-scoped services — this is the security
  boundary keeping browse/preview confined to the active workspace.
- **IPC:** `workspace.*` (`list`, `create`, `switchTo`, `delete`, `pickFolder`, `listDir`, `readFile`)
  and `project.*` (`list`, `create`, `update`, `delete`), both following the existing
  request/response envelope and `_validators.ts` convention. `workspace.pickFolder` wraps Electron's
  folder-picker dialog, used when creating a new workspace at an arbitrary location; `listDir`/
  `readFile` take a path relative to the active workspace's root.
- **`session.spawn`'s param becomes `{ anchor: SessionAnchor }`** (§2.12) instead of `{ entityUrn }`;
  `SessionService`/`ClaudeSessionPort` key live sessions by a string derived from the anchor
  (`entity:<urn>` / `workspace:<id>` / `project:<id>`) instead of by urn alone. This is a signature
  change to the separately in-progress, not-yet-implemented embedded-sessions design — flagged there
  too (see the cross-reference below), not re-litigating the rest of that design.
- **Composition root (`src/main/index.ts`):** the block that currently wires everything against one
  hardcoded `workspacePath` (roughly lines 152–338 today — `FsEntityRepository`, `AdapterManager`,
  `SymlinkManager`, `FileMaterializer`, `EntityService`, `InstructionService`, `SessionService`, the
  plugins dir, MCP stash path, etc.) is extracted into a re-invocable function, called once at
  startup with the registry's active workspace, and again by `WorkspaceService` on every
  `switchTo`. Making the already-registered IPC handlers see the freshly-built instances after a
  switch needs either a mutable indirection inside `IpcDeps` (each dependency held behind a
  reassignable reference) or fully re-registering the dispatcher's handler map — left as an
  implementation-time decision, not resolved by this spec.
- **`entity.ts`:** `Scope` gains `'workspace'`; `Entity` gains `scopeId?: string`; `Instruction`
  becomes one interface instead of a `PersonalInstruction | ProjectInstruction` union;
  `isPersonalInstruction`/`isProjectInstruction` become predicates over `scopes[0]` instead of type
  guards over distinct interfaces. `entity-schema.ts`'s `superRefine` branch moves from
  discriminating on shape to validating `scopes[0]` against the presence/absence and referential
  validity of `scopeId`.
- **Renderer — new Workspace screen.** Shows the active workspace's name/path, its `Project` list
  (each row offering "Open session" and delete), and a folder tree rooted at the workspace root with
  on-demand per-node expansion (`workspace.listDir`), a file preview pane (`workspace.readFile`,
  including a placeholder state for "not previewable"), and a "Use as Project" action on any folder
  (§2.11). "Open session" also appears at the workspace-root level, not just per-Project. A separate,
  smaller workspace switcher (picking among multiple registered workspaces) sits alongside this
  screen, likely near `Main.tsx`'s left rail — exact placement is an implementation-time UI call.
  List screens for other entity kinds (`CustomizationListScreen`, `InstructionsScreen`) keep reading
  from whichever workspace is currently active, with no explicit switching inside those screens
  themselves. The `Project` picker used inside the Instruction editor (replacing the old free-text
  `repoPath` field) is unchanged from the original design.

This spec's `resolveScopePath` and the `SessionAnchor` generalization (§2.12) both bear on the
(separately in-progress) embedded-sessions design: `SessionService.resolveCwd` currently
special-cases `isProjectInstruction(entity) → entity.repoPath` and takes only an `entityUrn`; it
needs to move to accepting a `SessionAnchor` and resolving workspace/project anchors directly, and
entity anchors via `resolveScopePath(entity)`. Flagging the dependency and the signature change; not
re-designing the rest of that spec here — a short superseded-note has been added to its decision #2
pointing back at this section.

## 4. Data flow

1. **App start:** main reads `~/.ai-companion/workspaces.json` (self-seeding the default entry if
   the file doesn't exist yet) → resolves the active workspace → wires the workspace-scoped service
   graph against `activeWorkspace.rootPath`.
2. **Create a workspace:** author picks a folder via `workspace.pickFolder` (native OS dialog,
   arbitrary location) → `workspace.create` → `WorkspaceBootstrapService.create(rootPath)` seeds the
   `.ai-companion` subtree there → the registry gains an entry.
3. **Switch active workspace:** `workspace.switchTo(id)` → `SessionService.killAll()` for the
   outgoing workspace's live sessions → composition root rebuilds the workspace-scoped graph against
   the new `rootPath` → renderer re-fetches skills/agents/instructions/projects as if the app had
   reopened inside the new workspace.
4. **Browse the active workspace:** renderer opens the Workspace screen → `workspace.listDir({})`
   lists the root → the author expands a folder node → another `listDir({ path })` call lists that
   subfolder on demand → clicking a file calls `workspace.readFile({ path })` and renders the preview
   pane, or the "not previewable" placeholder for binary/oversized files.
5. **Create a project:** from the browser, the author picks a folder node and chooses "Use as
   Project" (§2.11) — name pre-filled from the folder name, editable — or supplies a path directly →
   `project.create` → persisted to that workspace's `projects.json`.
6. **Create/edit a project-scoped instruction:** author picks a `Project` from a list scoped to the
   active workspace (replacing today's free-text repo path field) → entity saved with
   `scopes: ['project']`, `scopeId: project.id` → `EntityService.save()` → adapter sync calls
   `resolveScopePath` to get the concrete path for symlink/materialize destinations.
7. **Open a session from the Workspace screen:** author clicks "Open session" at the workspace-root
   level or on a specific `Project` row → renderer calls
   `session.spawn({ anchor: { kind: 'workspace', workspaceId } })` or
   `{ kind: 'project', projectId }` → `SessionService` resolves the cwd (workspace root or project
   path) and reuses/spawns the PTY exactly as the entity-anchored flow does today.
8. **Read path, legacy migration:** `instruction.list`/`.get()` finds an entity with the old on-disk
   `repoPath` and no `scopeId` → finds-or-creates a matching `Project` (deduped by exact path) under
   the default workspace → backfills and persists `scopes`/`scopeId` → returns the migrated shape.
   `repoPath` is dropped from the sidecar on that write.

## 5. Error handling

- Creating a Workspace/Project at a path with filesystem permission errors → `DomainError('io', …)`,
  same convention `FsWorkspaceBootstrap` already uses.
- Deleting a Workspace or Project still referenced by any entity's `scopeId` → blocked with a
  validation error. No cascade delete — avoids silently orphaning instructions.
- Deleting the currently **active** workspace → blocked; the author must switch away first.
- `resolveScopePath` given a `scopeId` that no longer resolves (its Project/Workspace was deleted
  through some path that didn't catch the reference — e.g. direct file edit) → throws
  `DomainError('not_found')` at sync/spawn time, surfaced as a failure rather than silently syncing
  to a stale or empty path.
- `workspace.listDir`/`workspace.readFile` given a path that resolves outside the active workspace's
  `rootPath` (`..` traversal, an absolute path, or a symlink escaping the root) → rejected with a
  validation `DomainError` before touching the filesystem outside that boundary.
- `workspace.readFile` on a binary file or one over the preview size cap → returns
  `{ previewable: false, reason }` rather than raw/garbled bytes; the UI shows a placeholder, not an
  error.
- `session.spawn` with a `workspace`/`project` anchor whose target was deleted or moved outside the
  app between listing and spawning → the same `not_found` failure path as `resolveScopePath` above,
  now also reachable from this anchor kind.
- Lazy migration path collision (two distinct legacy `repoPath` values would auto-derive the same
  `Project` slug) → the second gets a numeric suffix, same convention already used for
  `projectInstructionSlug` uniqueness today.
- Not addressed by this spec: unsaved renderer edits at the moment of a workspace switch. Flagging as
  a likely follow-up rather than asserting behavior this spec doesn't design.

## 6. Testing

- `node` project: `WorkspaceService`/`ProjectService` unit tests against a fake JSON-file store
  (mirrors the existing fake-port/fake-repository pattern used throughout `tests/main/`).
- `resolveScopePath` unit tests covering all three scope kinds, including the not-found path.
- `FileBrowserService` unit tests against a fake `FileBrowserPort`: happy-path list/read, and the
  containment guard rejecting `..`/absolute/symlink-escape paths.
- `InstructionService` tests covering the flattened single-shape validation (personal-singleton rule,
  project/workspace `scopeId` requirement) and the lazy migration (a `repoPath`-only fixture ends up
  with a backfilled `scopeId` and a matching `Project`).
- IPC handler tests for `workspace.*` (including `listDir`/`readFile` param validation and
  boundary-rejection) and `project.*`, following the existing `_validators.ts` +
  `typed-handlers.test.ts` pattern.
- `SessionService` tests extended to spawn/reuse/kill across all three `SessionAnchor` kinds, plus the
  not-found path for a stale workspace/project anchor.
- Composition-root re-wiring on switch: rather than driving this through Electron's real `app`/
  `BrowserWindow`, extract the wiring block into a plain function and test that invoking it twice
  with different roots produces two independent, non-leaking service graphs.
- `jsdom`: the new Workspace screen — Project list, folder tree expand/collapse (mocked
  `workspace.listDir`), file preview pane including the not-previewable placeholder (mocked
  `workspace.readFile`), "Use as Project" and "Open session" actions; plus the workspace switcher and
  the Project picker inside the Instruction editor.

## 7. Explicitly out of scope (for this spec)

- Writing, renaming, deleting, or moving files/folders from the UI — browsing and read-only preview
  only; the workspace tree is not a file manager.
- A code-editing surface (syntax highlighting, saving edits) — preview is plain read-only text. Full
  editing is the part of "replace the code editor" that stays deferred, not this spec.
- File search across the tree.
- Binary/media preview (images, PDFs, etc.) — shown as "not previewable," no rendering support added.
- Skill/Agent editor UI for choosing a workspace/project scope — the schema unlocks in this slice
  (§2.7), but their editors keep validating `['personal']` only until a later pass.
- Cascading updates when a Workspace's or Project's path changes after creation (e.g. the folder was
  moved on disk outside the app) — not designed here; flag as a follow-up if it comes up.
- More than one workspace active/mounted concurrently — explicitly rejected in favor of the
  single-active-workspace model (§2.3).
- Rewriting `docs/explanation/prd.md` or `new-version.md` to reflect this direction — both are
  already known to be stale (the embedded-sessions spec flagged the PRD; `new-version.md` is the
  author's own in-progress draft), but revising them is separate work from this design.
