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

`EntitySerializer` (`application/entity/entity-serializer.ts`) renders/parses the Markdown ↔ `Entity` boundary: `renderEntityFile`/`parseEntityFile` handle flat frontmatter for `skill`/`agent`; `instruction` is **frontmatter-free** — the whole file is the body. For project instructions the sidecar metadata (`description`, `version`, timestamps, `repoPath`) travels through a separate `meta.json` handed to `parseEntityFile` via `instructionSidecar`. `FsEntityRepository` (`infrastructure/entity/fs-entity-repository.ts`) implements the `EntityRepository` port (`list`/`get`/`save`/`delete`/`exists`) against `skills/<name>/SKILL.md`, `agents/<name>.md`, `instructions/default.md` (personal singleton), and `instructions/project/<slug>/{INSTRUCTION.md,meta.json}` (per project); the legacy `global-instructions/default.md` path is still tolerated on `get`/`exists` for backwards compatibility.

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
- `workspace-bootstrap` — creates the `.ai-companion/` directory tree for the default workspace at startup, and again for every workspace as it's created (see `WorkspaceService.create()`).
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

- `claude-adapter.ts` — resolves sync destinations per entity kind via `resolveEntityDestinations`: `skill` → `~/.claude/skills/<name>` (dir), `agent` → `~/.claude/agents/<name>.md`, `PersonalInstruction` → **both** `~/.claude/CLAUDE.md` and `~/AGENTS.md`, `ProjectInstruction` → `<entity.repoPath>/.claude/CLAUDE.md` and `<entity.repoPath>/AGENTS.md`. All destinations use `strategy: 'symlink'`. Skill/agent `project` scope is a temporary no-op (see the schema TODO block); once each carries its own `repoPath`, the adapter will resolve `<repoPath>/.claude/{skills,agents}/…` for them too.
- `cursor-adapter.ts` — publishes into Cursor's native file surface, toggled by `settings.adapters.cursor` (default **off**): `skill` → `~/.cursor/skills/<name>/` (dir, symlink), `agent` → `~/.cursor/agents/<name>.md` (symlink). `PersonalInstruction` is materialized as a Cursor local plugin under `~/.cursor/plugins/ai-companion/` — a `.cursor-plugin/plugin.json` manifest and a `rules/personal-default.mdc` rule with `alwaysApply: true` — because Cursor loads plugin rules at startup and applies them to every conversation, which is the closest analogue today to Claude's home-level `CLAUDE.md`. `ProjectInstruction` is written to `<entity.repoPath>/AGENTS.md`. Both `write` destinations carry a custom `ownershipMarker` (JSON key for the plugin manifest, YAML key for the rule) and matching `ownershipCheck: 'includes'`, so `FileMaterializer` refuses to touch foreign files. Skill/agent `project` scope is a no-op here for the same reason as the Claude adapter.

Both implement the `Adapter` port at `src/main/application/ports/adapter.ts`. `AdapterDestination` is a discriminated union on `strategy`: `{ scope, destination, strategy: 'symlink' }` for symlink targets, or `{ scope, destination, strategy: 'write', content }` for generated files. `AdapterManager` branches on `strategy` when syncing: `symlink` destinations go through `SymlinkManager`; `write` destinations go through `FileMaterializer` (see above).

## Session bounded context

`src/main/application/ports/claude-session-port.ts` (`ClaudeSessionPort`) + `src/main/infrastructure/claude-cli/node-pty-session-adapter.ts` (`NodePtySessionAdapter`, backed by `node-pty` — the first native module in this codebase) spawn a real interactive `claude` CLI process per session inside a PTY, so the CLI's TUI renders correctly. `SessionService` (`src/main/application/services/session-service.ts`) owns the one-live-session-per-entity invariant, keyed by the entity's own `urn` (no separate generated session id), and resolves each session's working directory from the entity itself: a `ProjectInstruction` uses its own `repoPath`; every other entity kind (`Skill`, `Agent`, `PersonalInstruction`) uses the app's workspace root. `Session` is **not** a fourth `Entity` kind — it's ephemeral process state and never goes through `EntityRepository`; `SessionService` only reads entities (via `EntityService.get`) to resolve cwd.

The `session.*` IPC namespace (`src/main/ipc/session-handlers.ts`) exposes `spawn`/`write`/`resize`/`kill`/`status` over the normal request/response `ipc:call` envelope. Streamed terminal output can't fit that request/response shape, so it travels over a second main→renderer push channel (`session:output` / `session:exit`, `src/shared/session.ts`) — see [ipc-contract.md](ipc-contract.md#push-channels-exception-to-requestresponse). Every live session's `claude` process is killed on `app.on('before-quit', ...)`, registered inside `wireIpc()` in `src/main/index.ts` (`SessionService.killAll()`) — `kill()` calls `ClaudeSessionPort.kill()` with no explicit signal, i.e. node-pty's own default (`SIGHUP` on Unix, not `SIGTERM`). There is no background daemon; sessions do not survive the app closing.

On the renderer side, `SessionPanel` (`src/renderer/components/SessionPanel.tsx`, wrapping `@xterm/xterm` + `@xterm/addon-fit`) is embedded directly in `CustomizationEditor` — the entry point is an "Abrir sessão" button inside each entity's own editor (it only renders once the entity has been saved, i.e. `!isCreate`), not a separate top-level "Sessions" screen.

