---
title: Architecture
description: Hexagonal layout of ai-companion — main, preload, renderer, and the ports/adapters split inside the main process.
---

# Architecture

ai-companion is an Electron app with three processes (**main**, **preload**, **renderer**) and a hexagonal split inside the main process.

## Process layout

```
src/
├── main/         # Node.js side — domain, services, file system, IPC
├── preload/      # Bridge — exposes a typed API to the renderer
├── renderer/     # React UI
└── shared/       # Types shared across processes
```

Build is driven by `electron-vite.config.ts`: each process has its own entry and output bundle under `out/`.

## Hexagonal layers (main)

```
src/main/
├── domain/          # Pure types and value objects
│                    #   skill-id, agent-id, global-instruction-id, errors
├── application/
│   ├── entity/      # EntitySerializer — Entity ↔ Claude .md (flat frontmatter)
│   ├── ports/       # Interfaces — what the core needs from the outside
│   │                #   entity-repository.ts, adapter.ts, clock-port.ts, …
│   ├── services/    # Use cases (see below)
│   ├── schemas/     # Zod schemas — entity-schema.ts, hook.ts, …
│   └── markdown/    # pure frontmatter parse/serialize (no I/O)
├── infrastructure/  # Adapter implementations (filesystem, git, dialog, settings, …)
│                    #   infrastructure/entity/fs-entity-repository.ts implements EntityRepository
└── ipc/             # IPC handlers — wire services to renderer requests
```

The canonical `Entity` contract (`src/shared/entity.ts`) replaced the old polymorphic `Customization`/`CustomizationFrontmatter` model. Every entity has a `urn` (`urn:{kind}:{name}`), flat scalar fields (`name`, `description`, `scopes`, …) instead of a nested `frontmatter`/`body` pair, an `EntityMetadata` block (`version`, `tags?`, `createdAt`, `updatedAt`), and an `EntitySource` (`{ kind: 'workspace' }` or `{ kind: 'plugin'; pluginId; provenance }`). Three kinds are implemented today — `Skill` (`content`, `explicitOnly?`), `Agent` (`systemPrompt`, `model?`, `tools?`, `deniedTools?`), and `Instruction` — the last modelled as a **discriminated union** on `scopes`: `PersonalInstruction` (singleton, `name === 'default'`, `scopes === ['personal']`) or `ProjectInstruction` (per-repo, `scopes === ['project']`, `repoPath: string`). `EntityKind` also reserves `'mcp'` and `'hook'` for a future unification (Phase 1) — `hook-service` and `mcp-service` do **not** implement `EntityRepository` yet and are documented separately below. The old `command` kind is gone: a slash-command is now a `Skill` with `explicitOnly: true` (↔ frontmatter `disable-model-invocation: true`).

`EntitySerializer` (`application/entity/entity-serializer.ts`) renders/parses the Markdown ↔ `Entity` boundary: `renderEntityFile`/`parseEntityFile` handle flat frontmatter for `skill`/`agent`; `instruction` is **frontmatter-free** — the whole file is the body. For project/workspace instructions the sidecar metadata (`description`, `version`, timestamps, `scope`, `scopeId`) travels through a separate `meta.json` handed to `parseEntityFile` via `instructionSidecar` (a legacy, read-only `repoPath` is tolerated on parse for pre-`scopeId` data). `FsEntityRepository` (`infrastructure/entity/fs-entity-repository.ts`) implements the `EntityRepository` port (`list`/`get`/`save`/`delete`/`exists`) against `skills/<name>/SKILL.md`, `agents/<name>.md`, `instructions/default.md` (personal singleton), and `instructions/project/<slug>/{INSTRUCTION.md,meta.json}` (per project); the legacy `global-instructions/default.md` path is still tolerated on `get`/`exists` for backwards compatibility.

### Application services

Located at `src/main/application/services/`:

**Entity core:**
- `entity-service` (`EntityService`) — the shared use case behind every canonical entity: `save` (create/rename/update, stamping `metadata.createdAt`/`updatedAt`, syncing via `AdapterManager`) and `delete` (optionally removing symlinks first). Depends on the `EntityRepository` port, `ClockPort`, `AdapterManager`, and an optional `EntityValidator`.
- `entity-validator` (`EntityValidator`) — validates an `Entity` against the Zod schema for its `kind` (`skillEntitySchema` / `agentEntitySchema` / `instructionEntitySchema` in `application/schemas/entity-schema.ts`); throws `DomainError('validation', …, { errors: [{ path, message }] })` on failure. Replaced the old standalone `schema-validator.ts` (removed).
- `entity-plugin-helpers` — `collectPluginEntities` / `assertEntityNotPluginSourced`, shared by the skill/agent facades to merge in plugin-provided entities and block writes to plugin-sourced ones.

