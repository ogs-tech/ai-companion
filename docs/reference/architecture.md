---
title: Architecture
description: Hexagonal layout of ai-companion — main, preload, renderer, and the ports/adapters split inside the main process.
---

# Architecture

ai-companion is an Electron app with three processes (**main**, **preload**, **renderer**) and a hexagonal split inside the main process.

It exists to manage **harnesses** — the programs that turn a language model into an agent working on your code (Claude Code, Cursor). Two capabilities are declared per harness in `src/shared/harness.ts`: `manage` (this app owns that harness's customization files and materializes them into its config surface) and `run` (this app spawns and observes that harness's own sessions). Those two words partition most of what follows: "Harness adapters" and everything feeding `AdapterManager` are the `manage` side; the "Session" and "Session history" bounded contexts are the `run` side. Definition and boundary test in [harness-model.md](../explanation/harness-model.md).

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
│   ├── entity/      # EntitySerializer — Entity ↔ Claude .md (flat frontmatter);
│   │                #   ScopedEntityRepository — Global ∪ open-workspace store
│   ├── ports/       # Interfaces — what the core needs from the outside
│   │                #   entity-repository.ts, adapter.ts, clock-port.ts, directory-resolver.ts, …
│   ├── services/    # Use cases (see below)
│   ├── schemas/     # Zod schemas — entity-schema.ts, hook.ts, …
│   └── markdown/    # pure frontmatter parse/serialize (no I/O)
├── infrastructure/  # Adapter implementations (filesystem, git, dialog, settings, …)
│                    #   infrastructure/entity/fs-entity-repository.ts implements EntityRepository
└── ipc/             # IPC handlers — wire services to renderer requests
```

The canonical `Entity` contract (`src/shared/entity.ts`) replaced the old polymorphic `Customization`/`CustomizationFrontmatter` model. Every entity has a `urn` (`urn:{kind}:{name}`), flat scalar fields (`name`, `description`, `scopes`, …) instead of a nested `frontmatter`/`body` pair, an `EntityMetadata` block (`version`, `tags?`, `createdAt`, `updatedAt`), and an `EntitySource` (`{ kind: 'workspace' }` or `{ kind: 'plugin'; pluginId; provenance }`). Three kinds are implemented today — `Skill` (`content`, `explicitOnly?`), `Agent` (`systemPrompt`, `model?`, `tools?`, `deniedTools?`), and `Instruction` (`content`) — the last split by `scopes[0]` into the personal singleton (`name === 'default'`, `scopes === ['personal']`) and any number of workspace instructions (`scopes === ['workspace']`, `scopeId` = a `Workspace.id`), told apart by `isPersonalInstruction`/`isWorkspaceInstruction`. `Scope` is `'personal' | 'workspace'`: `personal` is Global (`~/.ai-companion`, the app's "Início"), `workspace` is one opened folder — see "Global / Workspace" below. `EntityKind` also reserves `'mcp'` and `'hook'` for a future unification (Phase 1) — `hook-service` and `mcp-service` do **not** implement `EntityRepository` yet and are documented separately below. The old `command` kind is gone: a slash-command is now a `Skill` with `explicitOnly: true` (↔ frontmatter `disable-model-invocation: true`).

`EntitySerializer` (`application/entity/entity-serializer.ts`) renders/parses the Markdown ↔ `Entity` boundary: `renderEntityFile`/`parseEntityFile` handle flat frontmatter for `skill`/`agent`; `instruction` is **frontmatter-free** — the whole file is the body. For workspace instructions the sidecar metadata (`description`, `version`, timestamps, `scope: 'workspace'`, `scopeId`) travels through a separate `meta.json` handed to `parseEntityFile` via `instructionSidecar`; a non-personal instruction without a `scopeId` fails to parse (the pre-`scopeId` `repoPath` shape is rescoped once by the boot migration, not tolerated at read time). `FsEntityRepository` (`infrastructure/entity/fs-entity-repository.ts`) implements the `EntityRepository` port (`list`/`get`/`save`/`delete`/`exists`/`filePath`) over **one** data dir against `skills/<name>/SKILL.md`, `agents/<name>.md`, `instructions/default.md` (personal singleton), and `instructions/project/<slug>/{INSTRUCTION.md,meta.json}` (workspace instructions — the `project/` directory name is legacy, kept to avoid churn); the legacy `global-instructions/default.md` path is still tolerated on `get`/`exists` for backwards compatibility. Each instance is built with a `role` (`'personal'` or `'workspace'`) and refuses to save an entity of the other scope (`DomainError('internal')`), dropping any such file from `list` — a guard against routing bugs, since the routing itself lives one level up in `ScopedEntityRepository` (`application/entity/scoped-entity-repository.ts`): Global's store (`~/.ai-companion`, `personal`) plus the open workspace's (`<root>/.ai-companion`, `workspace`; absent at Início). It routes `save` by `scopes[0]`, `list`s the union, and resolves `get`/`exists`/`filePath`/`delete` to the workspace copy first, then Global.

### Application services

Located at `src/main/application/services/`:

**Entity core:**
- `entity-service` (`EntityService`) — the shared use case behind every canonical entity: `save` (create/rename/update, stamping `metadata.createdAt`/`updatedAt`, syncing via `AdapterManager`) and `delete` (optionally removing symlinks first). Works over the `ScopedEntityRepository` (Global ∪ open workspace): a `workspace` entity is rejected (`validation`) with `details.reason` `no-active-workspace` at Início or `scope-id-mismatch` when its `scopeId` isn't the open workspace; names stay unique across both stores; a rename **or** a scope change removes the old copy and its adapter destinations (a scope change moves the canonical file between Global and the workspace data dir). Depends on `ScopedEntityRepository`, `ClockPort`, `AdapterManager`, and an optional `EntityValidator`.
- `entity-validator` (`EntityValidator`) — validates an `Entity` against the Zod schema for its `kind` (`skillEntitySchema` / `agentEntitySchema` / `instructionEntitySchema` in `application/schemas/entity-schema.ts`); throws `DomainError('validation', …, { errors: [{ path, message }] })` on failure. Replaced the old standalone `schema-validator.ts` (removed).
- `entity-plugin-helpers` — `collectPluginEntities` / `assertEntityNotPluginSourced`, shared by the skill/agent facades to merge in plugin-provided entities and block writes to plugin-sourced ones.

Per-entity facades (thin wrappers around `EntityService`, 1ª class):
- `skill-service` — CRUD over skills + provenance merge with installed plugins. A slash-command is now just a skill with `explicitOnly: true`; there is no separate command facade.
- `agent-service` — CRUD over agents + provenance merge.
- `instruction-service` — CRUD over the personal singleton plus the open workspace's instructions; `list`/`get`/`save`/`delete` all live here. Domain slugs are validated by `personalInstructionId` and `projectInstructionSlug` (`src/main/domain/instruction-id.ts` — the latter's name predates the two-scope model; it validates any non-personal slug).
- `hook-service` — CRUD over hooks stored in `.claude/settings.json`. **Not** Entity-backed yet (Phase 1 target).
- `marketplace-service` — list/add/remove/refresh marketplaces (`extraKnownMarketplaces`).
- `plugin-provenance` — scans `_meta.json` and plugin dirs to map skills/agents to their providing plugin.

Plugin lifecycle:
- `plugin-service` — import, list, get, update, remove, toggle, createOwned, deleteOwned, publish.
- `plugin-installer`, `plugin-author-service`, `plugin-publisher`, `plugin-manifest-parser`, `marketplace-parser`.

Cross-cutting:
- `adapter-manager` — orchestrates all adapters (Claude, Cursor). Takes `entityDataDir: (entity) => string` (wired to `ScopedEntityRepository.dataDirFor`) instead of a single workspace path, so each entity's symlink source and the "does this link point into our data dir?" checks resolve against the store that entity actually lives in (Global or the open workspace).
- `symlink-manager` — creates and reconciles symlinks.
- `file-materializer` — write-side twin of `symlink-manager` for **generated** files (e.g. Cursor's per-repo `AGENTS.md`): ownership is signalled by a marker comment on the file's first line (`GENERATED_FILE_MARKER`), so the app only overwrites/removes files it owns; a foreign file (no marker) is backed up before overwrite and never deleted. Backup scheme mirrors `symlink-manager`'s (`<global data dir>/_backups/<ts>/<rel-path>` — both always back up under Global's `~/.ai-companion/_backups/`, whichever workspace is open).
- `git-service` — the `git` IPC namespace's use cases over the open workspace root's own repository, through `RepoGitPort`. Built per activation with the open workspace (or `null`), so every call fails `validation` at Início; validates repo-relative paths and serializes mutations per repo root (reads bypass the queue). Replaced the old `repo-service` (`detectGit`/`getCurrentBranch`), which had no renderer caller.
- `settings-service` — load/merge/persist settings.
- `workspace-bootstrap` — creates the `.ai-companion/` directory tree for Global at startup, and for every workspace when it's registered and again on each activation (self-heal); also writes the static `.ai-companion/index.md` marker (see the "Global / Workspace" section below).
- `workspace-service` — the `Workspace` registry: `list`/`get`/`getActive` (`Workspace | null`, `null` = Início)/`create`/`open(path)`/`switchTo`/`goHome`/`delete`. Roots are stored as real paths through the `DirectoryResolver` port (`application/ports/directory-resolver.ts`, implemented by `NodeFsAdapter.realDirectory`), so a symlinked path or a trailing slash finds the same workspace; a non-directory or the home dir itself is rejected (`validation`, `details.reason` `not-a-directory` / `home-dir`), and `create` rejects a folder that already has one (`duplicate-root`). Self-heals a dangling `activeWorkspaceId` to `null` rather than throwing. It only persists the selection — tearing down and rebuilding the service graph is `WorkspaceActivation`'s job (see below).
- `workspace-model-migration` (`WorkspaceModelMigration`) — the one-time boot migration from the project-era three-level model to Global/workspace (see "Global / Workspace" below).
- `health-service` — aggregates `HealthCheck` results from collectors (MCP auth, MCP runtime, config-drift, symlink, generated-file) into a `HealthReport`; exposed via the `health.*` IPC namespace.
- **MCP (live-config broker):** `mcp-service` is NOT an `Entity`-backed facade. It reads/writes MCP
  servers directly in the real Claude files (`~/.claude.json` `mcpServers` and
  `projects[path].mcpServers`, `<repo>/.mcp.json`) via `FsMcpConfigStore`, reads plugin
  `.mcp.json` files read-only via `PluginMcpReader`, parks disabled inline servers in
  `McpDisabledStash`, and joins health from the read-only `ClaudeRuntimePort`. Writes are
  surgical, atomic, and backed up.

The polymorphic `Customization` model and its `customization-service` umbrella are **gone** — deleted along with the `Customization`/`CustomizationFrontmatter` types, the old customization repository, and the associated schemas. `EntityService` + `EntityRepository` took their place; the per-entity facades above wrap `EntityService` directly rather than an umbrella service. The `customization.*` IPC namespace was removed at the same time — the renderer's `CustomizationListScreen` component keeps its (now generic) name but calls the typed namespaces via a `listMethod` param.

### Harness adapters

`src/shared/harness.ts` is the registry of harnesses the app integrates with — id, display name, capabilities, and whether a fresh install syncs to it unasked. Default settings (`getDefaults`), settings validation (`assertValidSettings`) and the Settings screen's toggles all derive from it, so "which harnesses exist" is stated once. It is a pure data module in `shared/` because both the main process (defaults, validation) and the renderer (toggles) need it.

The adapter implementations — the `manage` side of that registry — live under `src/main/infrastructure/adapters/`:

- `claude-adapter.ts` — resolves sync destinations per entity kind via `resolveEntityDestinations`, branching on `entity.scopes[0]`. For `personal`: `skill` → `~/.claude/skills/<name>` (dir), `agent` → `~/.claude/agents/<name>.md`, `PersonalInstruction` → **both** `~/.claude/CLAUDE.md` and `~/AGENTS.md`. For `workspace`, every entity kind (skill, agent, instruction alike) resolves its base path via `resolveScopePath(entity, { workspaceService })` — the workspace's `rootPath` — instead of a stored path, then targets the same relative subpath: `<resolved path>/.claude/skills/<name>`, `<resolved path>/.claude/agents/<name>.md`, or `<resolved path>/{.claude/CLAUDE.md, AGENTS.md}` for instructions. All destinations use `strategy: 'symlink'`. A missing/dangling `scopeId` surfaces as a `DomainError` (`'validation'` for a missing `scopeId`, `'not_found'` if `resolveScopePath` can't resolve the referenced Workspace) — `AdapterManager` degrades this to a per-entity `SyncResult` error rather than aborting the whole sync pass.
- `cursor-adapter.ts` — publishes into Cursor's native file surface, toggled by `settings.adapters.cursor` (default **off**), with the same `resolveScopePath`-driven `personal` vs `workspace` branching as the Claude adapter: `skill` → `~/.cursor/skills/<name>/` or `<resolved path>/.cursor/skills/<name>/` (dir, symlink), `agent` → the `.cursor/agents/<name>.md` equivalent (symlink). `PersonalInstruction` is materialized as a Cursor local plugin under `~/.cursor/plugins/ai-companion/` — a `.cursor-plugin/plugin.json` manifest and a `rules/personal-default.mdc` rule with `alwaysApply: true` — because Cursor loads plugin rules at startup and applies them to every conversation, which is the closest analogue today to Claude's home-level `CLAUDE.md`. Both of those plugin destinations carry a custom `ownershipMarker` (JSON key for the manifest, YAML key for the rule) and matching `ownershipCheck: 'includes'`. A `workspace`-scoped instruction is written to `<resolved path>/AGENTS.md` with no custom marker override — it relies on `FileMaterializer`'s default `GENERATED_FILE_MARKER` comment instead — so `FileMaterializer` refuses to touch a foreign file in every case.

Both implement the `Adapter` port at `src/main/application/ports/adapter.ts`. `AdapterDestination` is a discriminated union on `strategy`: `{ scope, destination, strategy: 'symlink' }` for symlink targets, or `{ scope, destination, strategy: 'write', content }` for generated files. `AdapterManager` branches on `strategy` when syncing: `symlink` destinations go through `SymlinkManager`; `write` destinations go through `FileMaterializer` (see above).

### Entity file watcher

`EntityWatchService` (`src/main/application/services/entity-watch-service.ts`) keeps adapter destinations in sync when a canonical entity source file is edited **outside** the app's own `save()` flow — e.g. a `claude` session (opened via a tree row's "New Action" context-menu entry) writing to a Skill/Agent/Instruction's file directly. It watches every data dir it's given — Global's, plus the open workspace's when there is one — recursively through the `FileWatcherPort` (`src/main/application/ports/file-watcher-port.ts`), implemented by `ChokidarFileWatcher` (`src/main/infrastructure/file-watcher/chokidar-file-watcher.ts`, backed by `chokidar` — glob-free in v4, so the port watches root paths and reports every change under them). Every reported path is filtered through the pure `mapFilePathToEntity` (`src/main/application/entity/entity-watch-path.ts`), the reverse of `FsEntityRepository`'s on-disk conventions; a match re-reads the entity (tolerating a malformed/mid-write file by skipping it, same as `FsEntityRepository.list`'s per-item tolerance) and calls `AdapterManager.syncEntity` directly — deliberately **not** the full `EntityService.save()`, since an externally-detected change has no rename to detect and no `updatedAt` worth stamping. A successful re-sync fires `entity:changed` (`src/shared/entity.ts`) over the same main→renderer push-channel mechanism as `session:output`/`session:exit` (see [ipc-contract.md](ipc-contract.md#push-channels-exception-to-requestresponse)); the renderer's `useEntityChangeInvalidation` hook invalidates that kind's list query so the tree picks up the change. Like every other workspace-scoped service, one `EntityWatchService` instance is built per `buildWorkspaceScopedServices(active, …)` call and is stopped before the outgoing instance is discarded on every activation (`workspace.switchTo`/`open`/`goHome`/`delete` of the open one).

## Session bounded context

This is the `run` capability, and it is Claude-only by construction: a harness qualifies for `run` only if it exposes its agentic loop as a CLI that can be spawned in a PTY, which Cursor (loop inside its own GUI process) never will. Note that the ports below carry a vendor's name inside the application layer — deliberate, and tracked as named debt in [harness-model.md](../explanation/harness-model.md#named-debt-the-ports-still-say-claude).

`src/main/application/ports/claude-session-port.ts` (`ClaudeSessionPort`) + `src/main/infrastructure/claude-cli/node-pty-session-adapter.ts` (`NodePtySessionAdapter`, backed by `node-pty` — the first native module in this codebase) spawn a real interactive `claude` CLI process per session inside a PTY, so the CLI's TUI renders correctly. `SessionService` (`src/main/application/services/session-service.ts`) owns the one-live-session-per-entity invariant, keyed by the entity's own `urn` (no separate generated session id), and resolves each session's working directory from the entity itself: a `workspace`-scoped entity runs in its workspace's root (`resolveScopePath`); a `personal` one runs in the graph's data dir (the open workspace's `.ai-companion`, or Global's at Início). `Session` is **not** a fourth `Entity` kind — it's ephemeral process state and never goes through `EntityRepository`; `SessionService` only reads entities (via `EntityService.get`) to resolve cwd.

The `session.*` IPC namespace (`src/main/ipc/session-handlers.ts`) exposes `spawn`/`write`/`resize`/`kill`/`remove`/`status`/`list` over the normal request/response `ipc:call` envelope. `list` returns `SessionService.list()` — every `SessionSnapshot` currently in its in-memory map, running and exited alike. `kill` stops the process but leaves the exited entry in place (no pruning); `remove` kills it too if still running, then deletes the entry outright — that (plus a full `SessionService` rebuild on every activation) are the only ways an entry ever leaves the map. Streamed terminal output can't fit the request/response shape, so it travels over a second main→renderer push channel (`session:output` / `session:exit`, `src/shared/session.ts`) — see [ipc-contract.md](ipc-contract.md#push-channels-exception-to-requestresponse). Every live session's `claude` process is killed on `app.on('before-quit', ...)`, registered inside `wireIpc()` in `src/main/index.ts` (`SessionService.killAll()`) — `kill()` calls `ClaudeSessionPort.kill()` with no explicit signal, i.e. node-pty's own default (`SIGHUP` on Unix, not `SIGTERM`). `SessionService` is itself one of the workspace-scoped services rebuilt (empty) on every activation — switching, opening a folder, or going home to Início — with `killAll()` called on the outgoing instance first — so `session.list` is inherently scoped to what's open (a workspace, or Início), and a session (running or exited) is gone the moment that stops being active. There is no background daemon and no persistence; sessions do not survive a switch or the app closing.

`SessionSnapshot` carries a `label` — the anchor's human-readable name (entity/workspace name, or `Início` for a `personal` anchor) — resolved once at spawn time by the same lookup that resolves `cwd`, so a session can be displayed without a second round-trip to `EntityService`/`WorkspaceService`.

On the renderer side, `SessionPanel` (`src/renderer/components/SessionPanel.tsx`, wrapping `@xterm/xterm` + `@xterm/addon-fit`) is the one place that actually drives `session.spawn`/`write`/`resize` and reacts to the push channels; it's reused from two entry points: embedded directly in `CustomizationEditor` (an "Abrir sessão" button inside each entity's own editor, rendered only once the entity has been saved, i.e. `!isCreate`), and mounted per open tab inside `SessionsPanel` (`src/renderer/components/shell/SessionsPanel.tsx`), docked into `AppShell` — not scoped to `WorkspaceScreen` — so switching top-level Area never unmounts a running terminal. On mount, `SessionPanel` also calls `session.status` with the anchor's own key to reattach to a session already running server-side (e.g. spawned earlier, or from the other entry point) without requiring a manual "Abrir sessão" click.

`SessionFocusProvider` (`src/renderer/lib/session-focus-context.tsx`, mounted inside `AppShell`) is UI-only state — which sessions are "open" in the panel and which one has focus — kept out of react-query since it has no server round-trip of its own; `useSessionFocus().focusSession(anchor, label)` is the single entry point every "Abrir sessão" button and session-list row calls. `SessionsPanel` keeps **every** open tab's `SessionPanel` mounted for the panel's whole lifetime, toggling only `display`/`visible` on focus change — there's no server-side scrollback buffer (no daemon, no persistence — see above), so unmounting a backgrounded tab would lose its history; collapsing the panel (`sessions-panel-collapse`/`sessions-panel-expand`) hides the same way, without unmounting anything. `SessionFocusProvider` resets its open tabs when the active workspace changes, mirroring `SessionService` being rebuilt server-side on every activation.

`SessionsTreeGroup` (`src/renderer/components/workspace/SessionsTreeGroup.tsx`, backed by `useSessions()` in `src/renderer/hooks/use-sessions.ts`) is a third, read-oriented entry point: a `TreeGroup` node listing every session `session.list` returns, across all three anchor kinds (`entity`, `workspace`, `personal`), with a "Mostrar sessões finalizadas" toggle filtering by `status` and a row click calling `focusSession` for that session's `anchor`/`label` — it never spawns anything itself, only browses and resumes. Because there's no push channel for "a session was spawned," `SessionPanel` invalidates `useSessions()`'s query (`sessionsQueryKey`) itself right after a successful `session.spawn`; `useSessions()` separately subscribes to the unfiltered `window.api.session.onAnyExit` listener so a session that dies in the background (its panel not focused) still drops out of the running count without user action.

**Native module caveat:** `node-pty` must be rebuilt against Electron's own Node ABI to run inside the app — wired into `predev`/`prebuild` as `npm run rebuild:native` (`electron-rebuild -f -w node-pty` via `@electron/rebuild`), not `postinstall` (see `package.json`). That rebuilt binary can't be loaded from plain-Node `vitest`, so `npm install` and `npm test` always see the binary built against the host Node ABI instead. Running `npm run dev` or `npm run build` leaves the binary rebuilt for Electron's ABI; run `npm install` (or `npm rebuild node-pty`) to restore the host build before running `npm test` again. Separately, `postinstall` runs `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` (harmlessly no-op on platforms without that file, via `2>/dev/null || true`): `npm install` sometimes resets the prebuilt helper binary's execute bit, which breaks `posix_spawnp` on macOS at spawn time.

## Session history bounded context

The `claude` CLI already persists every conversation as JSON Lines under
`~/.claude/projects/<slug>/<uuid>.jsonl`. History is therefore a **read** problem, not a persistence one:
this app stores nothing of its own about past sessions and never writes into the CLI's directory.

**The join.** `SessionSnapshot` carries a `claudeSessionId` (always a UUID) alongside the app's own
`sessionId`. It is minted at spawn and passed to the CLI as `--session-id <uuid>`, so the transcript's
filename is known before the process starts — the live session and its history entry are the same thing
rather than a heuristic match. `--continue` is retired from the spawn path: with several sessions able to
share a `cwd` it could attach to a sibling's conversation. Reopening a session resumes its own conversation
by id (`--resume <uuid>`), and `NodePtySessionAdapter` falls back once to `--session-id` if the CLI reports
no such conversation — which happens when a session exited before its transcript was ever written.

**Never read the middle of a file.** `SessionTranscriptPort` / `FsClaudeTranscriptAdapter`
(`src/main/infrastructure/claude-cli/fs-claude-transcript-adapter.ts`) summarise a conversation from a
16 KB head read plus a 256 KB tail read, whatever the file's size — and these files reach 63 MB. That
works because of how the CLI writes them: `cwd` is on the first content-bearing line, and `cost-state`,
`ai-title` and `last-prompt` are re-appended on *every* turn, so the last copy of each always trails the
file. Measured on a real machine: the final `cost-state` never further than 915 bytes from EOF, the final
title never further than 33 KB. The one exception is a transcript old enough to carry no `cost-state`,
which falls back to summing its assistant lines and is read whole.

`cwd` is always read from **inside** the file. The folder name is the `cwd` with separators replaced by
hyphens, which is lossy — a directory whose own name contains a hyphen is indistinguishable from a
separator — so the folder name is used as an index and never decoded.

**Cost is read, not estimated, wherever possible.** The CLI's `cost-state` line carries its own
`totalCostUSD` and a per-model `modelUsage` breakdown; that is a reading. Only a transcript predating it
falls through to the bundled price table in `src/main/application/pricing/model-pricing.ts`, which
normalizes model ids (`claude-opus-5[1m]`, `claude-haiku-4-5-20251001` → one rate key) and is overridable
per model via `Settings.pricing`. An unpriced model yields `null`, never `0`; a conversation containing one
yields `null` overall rather than a total that is silently too low.

**No cache file.** Summarising every transcript on a real machine (169 conversations) measures at roughly
260 ms, so `SessionHistoryService` keeps only an in-memory map keyed by `mtimeMs` + `sizeBytes`. A
versioned on-disk cache would buy a fraction of a second at the price of a schema, an atomic writer and a
class of staleness bugs.

`SessionHistoryService` is workspace-scoped (its default scope and its warm readings belong to the
workspace being looked at — the renderer asks for `{kind:'workspace',workspaceId}` inside one and `{kind:'all'}` at Início); the transcript port itself is a shared singleton, since `~/.claude/projects`
is outside any workspace. Its `~/.claude/projects` path is resolved once in `src/main/index.ts`, like every
other `~/.claude` path — adapters in this codebase never call `homedir()` themselves.

## Global / Workspace

Two scopes, two kinds of data dir. **Global** is `~/.ai-companion` — always loaded, the home of `personal`
entities, settings, plugins, marketplaces and the workspace registry; what the app calls "Início". A
**workspace** is any folder the user opened; its `workspace`-scoped entities live in its own
`<root>/.ai-companion`. Global is not a workspace — the home dir can't be opened as one — and workspaces are
independent: one may sit inside another's folder, with no parent/child relation. A `Workspace` is purely
organizational — never an `EntityKind`, never routed through `AdapterManager`, never materialized to
`~/.claude/` or `~/.cursor/`. (The project-era third level — `Project`, `ProjectService`, `projects.json` —
is gone; see "Migration" below.)

- `~/.ai-companion/workspaces.json` — `WorkspaceRegistryFile` (`src/shared/workspace.ts`):
  `{ schemaVersion: 2, workspaces: Workspace[], activeWorkspaceId: string | null }`, where `Workspace` is
  `{ id, name, rootPath, createdAt }` and `activeWorkspaceId === null` means Início. `rootPath` is stored as
  a real path (via the `DirectoryResolver` port), so a symlinked path or a trailing slash dedupes to the
  same workspace. Follows the `FsSettingsRepository` load/save/atomic-rename pattern; owned by
  `WorkspaceService`.

**Activation.** Every call that changes what's open — `workspace.switchTo`, `workspace.open`,
`workspace.goHome`, and `workspace.delete` of the open workspace (which goes home first) — goes through the
`WorkspaceActivation` built in `src/main/index.ts` (interface in `src/main/ipc/workspace-handlers.ts`). Its
`activate(select)` runs the registry selection **first**, so a rejected `workspace.open` (not a folder, the
home dir) leaves the open workspace and its sessions alone; only then does it kill the outgoing graph's
sessions and launch processes, destroy embedded-browser tabs, stop the entity watcher and rebuild the graph
with `buildWorkspaceScopedServices(active, shared)` (`src/main/application/workspace-scoped-services.ts`),
where `active` is `{ workspace, dataDir }` or `null` at Início. Activations are serialized through a task
queue, so overlapping requests can't interleave. The rebuilt graph holds the `ScopedEntityRepository`
(Global's `FsEntityRepository`, built once at boot and shared by every graph, plus the open workspace's),
`SymlinkManager`, `FileMaterializer`, `AdapterManager`, `EntityService`, `SkillService`, `AgentService`,
`InstructionService`, `SessionService`, `SessionHistoryService`, `HealthService`,
`WorkspaceTeardownService`, `EntityWatchService`, `LaunchConfigService`/`LaunchProcessService` and
`GitService`. It is rebuilt on going home too: at Início it still serves Global's entities, sessions, health
and adapters, while git fails `validation`, `launchConfig.list` returns `null`, and the file browser
(`workspace.listDir`/`readFile`/`writeFile`/`resolvePath`, `openWith.*`) fails `validation`.

Plugins, marketplaces, hooks, MCP config and adapter on/off settings are built once at boot, not per graph.
Their harness-native `project` tiers — the plugin dir and cache, `<root>/.claude/settings.json`, plugin
symlinks, the marketplace cache — resolve against the **open workspace's root** at call time (an
`activeRoot()` closure in `src/main/index.ts`), and throw `validation` at Início, where the renderer only
offers `personal`.

**`.ai-companion/index.md` marker.** Every data dir — Global's and each workspace's — gets a static, real
`index.md` at its root (`This folder is managed by the AI Companion app…`), written by
`WorkspaceBootstrapService.create()` next to the `skills/`, `agents/`, `_backups/` subdirectories — path
built by `workspaceIndexMarkerPath()` in `src/shared/brand-paths.ts`, content interpolating
`brand.displayName`. Bootstrap runs for Global at startup, for a workspace when it's registered, and again
on every activation, so a workspace that predates the marker (or a future bootstrap addition) self-heals.
Not routed through `AdapterManager` — a Workspace isn't an Entity — so the marker is invisible to
`syncAll()`/health drift checks. The project-era `<project>/.ai-companion/index.md` **symlinks** no longer
exist (the migration removes any that pointed into a data dir). Factory reset (`WorkspaceTeardownService.restore()`)
removes the app's adapter destinations, then deletes Global's data dir only — each workspace's own
`.ai-companion` stays in its folder.

`resolveScopePath(entity, { workspaceService })` (`src/main/application/resolve-scope-path.ts`) maps a
`workspace`-scoped entity's `scopeId` to that workspace's `rootPath` at the point of use — the Claude/Cursor
adapters and `SessionService` call it instead of reading a persisted path off the entity, so a workspace
whose registry entry changes never leaves a stale cached path behind. It throws for `personal`; callers
branch on that first.

**Known gap — adapter targets are not reconciled on switch.** Activation rebuilds the service graph but
doesn't touch any adapter destination. Since `personal` entities always live in Global, `~/.claude/` and
`~/.cursor/` no longer drift with whichever workspace is open; a workspace's own destinations live under its
folder and simply stay in place while it's closed. `AdapterManager.syncAll()` still only covers Global plus
the open workspace and does no pruning of stale symlinks/generated files — left for a future plan.

**Migration.** `WorkspaceModelMigration` (`src/main/application/services/workspace-model-migration.ts`)
runs in `src/main/index.ts` before any service graph is built. A fresh install just writes an empty v2
registry; a registry already at `schemaVersion: 2` is a no-op. A legacy registry is first backed up to
`~/.ai-companion/_backups/migration-v2-<ts>/` (absolute paths preserved beneath it, plus a `log.json`), then:
each `Project` becomes a workspace (new id = the project's id, name kept; deduped by real path; a project at
the home dir is dropped and its skills/agents become `personal`, its instructions go to the backup);
project-scoped skills/agents/instructions move into the target workspace's data dir and are rescoped to
`workspace` (a name collision gets a `-2` suffix, logged); legacy `repoPath`-only instruction sidecars are
rescoped by folder (creating a workspace with a path-derived id when none matches); the old default
workspace's `workspace`-scoped entities become `personal` (its workspace instructions go to the backup —
Global has a single personal instruction); stray `personal` entities in a workspace's data dir move to Global
(Global wins a collision); project index-marker symlinks are removed. The registry is written **last**
(`schemaVersion: 2`, the old active id if it survived, else `null`), and only then are the `projects.json`
files deleted. Moves are move-then-rewrite and a re-run also scans the new workspaces' dirs, so a crash
mid-way converges on the next boot. After a migration, `index.ts` runs an adapter `syncAll` for Global and for
each touched workspace. On failure the app boots into a dispatcher that answers every IPC call with
`{ kind: 'io', message }` (the message names the backup dir), landing the renderer on the `IoError` screen.

### Workspace file browser and session anchoring

`FileBrowserPort` (`listDir`/`readFile`/`writeFile`/`realpath`, implemented by `NodeFileBrowserAdapter` via
`node:fs/promises`) is wrapped by `FileBrowserService`, which resolves a caller-supplied path relative to
the active workspace's `rootPath` and rejects anything escaping it (`..`, an absolute path, or a symlink
resolving outside the root) before touching the filesystem. `writeFile` overwrites an existing file in
place only — no rename/delete/move support, and it never creates a new file. Re-created on every
activation, alongside the Entity-backed graph, but rooted at the raw `rootPath` rather than
`<rootPath>/.ai-companion` — it browses the author's real files, not the app's own data. There is none at
Início (Global has no file tree), so the file-browser and `openWith.*` handlers fail `validation` there.

`readFile` returns a `FilePreview` tagged by `kind`: plain text is read as UTF-8 (capped at 256KB, marked
`truncated`) and stays editable through `writeFile`; a `.xlsx` file is instead parsed with `exceljs` into a
`SpreadsheetSheet` per sheet — cell text plus, when the source file styled that cell, its font/fill/alignment
(`SpreadsheetCell = string | {value, style}`), the sheet's merged ranges, column widths and frozen-pane split
(capped at 2000 rows per sheet; a formula cell shows its last-cached `result`, not the formula itself; a
number renders through its own cell number format — currency, percentage, thousands grouping — dates stay
`YYYY-MM-DD` regardless of format) — and rendered read-only in `EditorPanel`'s `SpreadsheetPreview` (a plain
`Table` with merged cells as colSpan/rowSpan, a sticky frozen header row, and a MUI `Tabs` strip pinned to the
bottom of the grid, matching where Excel/Sheets/LibreOffice put sheet tabs). Any other binary content (a null
byte in the first 8000 bytes) is `previewable: false`. Spreadsheet write-back isn't implemented yet — view only.

A `.numbers` document reaches that same spreadsheet path through `SpreadsheetConverterPort`
(`supports`/`toXlsx`, implemented by `NumbersConverterAdapter`), consulted by `NodeFileBrowserAdapter`
before any size cap or content sniffing. The format itself is unreadable to us — an iWork Archive of
Snappy-compressed protobuf whose schema Apple has never published and changes per release — so the adapter
drives Numbers.app over Apple events (`osascript`, paths passed as `argv` rather than interpolated into the
script) to export a `.xlsx`, then parses that through `readSpreadsheet`. The renderer therefore needs no
`.numbers` branch at all: it only ever sees `kind: 'spreadsheet'`.

Three constraints shape that adapter. **It converts a temp copy, never the file itself** — `open` on a
document Numbers already has open returns *that* document, and the script's `close ... saving no` would
discard the user's unsaved edits; copying removes the hazard structurally, where detecting "already open?"
only narrows a race. The preview consequently reflects the saved file, not an unsaved Numbers window.
**It drops the export-summary sheet Numbers prepends to multi-table documents** by comparing the parsed
sheet count against the table count Numbers itself reports (`ConvertedSpreadsheet.sourceSheetCount`);
the sheet's name is localized, and a hand-written index sheet of one's own looks identical to content
sniffing, so anything but exactly one surplus leading sheet is left alone. **Every expected failure —
no Numbers, denied Automation permission, a hung export past the 30s deadline — becomes
`{previewable: false, reason}`**, not a thrown `DomainError`, so the reason lands in the renderer's
"cannot preview" panel instead of its generic load-error state. macOS-only by construction; the 5MB cap
applies to the converted workbook, since a `.numbers` file's embedded image assets say little about the
size of its grid.

The Workspace screen's folder tree (`FolderTree`) browses the open workspace only: every folder expands in
place (lazily, via `workspace.listDir`) and every path it hands out is workspace-relative. A folder row's
per-folder action is **"Abrir como workspace"** (`tree-node-open-as-workspace-<name>`): it resolves the
folder's absolute path (`workspace.resolvePath`) and calls `workspace.open` through `useOpenWorkspace`,
leaving this workspace for that folder's own — the existing one, or a new one named after it — behind the
same unsaved-tabs guard every other workspace change goes through. Opening a subfolder this way creates an
independent, nested workspace; it doesn't scope or narrow the current one.

`Session`s anchor on an entity, a workspace, or Início (`SessionAnchor` in `src/shared/session.ts`:
`{kind:'entity',urn} | {kind:'workspace',workspaceId} | {kind:'personal'}`) — `SessionService` keys live
sessions by `sessionAnchorKey(anchor)`. A `workspace` anchor runs in that workspace's root; a `personal` one
runs in the home dir, labeled `Início`. The Workspace screen's "+"/"Abrir sessão" gesture anchors on the open
workspace, or on `personal` at Início. A conversation adopted from history (`sessionHistory.resume` →
`SessionService.adoptConversation`) is anchored to the open workspace when its `cwd` is inside that
workspace's root, and to `personal` otherwise — it never registers anything new.

Every tree row that offers a right-click menu (`FolderTree` files/folders, `EntityTreeGroup` Skills/Agents,
`InstructionTreeRow`, including the `personal` row) also offers "New Action" —
wired in `WorkspaceScreen` to `newActionForFile`/`newActionForEntity`/`newActionForInstruction`, all
funneling into `startNewActionSession`. Unlike "Abrir sessão" above, this **never** anchors on the clicked
item's own `entity` urn (which is a singleton — spawning again would reuse an already-running session
instead of a fresh one); it anchors on the item's own workspace scope instead
(`anchorForEntityScope`, falling back to wherever the user is — the open workspace, or `personal` at
Início — for `personal`-scoped entities), spawns an always-fresh session, opens its tab, then seeds its first message with a
draft `@<path>` reference — the entity's canonical source path (via `skill.resolvePath`/
`agent.resolvePath`/`instruction.resolvePath`) or, for a file/folder already inside the target scope, its
relative path directly (no resolve round trip, since it already matches the session's own cwd). The draft
is written via `session.write` — immediately if `session.spawn`'s response already carries startup output,
otherwise deferred to the session's first live `session:output` chunk — and is never auto-submitted; the
user reviews and edits it like any other terminal input before sending. See "Entity file watcher" above for
what keeps adapter destinations in sync when that session goes on to edit a Skill/Agent/Instruction file
directly.

### Workspace switching navigation

Workspace switching/creation/removal is centralized at Início (`activeWorkspaceId === null`) —
`WorkspaceManagementList` (`components/workspace/`) renders every registered workspace as a row (no menu to
open first; with nothing open, every one is listed), switchable by clicking the row and deletable via a trash
icon. There is no floating workspace switcher in `TopNav`.

Going home is `workspace.goHome` (`useGoHome`). Inside a workspace, the Workspace screen's breadcrumb
(`WorkspaceBreadcrumbHeader`) offers an "Início" action, and `useAreaNavigation` (CommandPalette, status-bar
entries) goes home before opening an Início-only destination — each behind the unsaved-tabs guard.

The Workspace screen's "⋮" header menu carries a "Remover workspace" action while a workspace is open. The
backend's `workspace.delete` goes home first when the target is the open workspace, so the renderer just
calls it (`useDeleteWorkspace`) and lands back on the management list. The target is captured in local state
when the action opens (not read live off `useActiveWorkspace()`) so the confirmation dialog
(`WorkspaceRemoveConfirmDialog`) keeps naming it even as the activation resolves out from under it.

Every activation (`useSwitchWorkspace`/`useOpenWorkspace`/`useGoHome`/`useDeleteWorkspace`) invalidates the
whole query cache (`queryClient.invalidateQueries()` with no filter) rather than `clear()`ing it — `clear()`
destroys queries without telling their still-mounted observers to refetch, so screens stayed on stale data
until something happened to force a remount. Workbench history entries (`lib/workspace-history-store.ts`) are
`{ workspaceId: string | null, activeTabId }` — `null` being Início — and tab ids carry no scope segment
(`file:<relPath>`, `git-diff:<source>:<path>`), since every path is relative to the one open workspace.

### Instructions on Visão geral

There is no standalone Instructions screen — instruction management is inline in the Workspace screen's
Explorer panel, as an **INSTRUCTIONS** tree row (`InstructionTreeRow`,
`components/workspace/InstructionTreeRow.tsx`), scoped to whatever is open:

- **Início** → the `personal` row (pinned above `WorkspaceManagementList`) manages the Personal singleton
  (`scopes: ['personal']`) via `usePersonalInstruction()`.
- **A workspace** → a `workspace` row pinned at the top of `FolderTree` manages an instruction scoped to the
  open `Workspace` (`scopes: ['workspace']`, `scopeId: workspace.id`, resolved by `resolveScopePath` to
  `workspace.rootPath`) via `useWorkspaceInstruction`.

`useWorkspaceInstruction` (`hooks/use-instructions.ts`) `select`s off the shared `useInstructionsList`
query cache instead of issuing its own IPC call. Creating one seeds a blank entity via
`seedWorkspaceInstruction` (`lib/instruction-seed.ts`) with a slugified `name` and no folder picker — the
scope's path is already known (`workspace.rootPath`). Clicking a row opens the instruction in a Workbench tab
(`EditorPanel`), with `scope` always hidden (personal also hides `name`/`description`/`version` — the
singleton's identity is fixed and its sidecar isn't persisted). Elsewhere, `PropertiesForm`'s scope toggle
for skills/agents is Personal/Workspace, with Workspace disabled at Início.

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
`PluginsTreeGroup`, the last three under one "Integrações" group) rendered in `WorkspaceScreen`'s Control
Panel (`ControlPanelContent`), with an Início variant (`isHome`: Global entities only, nothing filtered) and a
workspace variant (local/global split, below). `FolderTree`'s `pinnedRows` slot now carries only the open
workspace's **Launch Configurations** group (`LaunchConfigsTreeGroup`), pinned once at the top of the tree. Each group fetches its own data
(`skill.list`/`agent.list`/`hook.list`/`mcp.list`/`plugin.list`) and opens the same
`CustomizationEditor`/`CustomizationViewDrawer`/`McpEditorDialog`/`PluginDetail` (in a `DetailDrawer`) the
old standalone screens used — only the surrounding chrome (a dense tree row instead of a full-page
`EntityDataGrid`) changed. `PluginsTreeGroup` also owns the "Importar plugin" and "Publicar" actions
(`PluginImportDialog`/`PublishPluginDialog`, unchanged), previously toolbar buttons on the old `PluginList`
screen, now the group's `TreeGroup` header "+" action and a per-row overflow menu respectively.

`SessionsTreeGroup` sits in the same Control Panel, stacked above the customization groups, but isn't part
of the local/global partition the other groups apply — every session already belongs to what's open (a
workspace, or Início) by construction (see [Session bounded context](#session-bounded-context)), so there's no
"more global than this" bucket to hide. Its own visibility axis is session `status`, not scope: a
`showFinishedSessions` toggle in `ScreenHeader`'s `actions` (independent of, and always shown alongside,
the local/global `showGlobal` toggle) filters exited sessions in or out. A row click doesn't open
`CustomizationEditor`/`McpEditorDialog` like the other groups — it calls `useSessionFocus().focusSession`
for that session's `anchor`, the same callback the header's "Abrir sessão" buttons already call, which
focuses (or opens) that session's tab in the persistent `SessionsPanel` docked in `AppShell`.

Skill/Agent tree groups partition their list into "local" (`scopes[0] === 'workspace'` and `scopeId` is the
open workspace) and "global" (everything else — Personal-scope or plugin-provided) via an
`EntityTreeGroupProps.localScope` prop; `HooksTreeGroup` and `McpTreeGroup` apply the same local/global
split on their own data shapes (Hooks have no scoping at all yet, so every hook counts as global inside a
workspace; MCP's own `project-local`/`project-shared` scope is matched against the open workspace's
`rootPath` instead of an `Entity.scopeId`). `PluginsTreeGroup` is coarser still: a plugin's own `scope` is
Claude Code's `'personal' | 'project'` with no `scopeId`/path of its own; `isProjectContext` (set while a
workspace is open) splits `project` plugins (local) from `personal` ones (global). The backend resolves that
`'project'` tier against the open workspace's root (see "Global / Workspace" above) — at Início it isn't
offered. The global bucket is hidden by default inside a workspace and revealed by the "Mostrar/Ocultar
entidades globais" entry in the Workspace screen's "⋮" header menu (`WorkspaceScreen`'s `showGlobal`
state) — omitted entirely at Início, where nothing is filtered.

Navigation is state-driven via a `Nav` discriminated union in `components/shell/nav.ts` (areas: `workspace`,
`starter-pack`, `marketplaces`, `diagnostico`); `Main.tsx` maps `Nav` to a screen. No `react-router`, and no
area carries a `sub` anymore — Skills/Agents/Hooks/MCP/Plugins all moved from standalone screens into the
tree nodes described above, so there is only ever one Workspace screen, and `SubRail` (which used to render
a Plugins/Marketplaces sub-list) has been deleted entirely along with the `sub` field on `Nav`. Marketplaces
isn't scoped to any workspace — it's a global plugin-source catalog, closer to Settings than to
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

- **Entities** — `.md` files under a data dir: `personal` ones in Global's `~/.ai-companion/`, `workspace` ones in that workspace's `<root>/.ai-companion/`. Skills at `skills/<name>/SKILL.md` and agents at `agents/<name>.md` keep YAML frontmatter. Instructions are frontmatter-free: the personal singleton at `instructions/default.md` (Global), workspace instructions at `instructions/project/<slug>/INSTRUCTION.md` plus a sidecar `meta.json` (description, version, timestamps, `scope: 'workspace'`, `scopeId`).
- **Settings** — `~/.ai-companion/settings.json`, managed by `settings-service`; one file for the whole app, never per workspace. Workspace scope lives on the entity itself (`scopes`/`scopeId`, resolved to a path via `resolveScopePath`).
- **Sync** — symbolic links from each adapter target into the canonical files (Global's or the workspace's data dir), with two `write`-strategy exceptions:
  1. `PersonalInstruction` on the Cursor adapter materializes a small local plugin under `~/.cursor/plugins/ai-companion/` (a `plugin.json` manifest and an `alwaysApply: true` rule .mdc), marker-owned via `FileMaterializer` so foreign files stay untouched.
  2. A workspace instruction on the Cursor adapter materializes a generated `<workspace root>/AGENTS.md`, also marker-owned.
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
- `SimpleGitRepoClient` (RepoGitPort) — the user's working tree: status, diff, stage/unstage/discard, commit, init. Parses machine formats only (`status --porcelain=v2 -z`, unified diff) with pure parsers in `infrastructure/git/parsers/`, and maps stderr to domain errors in `classify-git-error.ts`. Every git it spawns is non-interactive (`GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `LC_ALL=C`, …), lock-free for reads (`GIT_OPTIONAL_LOCKS=0`) and time-boxed (30s).
  **Two git ports on purpose:** `GitPort` serves plugins/marketplaces; `RepoGitPort` serves the user's repos. They have different callers, error vocabularies and safety rules (e.g. the repo root must be the target itself — a workspace opened on a subfolder of a larger repo reports `isRepo: false` — and hooks always run). Don't merge them.
- `PluginCacheFile` (PluginCachePort) — reads/writes `.json` plugin metadata cache.
- `ClaudeSettingsFile` (ClaudeSettingsPort) — manages `~/.claude/settings.json` (and, for the `project` tier, the open workspace's `<root>/.claude/settings.json`) to expose plugin modules.
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

- [The harness model](../explanation/harness-model.md) — what a harness is, the `manage`/`run` split, how to add one.
- [Getting started](../tutorials/getting-started.md) — to run the app first.
- [Entity schema](customization-schema.md)
- [IPC contract](ipc-contract.md)
- [Adapter targets](adapter-targets.md) — every path each adapter writes.
- [On-disk layout](on-disk-layout.md) — every file the app owns, edits or reads.
- Why symlinks _(TBD)_