**Native module caveat:** `node-pty` must be rebuilt against Electron's own Node ABI to run inside the app — wired into `predev`/`prebuild` as `npm run rebuild:native` (`electron-rebuild -f -w node-pty` via `@electron/rebuild`), not `postinstall` (see `package.json`). That rebuilt binary can't be loaded from plain-Node `vitest`, so `npm install` and `npm test` always see the binary built against the host Node ABI instead. Running `npm run dev` or `npm run build` leaves the binary rebuilt for Electron's ABI; run `npm install` (or `npm rebuild node-pty`) to restore the host build before running `npm test` again. Separately, `postinstall` runs `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` (harmlessly no-op on platforms without that file, via `2>/dev/null || true`): `npm install` sometimes resets the prebuilt helper binary's execute bit, which breaks `posix_spawnp` on macOS at spawn time.

## Workspace / Project

`Workspace` and `Project` are non-synced, purely organizational entities — never an `EntityKind`, never
materialized to `~/.claude/` or `~/.cursor/`. Both are flat JSON registries following the
`FsSettingsRepository` load/save/atomic-rename pattern:

- `~/.ai-companion/workspaces.json` — every known `Workspace` (`id`, `name`, `rootPath`, `isDefault`,
  `createdAt`) plus `activeWorkspaceId`. Always at this fixed location, seeded with the default workspace
  (`rootPath` = home dir) on first read. Owned by `WorkspaceService`.
- `<workspace.rootPath>/.ai-companion/projects.json` — every `Project` (`id`, `name`, `path`, `createdAt`)
  belonging to that workspace. Owned by `ProjectService`, re-pointed at a different file whenever the
  active workspace changes.

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

`Session`s can now anchor on an entity, a workspace, or a project (`SessionAnchor` in
`src/shared/session.ts`) — `SessionService` keys live sessions by `sessionAnchorKey(anchor)` instead of by
entity urn alone, so "one live session per anchor" replaces "one live session per entity". The Workspace
screen's "Abrir sessão" actions (workspace-root and per-`Project`) and the entity-anchored flow from the
Customization editor both go through the same `SessionService`/`session.spawn` surface.

## Renderer structure

```
src/renderer/
├── App.tsx                 # View union: loading | main | settings | io-error
├── main.tsx
├── screens/                # Main.tsx routes by Nav; per-entity dirs:
│   ├── skills/ agents/ instructions/ hooks/ mcps/
│   ├── plugins/ marketplaces/ health/ starter-pack/ settings/
│   ├── Main.tsx            # root screen — maps Nav state to a screen component
│   ├── Settings.tsx
│   └── IoError.tsx         # generic retry screen for I/O failures
├── components/             # ds/ (design system), shell/ (TopNav, SubRail, CommandPalette), EntityDataGrid/
├── hooks/                  # react-query data hooks
└── lib/                    # ipc.ts, query-client.ts, theme-mode-context.tsx
```

The `instructions/` screen is the unified Personal + Project entry point — a single top card for the personal singleton (with the OGS-template CTA and a dynamic "Synced to" panel that grows to include the Cursor plugin paths when the Cursor adapter is enabled) and a list of project instructions below (each row shows the repo path; the New button opens a folder picker that seeds the editor with `repoPath` + the folder basename as the slug). The old `global-instructions/` directory and its screen were removed with this refactor. There is no `commands/` screen — the `command` entity kind was removed too.

Navigation is state-driven via a `Nav` discriminated union in `components/shell/nav.ts` (areas: `inicio`, `biblioteca`, `plugins`, `diagnostico`); `Main.tsx` maps `Nav` to a screen. No `react-router`.

## Data flow (typical user action)

1. The user triggers an action in a renderer screen — e.g. *save a skill*.
2. The renderer calls `callIpc('skill.save', payload)` exposed by **preload**.
3. `skill-handlers.ts` in `src/main/ipc/` invokes `SkillService`.
4. The service calls `EntityService`, which validates via `EntityValidator`, then calls the `EntityRepository` **port**; **infrastructure** (`FsEntityRepository`) does the I/O (file write, then `AdapterManager` syncs symlinks).
5. The result returns up the stack; the renderer re-renders.

Note: the `customization.*` IPC namespace has been removed. All entity operations now use typed namespaces (`skill.*`, `agent.*`, `instruction.*`, `hook.*`, etc.) — see [IPC contract](ipc-contract.md).

I/O failures bubble up to the `IoError` screen, which retries the failing step.

## Persistence

- **Entities** — `.md` files under the workspace folder. Skills at `skills/<name>/SKILL.md` and agents at `agents/<name>.md` keep YAML frontmatter. Instructions are frontmatter-free: the personal singleton at `instructions/default.md`, project instructions at `instructions/project/<slug>/INSTRUCTION.md` plus a sidecar `meta.json` (description, version, timestamps, `repoPath`).
- **Settings** — JSON file managed by `settings-service`. The old global `linkedRepos` array was retired — project scope now lives on the entity itself (`ProjectInstruction.repoPath`).
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