Per-entity facades (thin wrappers around `EntityService`, 1ª class):
- `skill-service` — CRUD over skills + provenance merge with installed plugins. A slash-command is now just a skill with `explicitOnly: true`; there is no separate command facade.
- `agent-service` — CRUD over agents + provenance merge.
- `instruction-service` — CRUD over the personal singleton plus every project instruction; `list`/`get`/`save`/`delete` all live here. Domain slugs are validated by `personalInstructionId` and `projectInstructionSlug` (`src/main/domain/instruction-id.ts`).
- `hook-service` — CRUD over hooks stored in `.claude/settings.json`. **Not** Entity-backed yet (Phase 1 target).
- `marketplace-service` — list/add/remove/refresh marketplaces (`extraKnownMarketplaces`).
- `plugin-provenance` — scans `_meta.json` and plugin dirs to map skills/agents to their providing plugin.

Plugin lifecycle:
- `plugin-service` — import, list, get, update, remove, toggle, createOwned, deleteOwned, publish.
- `plugin-installer`, `plugin-author-service`, `plugin-publisher`, `plugin-manifest-parser`, `marketplace-parser`.

Cross-cutting:
- `adapter-manager` — orchestrates all adapters (Claude, Cursor).
- `symlink-manager` — creates and reconciles symlinks.
- `file-materializer` — write-side twin of `symlink-manager` for **generated** files (e.g. Cursor's per-repo `AGENTS.md`): ownership is signalled by a marker comment on the file's first line (`GENERATED_FILE_MARKER`), so the app only overwrites/removes files it owns; a foreign file (no marker) is backed up before overwrite and never deleted. Backup scheme mirrors `symlink-manager`'s (`<workspace>/_backups/<ts>/<rel-path>`).
- `repo-service` — small git helpers (`detectGit`, `getCurrentBranch`) used when creating a new project instruction. The old global `settings.linkedRepos` list is gone, and the `repo.link` / `repo.unlink` / `repo.list` IPC methods were removed with it — a project entity now carries its own `repoPath` directly.
- `settings-service` — load/merge/persist settings.
- `workspace-bootstrap` — creates the `.ai-companion/` directory tree for the default workspace at startup, and again for every workspace as it's created (see `WorkspaceService.create()`); also writes the static `.ai-companion/index.md` marker (see the "Workspace / Project" section below).
- `workspace-service` — CRUD over `Workspace` registry entries plus `getActive`/`switchTo`; self-heals a dangling `activeWorkspaceId` (falls back to the default workspace and persists the correction) rather than throwing on `getActive()`.
- `project-service` — CRUD over `Project` registry entries scoped to the active workspace's data dir.
- `health-service` — aggregates `HealthCheck` results from collectors (MCP auth, MCP runtime, config-drift, symlink, generated-file) into a `HealthReport`; exposed via the `health.*` IPC namespace.
- **MCP (live-config broker):** `mcp-service` is NOT an `Entity`-backed facade. It reads/writes MCP
  servers directly in the real Claude files (`~/.claude.json` `mcpServers` and
  `projects[path].mcpServers`, `<repo>/.mcp.json`) via `FsMcpConfigStore`, reads plugin
  `.mcp.json` files read-only via `PluginMcpReader`, parks disabled inline servers in
  `McpDisabledStash`, and joins health from the read-only `ClaudeRuntimePort`. Writes are
  surgical, atomic, and backed up.

The polymorphic `Customization` model and its `customization-service` umbrella are **gone** — deleted along with the `Customization`/`CustomizationFrontmatter` types, the old customization repository, and the associated schemas. `EntityService` + `EntityRepository` took their place; the per-entity facades above wrap `EntityService` directly rather than an umbrella service. The `customization.*` IPC namespace was removed at the same time — the renderer's `CustomizationListScreen` component keeps its (now generic) name but calls the typed namespaces via a `listMethod` param.

### Tool adapters

The adapter implementations live under `src/main/infrastructure/adapters/`:

- `claude-adapter.ts` — resolves sync destinations per entity kind via `resolveEntityDestinations`, branching on `entity.scopes[0]`. For `personal`: `skill` → `~/.claude/skills/<name>` (dir), `agent` → `~/.claude/agents/<name>.md`, `PersonalInstruction` → **both** `~/.claude/CLAUDE.md` and `~/AGENTS.md`. For `project`/`workspace`, every entity kind (skill, agent, instruction alike) resolves its base path via `resolveScopePath(entity, { workspaceService, projectService })` instead of a stored path, then targets the same relative subpath: `<resolved path>/.claude/skills/<name>`, `<resolved path>/.claude/agents/<name>.md`, or `<resolved path>/{.claude/CLAUDE.md, AGENTS.md}` for instructions. All destinations use `strategy: 'symlink'`. A missing/dangling `scopeId` surfaces as a `DomainError` (`'internal'` for a missing scope, `'not_found'` if `resolveScopePath` can't resolve the referenced Project/Workspace) — `AdapterManager` degrades this to a per-entity `SyncResult` error rather than aborting the whole sync pass.
- `cursor-adapter.ts` — publishes into Cursor's native file surface, toggled by `settings.adapters.cursor` (default **off**), with the same `resolveScopePath`-driven `personal` vs `project`/`workspace` branching as the Claude adapter: `skill` → `~/.cursor/skills/<name>/` or `<resolved path>/.cursor/skills/<name>/` (dir, symlink), `agent` → the `.cursor/agents/<name>.md` equivalent (symlink). `PersonalInstruction` is materialized as a Cursor local plugin under `~/.cursor/plugins/ai-companion/` — a `.cursor-plugin/plugin.json` manifest and a `rules/personal-default.mdc` rule with `alwaysApply: true` — because Cursor loads plugin rules at startup and applies them to every conversation, which is the closest analogue today to Claude's home-level `CLAUDE.md`. Both of those plugin destinations carry a custom `ownershipMarker` (JSON key for the manifest, YAML key for the rule) and matching `ownershipCheck: 'includes'`. A `project`/`workspace`-scoped instruction is written to `<resolved path>/AGENTS.md` with no custom marker override — it relies on `FileMaterializer`'s default `GENERATED_FILE_MARKER` comment instead — so `FileMaterializer` refuses to touch a foreign file in every case.

Both implement the `Adapter` port at `src/main/application/ports/adapter.ts`. `AdapterDestination` is a discriminated union on `strategy`: `{ scope, destination, strategy: 'symlink' }` for symlink targets, or `{ scope, destination, strategy: 'write', content }` for generated files. `AdapterManager` branches on `strategy` when syncing: `symlink` destinations go through `SymlinkManager`; `write` destinations go through `FileMaterializer` (see above).

## Session bounded context

`src/main/application/ports/claude-session-port.ts` (`ClaudeSessionPort`) + `src/main/infrastructure/claude-cli/node-pty-session-adapter.ts` (`NodePtySessionAdapter`, backed by `node-pty` — the first native module in this codebase) spawn a real interactive `claude` CLI process per session inside a PTY, so the CLI's TUI renders correctly. `SessionService` (`src/main/application/services/session-service.ts`) owns the one-live-session-per-entity invariant, keyed by the entity's own `urn` (no separate generated session id), and resolves each session's working directory from the entity itself: a `ProjectInstruction` uses its own `repoPath`; every other entity kind (`Skill`, `Agent`, `PersonalInstruction`) uses the app's workspace root. `Session` is **not** a fourth `Entity` kind — it's ephemeral process state and never goes through `EntityRepository`; `SessionService` only reads entities (via `EntityService.get`) to resolve cwd.

The `session.*` IPC namespace (`src/main/ipc/session-handlers.ts`) exposes `spawn`/`write`/`resize`/`kill`/`status`/`list` over the normal request/response `ipc:call` envelope. `list` returns `SessionService.list()` — every `SessionSnapshot` currently in its in-memory map, running and exited alike, with no pruning; nothing ever removes an exited entry except a full `SessionService` rebuild. Streamed terminal output can't fit the request/response shape, so it travels over a second main→renderer push channel (`session:output` / `session:exit`, `src/shared/session.ts`) — see [ipc-contract.md](ipc-contract.md#push-channels-exception-to-requestresponse). Every live session's `claude` process is killed on `app.on('before-quit', ...)`, registered inside `wireIpc()` in `src/main/index.ts` (`SessionService.killAll()`) — `kill()` calls `ClaudeSessionPort.kill()` with no explicit signal, i.e. node-pty's own default (`SIGHUP` on Unix, not `SIGTERM`). `SessionService` is itself one of the workspace-scoped services rebuilt (empty) on every `workspace.switchTo`, with `killAll()` called on the outgoing instance first — so `session.list` is inherently scoped to the active workspace, and a session (running or exited) is gone the moment its workspace stops being active. There is no background daemon and no persistence; sessions do not survive a workspace switch or the app closing.

`SessionSnapshot` carries a `label` — the anchor's human-readable name (entity/workspace/project name) — resolved once at spawn time by the same lookup that resolves `cwd`, so a session can be displayed without a second round-trip to `EntityService`/`WorkspaceService`/`ProjectService`.

On the renderer side, `SessionPanel` (`src/renderer/components/SessionPanel.tsx`, wrapping `@xterm/xterm` + `@xterm/addon-fit`) is the one place that actually drives `session.spawn`/`write`/`resize` and reacts to the push channels; it's reused from two entry points: embedded directly in `CustomizationEditor` (an "Abrir sessão" button inside each entity's own editor, rendered only once the entity has been saved, i.e. `!isCreate`), and mounted per open tab inside `SessionsPanel` (`src/renderer/components/shell/SessionsPanel.tsx`), docked into `AppShell` — not scoped to `WorkspaceScreen` — so switching top-level Area never unmounts a running terminal. On mount, `SessionPanel` also calls `session.status` with the anchor's own key to reattach to a session already running server-side (e.g. spawned earlier, or from the other entry point) without requiring a manual "Abrir sessão" click.

`SessionFocusProvider` (`src/renderer/lib/session-focus-context.tsx`, mounted inside `AppShell`) is UI-only state — which sessions are "open" in the panel and which one has focus — kept out of react-query since it has no server round-trip of its own; `useSessionFocus().focusSession(anchor, label)` is the single entry point every "Abrir sessão" button and session-list row calls. `SessionsPanel` keeps **every** open tab's `SessionPanel` mounted for the panel's whole lifetime, toggling only `display`/`visible` on focus change — there's no server-side scrollback buffer (no daemon, no persistence — see above), so unmounting a backgrounded tab would lose its history; collapsing the panel (`sessions-panel-collapse`/`sessions-panel-expand`) hides the same way, without unmounting anything. `SessionFocusProvider` resets its open tabs when the active workspace changes, mirroring `SessionService` being rebuilt server-side on `workspace.switchTo`.

`SessionsTreeGroup` (`src/renderer/components/workspace/SessionsTreeGroup.tsx`, backed by `useSessions()` in `src/renderer/hooks/use-sessions.ts`) is a third, read-oriented entry point: a `TreeGroup` node listing every session `session.list` returns, across all three anchor kinds, with a "Mostrar sessões finalizadas" toggle filtering by `status` and a row click calling `focusSession` for that session's `anchor`/`label` — it never spawns anything itself, only browses and resumes. Because there's no push channel for "a session was spawned," `SessionPanel` invalidates `useSessions()`'s query (`sessionsQueryKey`) itself right after a successful `session.spawn`; `useSessions()` separately subscribes to the unfiltered `window.api.session.onAnyExit` listener so a session that dies in the background (its panel not focused) still drops out of the running count without user action.

**Native module caveat:** `node-pty` must be rebuilt against Electron's own Node ABI to run inside the app — wired into `predev`/`prebuild` as `npm run rebuild:native` (`electron-rebuild -f -w node-pty` via `@electron/rebuild`), not `postinstall` (see `package.json`). That rebuilt binary can't be loaded from plain-Node `vitest`, so `npm install` and `npm test` always see the binary built against the host Node ABI instead. Running `npm run dev` or `npm run build` leaves the binary rebuilt for Electron's ABI; run `npm install` (or `npm rebuild node-pty`) to restore the host build before running `npm test` again. Separately, `postinstall` runs `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` (harmlessly no-op on platforms without that file, via `2>/dev/null || true`): `npm install` sometimes resets the prebuilt helper binary's execute bit, which breaks `posix_spawnp` on macOS at spawn time.

## Workspace / Project

`Workspace` and `Project` are purely organizational — never an `EntityKind`, never routed through
`AdapterManager`, never materialized to `~/.claude/` or `~/.cursor/`. Both are flat JSON registries
following the `FsSettingsRepository` load/save/atomic-rename pattern:

- `~/.ai-companion/workspaces.json` — every known `Workspace` (`id`, `name`, `rootPath`, `isDefault`,
  `createdAt`) plus `activeWorkspaceId`. Always at this fixed location, seeded with the default workspace
  (`rootPath` = home dir) on first read. Owned by `WorkspaceService`.
- `<workspace.rootPath>/.ai-companion/projects.json` — every `Project` (`id`, `name`, `path`, `createdAt`)
  belonging to that workspace. Owned by `ProjectService`, re-pointed at a different file whenever the
  active workspace changes.

**`.ai-companion/index.md` marker.** Every workspace's data dir gets a static `index.md` at its root
(`This folder is managed by the AI Companion app…`), written by `WorkspaceBootstrapService.create()`
next to the `skills/`, `agents/`, `_backups/` subdirectories — path built by `workspaceIndexMarkerPath()`
in `src/shared/brand-paths.ts`, content interpolating `brand.displayName`. Every registered `Project`
gets a `<project.path>/.ai-companion/index.md` **symlink** (path from `projectIndexMarkerPath()`, same
file) pointing back at its owning workspace's canonical copy, created via `SymlinkManager` in
`ProjectService.create()` (and re-linked on `update()` if `path` changes, removed on `delete()`).
Since `WorkspaceBootstrapService.create()` only runs at workspace-creation time (see above), `src/main/index.ts`
also calls it defensively on every activation of a non-default workspace — at startup for
`activeDataDir` and inside `switchActiveWorkspace` — so a workspace that predates this marker (or a
future bootstrap addition) self-heals instead of `ProjectService` linking a Project to a canonical file
that doesn't exist yet. This is deliberately **not** routed through `AdapterManager` — Workspace
and Project aren't Entities, so there's no `resolveEntityDestinations` hook for them — which means the
marker is invisible to `AdapterManager.syncAll()`/health drift-checks (`SymlinkCollector`) and to
`countDestinations`/`planDestinations`; only `WorkspaceTeardownService.restore()` knows to clean it up
(iterates `ProjectService.list()`, tolerating a corrupt/unreadable registry by degrading to `[]` rather
than aborting the reset, before deleting the workspace dir, so factory reset doesn't leave
dangling symlinks in a user's repo). Marker creation/removal in `ProjectService` is best-effort (errors
are swallowed) since there's no `SyncResult`-style reporting surface for it yet.

`resolveScopePath(entity, { workspaceService, projectService })` (`src/main/application/resolve-scope-path.ts`)
maps a `project`/`workspace`-scoped entity's `scopeId` to a concrete absolute path at the point of use — the
Claude/Cursor adapters and `SessionService.resolveCwd` call it instead of reading a persisted path off the
entity, so a `Project`/`Workspace` renamed or repointed after entities reference it never leaves a stale
cached path behind.

Only one workspace is "active" at a time. `workspace.switchTo` kills the outgoing workspace's live
`claude` sessions, then rebuilds the Entity-backed service graph (`FsEntityRepository`, `AdapterManager`,
`SymlinkManager`, `FileMaterializer`, `EntityService`, `SkillService`, `AgentService`,
`InstructionService`, `SessionService`, `ProjectService`, `HealthService`, `WorkspaceTeardownService`)
against the new workspace's data dir via `buildWorkspaceScopedServices` (`src/main/application/workspace-scoped-services.ts`)
— see `src/main/index.ts`'s `switchActiveWorkspace`. Plugin installs, marketplaces, MCP config, and adapter
on/off settings stay anchored to the workspace active at app startup; they are not (yet) per-workspace.

**Known gap — adapter targets are not reconciled on switch.** `workspace.switchTo` rebuilds the
Entity-backed service graph but does not touch the adapter sync targets (`~/.claude/`,
`~/.cursor/`). `AdapterManager.syncAll()` only operates on the currently active workspace's
entities and does no pruning of stale symlinks/generated files left behind by a previously active
workspace. Concretely: after switching from workspace A to workspace B, `~/.claude/` keeps
pointing at A's entities until each entity is individually re-saved (or otherwise re-synced) under
B — there is no automatic cleanup, and `~/.claude/` can end up reflecting a union of every
workspace ever synced rather than only the currently active one. This is a known limitation, left
for a future plan to address.

### Workspace file browser and session anchoring

`FileBrowserPort` (`listDir`/`readFile`/`realpath`, implemented by `NodeFileBrowserAdapter` via
`node:fs/promises`) is wrapped by `FileBrowserService`, which resolves a caller-supplied path relative to
the active workspace's `rootPath` and rejects anything escaping it (`..`, an absolute path, or a symlink
resolving outside the root) before touching the filesystem. Read-only: no write/rename/delete/move
support. Re-created on every workspace switch, alongside the Entity-backed graph, but rooted at the raw
`rootPath` rather than `<rootPath>/.ai-companion` — it browses the author's real files, not the app's own
data.

