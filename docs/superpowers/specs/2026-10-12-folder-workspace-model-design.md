# Folder = Workspace — two-level scope model

**Date:** 2026-10-12 · **Type:** domain refactor (model + migration) · **Cycle:** 1 of 2

Cycle 2 (separate spec) consolidates the Home/Workspace UI/UX on top of this model. This cycle changes
**no visuals**: the renderer only swaps `projectId` for the active workspace and keeps today's UI working.

## Goal

Simplify the scope model from three levels (`personal` · `workspace` · `project`) to two:

- **Global** — `~/.ai-companion`, always loaded; what the app calls "Início".
- **Workspace** — any folder. Opening a folder opens it as a workspace.

The `Project` concept is removed. Decided in a visual-companion session (2026-10-12).

### Why

- `project` and `workspace` scopes already materialize to the same place — `<folder>/.claude/`,
  `<folder>/AGENTS.md` via `resolveScopePath` (`src/main/application/resolve-scope-path.ts`). The only
  difference was *where the canonical file is stored* (the parent workspace's data dir) and an extra
  registry (`projects.json`) per workspace.
- The default workspace (`rootPath = ~`) materializes its `workspace` scope to `~/.claude/` — the same
  destination as `personal`. It is Global in everything but name.
- Today there is **one** `FsEntityRepository` per active data dir
  (`src/main/application/workspace-scoped-services.ts:124`), so a `personal` entity saved while workspace X
  is active is stored in X's data dir, and the set of "global" entities changes with the active workspace.

## Decisions

| # | Decision |
|---|---|
| 1 | Two scopes: `personal` (Global) and `workspace`. `Project` is deleted. |
| 2 | A workspace is any folder. Nesting is allowed (a workspace inside another's folder); there is **no** parent/child relation — each workspace is independent. |
| 3 | Global is not a workspace. `Workspace.isDefault` is removed; `activeWorkspaceId: string \| null`, `null` = Início/Global. |
| 4 | Two composed entity repositories: Global (`~/.ai-companion`) for `personal`, the active workspace's `<root>/.ai-companion` for `workspace`. |
| 5 | Existing data is migrated automatically, once, at boot (option A). |

## Design

### 1. Types and IPC

- `src/shared/workspace.ts` — `Workspace` drops `isDefault`. `WorkspaceRegistryFile` gets
  `schemaVersion: 2` and `activeWorkspaceId: string | null`.
- **Removed:** `src/shared/project.ts`, `ProjectService`, `FsProjectRegistry`, every `project.*` IPC
  method, `<root>/.ai-companion/projects.json`, `projectIndexMarkerPath()`.
- **New IPC:**
  - `workspace.open({ path })` — find a workspace by real path (`realpath`, trailing slash stripped) or
    create it (name = folder basename), then activate it. Returns the `Workspace`. `path` must be an
    existing directory and must not be the home dir (`validation` error — that is Global).
  - `workspace.goHome()` — sets `activeWorkspaceId = null`, tears down the workspace-scoped service graph.
- `workspace.switchTo` keeps its contract for an existing id. `workspace.delete` of the active workspace
  goes home first.
- **Entity scope** (`src/shared/entity.ts`): `scopes` is `['personal'] | ['workspace']`; `scopeId` is
  required for `workspace` and is a `Workspace.id`. `isProjectInstruction` is removed;
  `InstructionSidecar.scope` narrows to `'workspace'`. Instruction storage keeps its current layout
  (`instructions/project/<slug>/{INSTRUCTION.md,meta.json}`, already shared by project and workspace scope
  — the `project/` dir name is legacy and not renamed here, to avoid churn). Any number of instructions
  per workspace, as today. `PersonalInstruction` unchanged.
- **Session anchor** (`src/shared/session.ts`): `{ kind: 'personal' } | { kind: 'workspace'; workspaceId }`.
  **History scope** (`src/shared/session-history.ts`): `{ kind: 'workspace'; workspaceId } | { kind: 'all' }`.
- **Git** (`src/shared/git.ts`): `projectId` is removed from every `git.*` param; the target is always the
  active workspace root. With no active workspace, `git.*` returns `validation`.
- **Launch configs** (`src/shared/launch-config.ts`): `ProjectLaunchConfigs` → `WorkspaceLaunchConfigs`
  (one `.vscode/launch.json`, at the workspace root); `LaunchProcessSnapshot.projectId` → `workspaceId`.
  Behavior change: a former multi-project workspace no longer aggregates its projects' launch files —
  open the sub-folder as its own workspace.
- **Harness-native scopes** keep their names (MCP `project-local` / `project-shared`, plugin `project`
  scope): they are Claude Code vocabulary, not ours. They now resolve against the **active workspace
  root** instead of `process.cwd()` in `src/main/index.ts` (fixes the backlog bug). With no active
  workspace those tiers are not offered.

### 2. Storage — composed repositories

- **`GlobalServices`**, built once at boot over `~/.ai-companion`: workspace registry, settings, plugins,
  marketplaces, credentials, and an `FsEntityRepository` holding only `personal` entities.
- **`WorkspaceScopedServices`** (`buildWorkspaceScopedServices`), rebuilt on every activation over
  `<root>/.ai-companion`: an `FsEntityRepository` holding only `workspace` entities, plus sessions, git,
  launch configs, file browser, health for that root. Absent while `activeWorkspaceId === null`.
- `EntityRepository` is unchanged as a port. `EntityService` takes both repositories and routes
  `save`/`delete`/`get` by `scopes[0]`; `list` returns Global ∪ active workspace. Saving a `workspace`
  entity with no active workspace, or with `scopeId` ≠ active workspace id, is a `validation` error.
  Changing an entity's scope moves the file between repositories (delete + save) and cleans the old
  destination via the existing rename path.
- `FsEntityRepository` asserts on write that the entity's scope matches the repository's role
  (`personal` | `workspace`) — a guard against routing bugs.
- `EntityWatchService` watches both data dirs (Global for the app's lifetime; the workspace one per
  activation).
- `WorkspaceBootstrapService` keeps creating `<root>/.ai-companion/` + `index.md` for each workspace on
  creation and on activation (self-heal).

### 3. Migration — `WorkspaceModelMigration` (runs once, idempotent)

Runs in `src/main/index.ts` **before** any service graph is built, when `workspaces.json` has no
`schemaVersion` or `schemaVersion < 2`. Implemented as an application service over ports (filesystem via
an `fs`-backed infrastructure adapter), so it is testable with directory fixtures.

1. **Backup** — copy `workspaces.json` and every `projects.json` and entity file it will touch to
   `~/.ai-companion/_backups/migration-v2-<timestamp>/`, preserving relative paths.
2. **Projects → workspaces** — for every workspace's `projects.json` (unreadable/corrupt → logged and
   skipped, as `WorkspaceTeardownService` already does): resolve `realpath(project.path)`; skip it if it is
   the home dir; otherwise reuse the workspace with that root or register a new one (keep `project.name`).
   Build a map `projectId → workspaceId`.
3. **Project-scoped entities** — for each `skill`/`agent` with `scopes: ['project']`: rewrite to
   `scopes: ['workspace']`, `scopeId = map[scopeId]`, and move the canonical files from the parent's data
   dir into the target workspace's data dir. A dangling `scopeId` (project already gone) → file moved to the
   backup folder, logged.
4. **Project instructions** — every `instructions/project/<slug>/` whose sidecar has `scope: 'project'`
   moves to the same relative path in the target workspace's data dir with `scope: 'workspace'` and the
   mapped `scopeId`. A slug collision in the target gets a `-2` suffix (logged). Legacy sidecars with only
   `repoPath` (pre-`scopeId`) are rescoped by matching `realpath(repoPath)` against workspace roots
   (creating one if none matches, same rule as step 2).
5. **Old default workspace** — its `workspace`-scoped entities become `personal` (their destination,
   `~/.claude/`, is unchanged). It is removed from the registry; its data dir *is* the Global data dir.
6. **Stray personal entities** — `personal` entities found in a non-home workspace's data dir move to
   Global. On a name collision the Global copy wins; the stray one stays in the backup folder and is
   listed in the migration log.
7. **Project index markers** — delete each `<project.path>/.ai-companion/index.md` **symlink** (only if it
   is a symlink into a workspace data dir); bootstrap of the new workspace writes a real one. Delete every
   `projects.json`.
8. **Commit** — write `workspaces.json` with `schemaVersion: 2`, `activeWorkspaceId: null` (or the
   previously active id if it still exists), atomically, **last**. Then run a full `AdapterManager.syncAll()`
   for Global and for each workspace touched so symlinks point at the moved canonical files.

Failure in steps 2–7 aborts before step 8, so the next boot retries from the original files (each step is
idempotent: moves check the destination first). The app opens the existing `IoError` screen with the
error and the backup path. The migration log is written to `~/.ai-companion/_backups/migration-v2-<ts>/log.json`.

Runtime state with `projectId` (live session anchors, launch processes, renderer tab ids) is not persisted
and needs no migration.

### 4. Renderer (minimal, no redesign)

- Remove `useProjects` & co, `viewMode`, `selectedProjectId`, the "usar como projeto" action and the
  multi-project tree branch. The folder tree's "Usar como projeto" becomes **"Abrir como workspace"**
  (`workspace.open`).
- "Início" calls `workspace.goHome()`. With `activeWorkspaceId === null` the existing screen renders what
  the default workspace showed today (Global entities, workspace list, pinned Starter Pack / Marketplaces /
  Diagnóstico) without the file tree. Workspaces show only their own entities, with the existing "mostrar
  globais" toggle.
- Tab ids drop the `projectId` segment. Workspace history entries drop `projectId`.
- No layout, styling or navigation redesign — that is cycle 2.

## Non-goals

- Home/Workspace UI/UX consolidation (cycle 2).
- Concurrent workspaces / keeping sessions alive across a switch.
- The "adapter targets are not reconciled on switch" known gap — unchanged (but note: with personal
  entities now in Global, switching no longer changes the personal set, which shrinks that gap).
- Hooks and MCP becoming Entity-backed.

## Testing

- **Migration (TDD, directory fixtures under a temp home):** project → new workspace; dedup by realpath
  (two projects, same folder; project == existing workspace root); project at `~` dropped; project-scoped
  skill/agent moved + rescoped; project instruction moved + rescoped, incl. slug collision and legacy
  `repoPath` sidecar;
  old default's workspace entities → personal; stray personal entity collision; dangling `scopeId`;
  corrupt `projects.json` skipped; failure mid-way leaves `schemaVersion` unset and a re-run converges;
  second run is a no-op.
- **`EntityService`:** routes by scope; `list` merges both; workspace save with no active workspace /
  mismatched `scopeId` rejected; scope change moves the file.
- **`workspace.open`:** existing path, new path, nested path, home dir rejected, non-directory rejected,
  symlinked path deduped.
- **IPC:** `project.*` gone (`not_found`), `git.*` without active workspace → `validation`.
- **Renderer:** existing workspace screen tests updated for no-project; "Abrir como workspace" calls
  `workspace.open`; Início with `activeWorkspaceId === null`.
- Gate: `npm run lint`, `npm run typecheck`, `npm test` green.

## Docs to update

`docs/reference/architecture.md` (Workspace / Project section → Global / Workspace; services list),
`docs/reference/ipc-contract.md` (`project.*` removed; `workspace.open`/`goHome`; git/launch params),
`docs/reference/customization-schema.md` (scopes, `WorkspaceInstruction`), `docs/explanation/harness-model.md`
(scope vocabulary), affected `docs/how-to/` pages, and `CLAUDE.md` (Entity model bullet — it still
describes `Instruction` as a `PersonalInstruction | ProjectInstruction` union with `repoPath`, which the
code already no longer matches).
