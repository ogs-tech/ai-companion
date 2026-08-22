# Workspace / Project Scoping — Design

- **Date:** 2026-08-22
- **Status:** Design approved by author; pending implementation plan.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Introduce `Workspace` and `Project` as first-class, non-synced concepts, and replace
  Instruction's closed `PersonalInstruction | ProjectInstruction` union with a single, generic
  scoping mechanism (`scopes` + `scopeId`) shared across `Entity`. This is the data-model foundation
  for expanding Instruction (and, later, Skill/Agent) beyond "personal singleton" and "one repo root"
  — it does not build any file browser, embedded editor, or Skill/Agent scope-picking UI.

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

That longer-term ambition is explicitly **not** part of this spec (see §7). What this spec covers is
the foundation it would sit on: a `Workspace`/`Project` data model, and a generic entity-scoping
mechanism that both requires and enables it. The author's stated principle for sequencing this work
was "criar a base e evoluir aos poucos" (build the base, evolve incrementally) — this spec is that
base.

## 2. Decisions made during brainstorming

1. **Workspace is plural, not the app's one fixed directory.** Today `~/.ai-companion/` is a single
   hardcoded root (`WorkspaceBootstrapService.create(workspacePath)`, called once in
   `src/main/index.ts`). Going forward, `Workspace.rootPath` is any folder on disk the author picks;
   the app's own data (skills/agents/instructions) lives inside it at `<rootPath>/.ai-companion/`.
   The existing default is unchanged by this: for the default workspace, `rootPath` is the user's
   home directory, so its data dir is exactly today's `~/.ai-companion/` — **no physical migration
   for the default case.**
2. **Storage is per-workspace, not centralized.** Explicitly confirmed over the alternative (one
   shared entity store with Workspace/Project as a pure index) — each workspace has its own
   independent skills/agents/instructions storage, mirroring how a code editor's multi-root
   workspaces keep separate local config per root. This reuses `WorkspaceBootstrapService` and
   `FsEntityRepository` completely unchanged — both already take an arbitrary root path.
3. **One active workspace at a time.** Not all workspaces are mounted simultaneously; switching is
   closer to opening a different project in an IDE than to a multi-window model. Switching
   reconstructs the workspace-scoped slice of the main-process service graph (`FsEntityRepository`,
   `EntityService`, `AdapterManager`, `SymlinkManager`, `FileMaterializer`, `InstructionService`,
   `SessionService`, etc. — everything `src/main/index.ts` currently wires once against a single
   `workspacePath`) against the new root, and kills any live `claude` sessions belonging to the
   outgoing workspace first (`SessionService.killAll()`, same mechanism already built for
   `before-quit` per the embedded-sessions design).
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
- **IPC:** `workspace.*` (`list`, `create`, `switchTo`, `delete`, `pickFolder`) and `project.*`
  (`list`, `create`, `update`, `delete`), both following the existing request/response envelope and
  `_validators.ts` convention. `workspace.pickFolder` wraps Electron's folder-picker dialog, needed
  since creating a non-default workspace means choosing a real directory.
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
- **Renderer:** a workspace switcher (top-level, likely alongside `Main.tsx`'s left rail — exact
  placement is an implementation-time UI call, not fixed by this spec), and a `Project` picker
  component used inside the Instruction editor wherever `repoPath` used to be a free-text field.
  List screens (`CustomizationListScreen`, `InstructionsScreen`) read from whichever workspace is
  currently active — no explicit workspace switching inside those screens themselves.

This spec's `resolveScopePath` supersedes the working-directory resolution the (separately
in-progress) embedded-sessions design gives `SessionService.resolveCwd` — that method currently
special-cases `isProjectInstruction(entity) → entity.repoPath`, and needs to move to
`resolveScopePath(entity)` once this lands. Flagging the dependency; not re-designing that method
here.

## 4. Data flow

1. **App start:** main reads `~/.ai-companion/workspaces.json` (self-seeding the default entry if
   the file doesn't exist yet) → resolves the active workspace → wires the workspace-scoped service
   graph against `activeWorkspace.rootPath`.
2. **Create a workspace:** author picks a folder via `workspace.pickFolder` → `workspace.create` →
   `WorkspaceBootstrapService.create(rootPath)` seeds the `.ai-companion` subtree there → the
   registry gains an entry.
3. **Switch active workspace:** `workspace.switchTo(id)` → `SessionService.killAll()` for the
   outgoing workspace's live sessions → composition root rebuilds the workspace-scoped graph against
   the new `rootPath` → renderer re-fetches skills/agents/instructions/projects as if the app had
   reopened inside the new workspace.
4. **Create a project:** author names it and picks/creates a folder (typically under the active
   workspace's `rootPath`) → `project.create` → persisted to that workspace's `projects.json`.
5. **Create/edit a project-scoped instruction:** author picks a `Project` from a list scoped to the
   active workspace (replacing today's free-text repo path field) → entity saved with
   `scopes: ['project']`, `scopeId: project.id` → `EntityService.save()` → adapter sync calls
   `resolveScopePath` to get the concrete path for symlink/materialize destinations.
6. **Read path, legacy migration:** `instruction.list`/`.get()` finds an entity with the old on-disk
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
- Lazy migration path collision (two distinct legacy `repoPath` values would auto-derive the same
  `Project` slug) → the second gets a numeric suffix, same convention already used for
  `projectInstructionSlug` uniqueness today.
- Not addressed by this spec: unsaved renderer edits at the moment of a workspace switch. Flagging as
  a likely follow-up rather than asserting behavior this spec doesn't design.

## 6. Testing

- `node` project: `WorkspaceService`/`ProjectService` unit tests against a fake JSON-file store
  (mirrors the existing fake-port/fake-repository pattern used throughout `tests/main/`).
- `resolveScopePath` unit tests covering all three scope kinds, including the not-found path.
- `InstructionService` tests covering the flattened single-shape validation (personal-singleton rule,
  project/workspace `scopeId` requirement) and the lazy migration (a `repoPath`-only fixture ends up
  with a backfilled `scopeId` and a matching `Project`).
- IPC handler tests for `workspace.*`/`project.*`, following the existing `_validators.ts` +
  `typed-handlers.test.ts` pattern.
- Composition-root re-wiring on switch: rather than driving this through Electron's real `app`/
  `BrowserWindow`, extract the wiring block into a plain function and test that invoking it twice
  with different roots produces two independent, non-leaking service graphs.
- `jsdom`: the workspace switcher component and the Project picker inside the Instruction editor.

## 7. Explicitly out of scope (for this spec)

- Any in-app file browser or embedded code-editing surface — the "replace the code editor" ambition
  this Workspace concept is ultimately in service of. This spec is the data-model foundation only;
  that UI is a separate, later spec.
- Skill/Agent editor UI for choosing a workspace/project scope — the schema unlocks in this slice
  (§2.7), but their editors keep validating `['personal']` only until a later pass.
- Cascading updates when a Workspace's or Project's path changes after creation (e.g. the folder was
  moved on disk outside the app) — not designed here; flag as a follow-up if it comes up.
- More than one workspace active/mounted concurrently — explicitly rejected in favor of the
  single-active-workspace model (§2.3).
- Rewriting `docs/explanation/prd.md` or `new-version.md` to reflect this direction — both are
  already known to be stale (the embedded-sessions spec flagged the PRD; `new-version.md` is the
  author's own in-progress draft), but revising them is separate work from this design.