The Workspace screen's folder tree can also be scoped to a single `Project` instead of the whole
workspace: clicking anywhere on a root-level folder row already registered as a `Project` (or its "Gerir
instructions" shortcut icon specifically) selects it, and the tree/preview switch to the
`project.listDir`/`project.readFile`/`project.resolvePath` IPC methods instead of `workspace.*`. Those
handlers resolve `projectId` via `ProjectService.get` and build a `FileBrowserService` on demand rooted at
that `Project`'s own `path` — same class, same containment guard, just a different root — so browsing
inside a `Project` can never escape its own folder. "Use as Project" (`FolderTree`'s per-folder action)
only renders on root-level (depth-0) folders of the *unscoped* workspace-root tree — a UI-only
restriction, not enforced by `ProjectService`, since the lazy `ProjectInstruction.repoPath` migration
(§2.9 of the workspace/project scoping design) can legitimately create a `Project` from any path, not just
workspace-root children. Once a root-level folder is already a registered `Project` (its resolved
`<workspaceRootPath>/<name>` matches a `Project.path`), `FolderTree` swaps that action for a "Gerir
instructions" shortcut (`NotebookPen` icon) that calls `onManageProject(projectId)` instead —
`WorkspaceScreen` wires this to `selectProject`, its only entry point into project scope (there is no
separate Projects list panel; `useProjects()` backs the tree's own matching and `ScreenHeader`, below).

`FolderTree` renders a single ".." row as its first entry, mirroring directory-navigation semantics for
the two scope levels it can be at: `onNavigateUp` (rendered only while `scopeProjectId` is set) steps back
out to the workspace-root tree, and `onNavigateHome` (rendered only when *not* scoped to a `Project`)
switches the active workspace back to Default — the two are mutually exclusive since a given `FolderTree`
instance is always either scoped or not, so only one ".." ever shows. `WorkspaceScreen` wires
`onNavigateUp` to clear `selectedProjectId` and `onNavigateHome` to `useSwitchWorkspace().mutateAsync
('default')`.

`Session`s can now anchor on an entity, a workspace, or a project (`SessionAnchor` in
`src/shared/session.ts`) — `SessionService` keys live sessions by `sessionAnchorKey(anchor)` instead of by
entity urn alone, so "one live session per anchor" replaces "one live session per entity". The Workspace
screen's `ScreenHeader` is itself scope-aware: with no `Project` selected it shows the active workspace's
name/path and an "Abrir sessão" action anchored on the workspace; once a `Project` is selected (via the
tree) it swaps to that `Project`'s name/path with "Abrir sessão" anchored on the project plus a "Remover"
action (`project.delete`, which also clears the selection back to workspace scope). Both, and the
entity-anchored flow from the Customization editor, go through the same `SessionService`/`session.spawn`
surface.

### Workspace switching navigation

Workspace switching/creation/removal is centralized on the Global (default) workspace's Visão Geral
screen — `WorkspaceManagementList` (`components/workspace/`) renders every registered workspace as a row
(no menu to open first), the active one marked and undeletable, others switchable by clicking the row and
deletable via a trash icon. There is no floating workspace switcher in `TopNav` anymore.

The top-level "Workspace" tab doubles as a "go home" gesture: `AppShell.selectArea` switches back to the
Default workspace (`useSwitchWorkspace().mutateAsync('default')`) whenever that tab is clicked while a
non-default workspace is active — so leaving a project workspace's tree always lands back on the
management list. The Visão Geral screen itself offers a second, more local entry point to the same
gesture: `FolderTree`'s `onNavigateHome` ".." row (see above) switches back to Default without leaving the
current screen. This relies on each `<Tab>` in `TopNav` carrying its own `onClick`, not `Tabs`' `onChange`:
MUI's `Tab` only calls `onChange` when the clicked tab isn't already selected (`Tab.js`'s `handleClick`),
so re-clicking the already-active `workspace` tab would otherwise be a no-op.

`WorkspaceScreen`'s `ScreenHeader` carries a "Remover workspace" action (an `IconButton`, next to "Abrir
sessão"), shown only when the active workspace isn't Default and no `Project` is selected — since the
backend refuses to delete the active workspace, this switches to Default first, then deletes the workspace
the action was invoked on, then lands on the management list. The target workspace is captured in local
state when the action opens (not read live off `useActiveWorkspace()`) so the confirmation dialog
(`WorkspaceRemoveConfirmDialog`) keeps naming it even as the switch resolves out from under it mid-flow.
This used to live in `SubRail`'s persistent workspace-identity strip; it moved onto the screen itself once
`SubRail` stopped rendering a Workspace section, and `SubRail` itself was later deleted outright once
Plugins — its last remaining consumer — folded into the Workspace tree too (see "Renderer structure"
below).

Switching workspaces invalidates the whole query cache (`queryClient.invalidateQueries()` with no filter)
rather than `clear()`ing it — `clear()` destroys queries without telling their still-mounted observers to
refetch, so screens stayed on stale data until something happened to force a remount.

### Instructions on Visão geral

There is no standalone Instructions screen — instruction management is inline on the Workspace screen's
Visão Geral, scoped to whatever the user is currently looking at:

- **Global workspace** → `PersonalInstructionCard` (`components/workspace/`) manages the Personal
  singleton (`scopes: ['personal']`) via `usePersonalInstruction()`.
- **Project workspace, no `Project` selected** → `ScopedInstructionCard` with `scopeKind="workspace"`
  manages one instruction scoped directly to the active `Workspace` (`scopes: ['workspace']`, `scopeId:
  workspace.id`, resolved by `resolveScopePath` to `workspace.rootPath`) via `useWorkspaceInstruction`.
- **Project workspace, a `Project` selected** (via `FolderTree`'s "Gerir instructions" shortcut, or
  clicking anywhere on that folder's row) → the same `ScopedInstructionCard`, `scopeKind="project"`,
  manages an instruction scoped to that `Project` (`scopes: ['project']`, `scopeId: project.id`) via
  `useProjectInstruction`.

Both scoped-instruction hooks (`hooks/use-instructions.ts`) `select` off the shared `useInstructionsList`
query cache instead of issuing their own IPC call. Creating one seeds a blank entity via
`seedWorkspaceInstruction`/`seedProjectInstruction` (`lib/instruction-seed.ts`) with a slugified `name`
and no folder picker — the scope's path is already known (`workspace.rootPath` / `project.path`). Opening
either card's "Configurar"/"Editar" swaps `WorkspaceScreen`'s whole body for `CustomizationEditor`, the
same full-screen-swap pattern the old Instructions screen used, with `scope` always hidden (personal also
hides `name`/`description`/`version` — the singleton's identity is fixed and its sidecar isn't persisted).
This required no backend/schema/adapter changes: `workspace`-scoped instructions were already documented
and implemented (`resolveScopePath`, `entity-schema.ts`, both adapters) — only the renderer had never
exercised that scope.

## Renderer structure

```
src/renderer/
├── App.tsx                 # View union: loading | main | settings | io-error
├── main.tsx
├── screens/                # Main.tsx routes by Nav
│   ├── workspace/ marketplaces/ health/ starter-pack/ settings/
│   ├── plugins/            # PluginDetail/PluginImportDialog/PublishPluginDialog — reused by
│   │                       # PluginsTreeGroup; no longer a routed screen of its own (no PluginList.tsx)
│   ├── Main.tsx            # root screen — maps Nav state to a screen component
│   ├── Settings.tsx
│   └── IoError.tsx         # generic retry screen for I/O failures
├── components/             # ds/ (design system), shell/ (TopNav, CommandPalette),
│                           # workspace/ (FolderTree, EntityTreeGroup, HooksTreeGroup, McpTreeGroup,
│                           # PluginsTreeGroup, SessionsTreeGroup, TreeGroup, ...), EntityDataGrid/
├── hooks/                  # react-query data hooks
└── lib/                    # ipc.ts, query-client.ts, theme-mode-context.tsx, instruction-seed.ts
```

There is no `instructions/` screen — instruction management is inline on the Workspace screen (see
"Instructions on Visão geral" above), via `InstructionTreeRow` under `components/workspace/`. There is no
`commands/` screen either — the `command` entity kind was removed too. There are no `skills/`, `agents/`,
`hooks/`, `mcps/`, or (as of the Plugins fold-in) top-level `plugins/` screens either — each kind is a
collapsible `TreeGroup` node (`EntityTreeGroup` for Skill/Agent, `HooksTreeGroup`, `McpTreeGroup`,
`PluginsTreeGroup`) rendered inline on `WorkspaceScreen`, pinned into `FolderTree` via its `pinnedRows` slot
(the same mechanism `instructionRow` already used) whenever a non-default workspace or a `Project` is in
view, or directly in the Default workspace's management `List` otherwise. Each group fetches its own data
(`skill.list`/`agent.list`/`hook.list`/`mcp.list`/`plugin.list`) and opens the same
`CustomizationEditor`/`CustomizationViewDrawer`/`McpEditorDialog`/`PluginDetail` (in a `DetailDrawer`) the
old standalone screens used — only the surrounding chrome (a dense tree row instead of a full-page
`EntityDataGrid`) changed. `PluginsTreeGroup` also owns the "Importar plugin" and "Publicar" actions
(`PluginImportDialog`/`PublishPluginDialog`, unchanged), previously toolbar buttons on the old `PluginList`
screen, now the group's `TreeGroup` header "+" action and a per-row overflow menu respectively.

`SessionsTreeGroup` follows the same slot placement (both `pinnedRows` and the Default workspace `List`)
but isn't part of the local/global partition the other groups apply — every session already belongs to the
active workspace by construction (see [Session bounded context](#session-bounded-context)), so there's no
"more global than this" bucket to hide. Its own visibility axis is session `status`, not scope: a
`showFinishedSessions` toggle in `ScreenHeader`'s `actions` (independent of, and always shown alongside,
the local/global `showGlobal` toggle) filters exited sessions in or out. A row click doesn't open
`CustomizationEditor`/`McpEditorDialog` like the other groups — it calls `useSessionFocus().focusSession`
for that session's `anchor`, the same callback the header's "Abrir sessão" buttons already call, which
focuses (or opens) that session's tab in the persistent `SessionsPanel` docked in `AppShell`.

Skill/Agent tree groups partition their list into "local" (the entity's `scopes[0]`/`scopeId` matches the
`Project`/`Workspace` currently in view) and "global" (everything else — Personal-scope, plugin-provided,
or scoped elsewhere) via an `EntityTreeGroupProps.localScope` prop; `HooksTreeGroup` and `McpTreeGroup`
apply the same local/global split on their own data shapes (Hooks have no scoping at all yet, so every hook
counts as global inside a project workspace; MCP's own `project-local`/`project-shared` scope is matched
against the current `Project.path`/`Workspace.rootPath` instead of an `Entity.scopeId`). `PluginsTreeGroup`
is coarser still: a plugin's own `scope` is `'personal' | 'project'` with no `scopeId`/path of its own — the
backend resolves `'project'` scope to whichever *Workspace* is currently active (`plugin-service` sits in
`workspace-scoped-services`, rebuilt on `workspace.switchTo`), not to whichever `Project` is selected inside
it — so unlike Skills/Agents/MCP, drilling into a specific `Project` within a workspace doesn't narrow the
Plugins list further; `isProjectContext` (true) vs. omitted plays the same "is a Workspace/Project in view
at all" role the other groups use, just without per-`Project` granularity. The global bucket is hidden by
default inside a non-default workspace and revealed by the "Mostrar/Ocultar globais" toggle in
`ScreenHeader`'s `actions` (`WorkspaceScreen`'s `showGlobal` state) — omitted entirely on the Default
workspace, where nothing is filtered.

Navigation is state-driven via a `Nav` discriminated union in `components/shell/nav.ts` (areas: `workspace`,
`starter-pack`, `marketplaces`, `diagnostico`); `Main.tsx` maps `Nav` to a screen. No `react-router`, and no
area carries a `sub` anymore — Skills/Agents/Hooks/MCP/Plugins all moved from standalone screens into the
tree nodes described above, so there is only ever one Workspace screen, and `SubRail` (which used to render
a Plugins/Marketplaces sub-list) has been deleted entirely along with the `sub` field on `Nav`. Marketplaces
isn't scoped to any Workspace/Project — it's a global plugin-source catalog, closer to Settings than to
workspace content — so instead of folding into the tree like Plugins did, it was promoted to its own
top-level tab, the same way Starter Pack was previously demoted from a Workspace sub into an ordinary page.
`defaultNav` lands on `{ area: 'workspace' }` — the `workspace` area is the app's home, so its top-nav tab
is labeled "Início" (glyph: house) rather than "Workspace" even though the `Area` key and routing are
unchanged.

## Data flow (typical user action)

1. The user triggers an action in a renderer screen — e.g. *save a skill*.
2. The renderer calls `callIpc('skill.save', payload)` exposed by **preload**.
3. `skill-handlers.ts` in `src/main/ipc/` invokes `SkillService`.
4. The service calls `EntityService`, which validates via `EntityValidator`, then calls the `EntityRepository` **port**; **infrastructure** (`FsEntityRepository`) does the I/O (file write, then `AdapterManager` syncs symlinks).
5. The result returns up the stack; the renderer re-renders.

Note: the `customization.*` IPC namespace has been removed. All entity operations now use typed namespaces (`skill.*`, `agent.*`, `instruction.*`, `hook.*`, etc.) — see [IPC contract](ipc-contract.md).

I/O failures bubble up to the `IoError` screen, which retries the failing step.

## Persistence

- **Entities** — `.md` files under the workspace folder. Skills at `skills/<name>/SKILL.md` and agents at `agents/<name>.md` keep YAML frontmatter. Instructions are frontmatter-free: the personal singleton at `instructions/default.md`, project/workspace instructions at `instructions/project/<slug>/INSTRUCTION.md` plus a sidecar `meta.json` (description, version, timestamps, `scope`, `scopeId`).
- **Settings** — JSON file managed by `settings-service`. The old global `linkedRepos` array was retired — project/workspace scope now lives on the entity itself (`scopes`/`scopeId`, resolved to a path via `resolveScopePath`).
- **Sync** — symbolic links from each adapter target into the workspace files, with two `write`-strategy exceptions:
  1. `PersonalInstruction` on the Cursor adapter materializes a small local plugin under `~/.cursor/plugins/ai-companion/` (a `plugin.json` manifest and an `alwaysApply: true` rule .mdc), marker-owned via `FileMaterializer` so foreign files stay untouched.
  2. `ProjectInstruction` on the Cursor adapter materializes a generated `<entity.repoPath>/AGENTS.md`, also marker-owned.
  Everything else is a symlink; the Claude adapter never uses `write`.

No database, no API, no telemetry.

## Plugin system

The plugin system extends the SDE customizations framework with package management: users can import third-party plugins, own and manage them locally, and publish their own contributions back to registries.

**Plugin lifecycle modes:**

- **Imported** — third-party plugins installed from a remote registry (GitHub, npm-compatible URL). Downloaded as `.tar.gz` and extracted into the workspace plugin folder. Identified by `registry` metadata.
- **Owned** — plugins authored locally and not tied to an external registry. Stored in the workspace plugin folder with `_meta.json` v2 schema (includes author, visibility, publish history).
- **Publish** — owned plugins pushed to a GitHub repository as a release. Registry entries published to a central manifest (`.tar.gz` + metadata).

**Core adapters** — located across `src/main/infrastructure/{git,github,plugins,settings,credentials}/`:

- `SimpleGitClient` (GitPort) — wraps **simple-git** for branch tracking, tag creation, remote operations.
- `PluginCacheFile` (PluginCachePort) — reads/writes `.json` plugin metadata cache.
- `ClaudeSettingsFile` (ClaudeSettingsPort) — manages `~/.claude/settings.json` to expose plugin modules.
- `OctokitClient` (GitHubApiPort) — wraps Octokit for GitHub API calls (repos, releases, token auth).
- `SafeStorageCredentials` (CredentialStorePort) — encrypts/decrypts GitHub PAT using Electron's safeStorage.

**Core services** — located at `src/main/application/services/` (flat, not nested):

- `PluginInstaller` — fetch, validate, extract, and cache imported plugins.
- `PluginAuthorService` — CRUD for owned plugins; manages `_meta.json` v2 authorship.
- `PluginPublisher` — tag releases, push to GitHub, publish registry entries.
- `PluginService` — unified interface for list, get, toggle, remove operations across import/owned modes.

**_meta.json v2 schema** — owned plugins carry full authorship and publish metadata:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "user@example.com",
  "description": "Plugin description",
  "visibility": "private" | "public",
  "publishedTo": [
    {
      "registry": "github",
      "url": "https://github.com/user/my-plugin-registry",
      "version": "1.0.0",
      "publishedAt": "2025-05-04T12:00:00Z"
    }
  ]
}
```

## See also

- [Getting started](../tutorials/getting-started.md) — to run the app first.
- [Entity schema](customization-schema.md)
- [IPC contract](ipc-contract.md)
- Why symlinks _(TBD)_
