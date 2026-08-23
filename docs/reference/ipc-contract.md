---
title: IPC contract
description: Methods exposed by the preload bridge from the renderer to the main process — naming, params, results and error shape.
---

# IPC contract

A single Electron IPC channel routes every renderer ↔ main call. The renderer sends a `{ method, params }` envelope; the main process dispatches by method name and replies with a typed `IpcResult`.

## Wire shape

```ts
const IPC_CHANNEL = 'ipc:call';

interface Envelope { method: string; params: unknown; }

type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };

interface IpcError {
  kind: IpcErrorKind;
  message: string;
  details?: Record<string, unknown>;
}

type IpcErrorKind =
  | 'validation'
  | 'io'
  | 'symlink_conflict'
  | 'not_found'
  | 'external_api'
  | 'unauthorized'
  | 'auth'
  | 'conflict'
  | 'internal';
```

Defined in [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts).

## Push channels (exception to request/response)

Every method above is request/response over `ipc:call`. One exception: `session:output` and `session:exit` (defined in [`src/shared/session.ts`](../../src/shared/session.ts)) stream live PTY output and report a session's exit code while a `claude` process spawned via `session.spawn` is running — that streaming can't fit the request/response `ipc:call` envelope. **Multiple sessions can be live at once** (one per entity with an open session), so preload itself filters by `sessionId` (the entity's own `urn`) before invoking the renderer's listener — there's no single "the" session to assume. Preload exposes these as `window.api.session.onOutput(sessionId, listener) → unsubscribe` and `window.api.session.onExit(sessionId, listener) → unsubscribe`, each listener receiving only the payload (`chunk` / `exitCode`) for that session.

## Preload bridge

`src/preload/index.ts` exposes a single function on `window.api`:

```ts
window.api.call<T>(method: string, params: unknown): Promise<IpcResult<T>>;
```

The renderer wraps it via `callIpc` ([`src/renderer/lib/ipc.ts`](../../src/renderer/lib/ipc.ts)), which unwraps `data` on success and throws `IpcCallError` on failure:

```ts
import { callIpc } from './lib/ipc.js';

const list = await callIpc<Skill[]>('skill.list');
```

## Dispatch and error mapping

[`src/main/ipc/dispatcher.ts`](../../src/main/ipc/dispatcher.ts) wraps every handler in a try/catch:

| Thrown | `IpcError.kind` | Notes |
|---|---|---|
| `DomainError(kind, …)` | `kind` (carried verbatim) | `details` propagated when present. |
| `Error` | `internal` | Message preserved; details dropped. |
| Anything else | `internal` | Message: `"Unknown error"`. |
| Unknown method | `not_found` | Returned without invoking any handler. |

## Methods

Grouped by namespace. Source: [`src/main/ipc/registry.ts`](../../src/main/ipc/registry.ts).

### `app`

| Method | Params | Result |
|---|---|---|
| `app.restore` | — | `void` |

> **Destructive (scoped).** `app.restore` restores the app to its initial state: it removes the app-created symlinks under adapter targets (those pointing into the workspace, via `AdapterManager.removeAllAdapterSymlinks`) and deletes the workspace directory `~/.ai-companion/`, then quits. It does **not** delete the rest of `~/.claude/` or any `.env.local` — only this app's own footprint. Orchestrated by `WorkspaceTeardownService`; no raw filesystem access lives in the IPC layer.

### `settings`

| Method | Params | Result |
|---|---|---|
| `settings.get` | — | `Settings \| null` |
| `settings.save` | `Settings` | `void` |
| `settings.merge` | `Partial<Settings>` | `Settings` (merged result) |
| `settings.setLanguage` | `{ language: LanguagePreference }` | `{ settings: Settings; syncReport: SyncResult[] }` |

`settings.setLanguage` persists the language preference **and** rewrites the `<language>` block of the default `instruction` entity, returning the sync report from that save.

`Settings` shape lives in [`src/shared/settings.ts`](../../src/shared/settings.ts).

### `repo`

| Method | Params | Result |
|---|---|---|
| `repo.detectGit` | `{ path: string }` | `boolean` |
| `repo.getCurrentBranch` | `{ path: string }` | `string` |

Small helpers used by the InstructionsScreen folder picker. The old `repo.link` / `repo.unlink` / `repo.list` methods and their `LinkedRepoView` type were **removed** with `settings.linkedRepos` — project scope now lives on each entity's own `repoPath` (see the `instruction` namespace below).

### `workspace`

| Method | Params | Result |
|---|---|---|
| `workspace.list` | — | `Workspace[]` |
| `workspace.getActive` | — | `Workspace` |
| `workspace.create` | `{ name: string; rootPath: string }` | `Workspace` |
| `workspace.switchTo` | `{ id: string }` | `Workspace` |
| `workspace.delete` | `{ id: string }` | `void` |

`workspace.list` returns every registered workspace. `workspace.getActive` returns the currently active workspace. `workspace.create` registers a new workspace and bootstraps its `.ai-companion` data dir (does not switch to it). `workspace.switchTo` kills the outgoing workspace's live sessions and rebuilds the Entity-backed service graph against the target workspace. `workspace.delete` rejects (`validation`) if `id` is the active workspace.

### `project`

| Method | Params | Result |
|---|---|---|
| `project.list` | — | `Project[]` |
| `project.create` | `{ name: string; path: string }` | `Project` |
| `project.findOrCreateByPath` | `{ path: string }` | `Project` |
| `project.update` | `{ id: string; name?: string; path?: string }` | `Project` |
| `project.delete` | `{ id: string }` | `void` |

`project.list` returns every project registered under the active workspace.

### `dialog`

| Method | Params | Result |
|---|---|---|
| `dialog.selectFolder` | `{ defaultPath?: string }` (or `null`) | `{ canceled: boolean; path?: string }` |

### `skill`

| Method | Params | Result |
|---|---|---|
| `skill.list` | `{ scope?: 'personal' \| 'project' }` | `Skill[]` (workspace + plugin-provided, with `source` field) |
| `skill.get` | `{ id: string }` | `Skill` |
| `skill.save` | `{ skill: Skill; isCreate?: boolean }` | `{ skill: Skill; syncReport: SyncResult[] }` |
| `skill.delete` | `{ id: string; removeSymlinks: boolean }` | `{ ok: true }` |

`Skill` is the canonical `Entity` shape (`kind: 'skill'`) from [`src/shared/entity.ts`](../../src/shared/entity.ts) — flat fields (`name`, `description`, `content`, …), no nested `frontmatter`/`body`. A slash-command is now just a skill with `explicitOnly: true` (on-disk `disable-model-invocation: true`); there is no separate `command.*` namespace.

Saving or deleting a plugin-provided skill (`source.kind === 'plugin'`) raises `OperationNotAllowedForOriginError` (`kind: 'internal'` unless mapped). Validated by `EntityValidator` against `skillEntitySchema` in [`src/main/application/schemas/entity-schema.ts`](../../src/main/application/schemas/entity-schema.ts).

### `agent`

| Method | Params | Result |
|---|---|---|
| `agent.list` | `{ scope?: 'personal' \| 'project' }` | `Agent[]` (workspace + plugin-provided) |
| `agent.get` | `{ id: string }` | `Agent` |
| `agent.save` | `{ agent: Agent; isCreate?: boolean }` | `{ agent: Agent; syncReport: SyncResult[] }` |
| `agent.delete` | `{ id: string; removeSymlinks: boolean }` | `{ ok: true }` |

`Agent` is the canonical `Entity` shape (`kind: 'agent'`) — `systemPrompt` replaces the old `body`, plus optional `model` / `tools` / `deniedTools`. Same plugin-source guard as `skill.*`.

### `instruction`

| Method | Params | Result |
|---|---|---|
| `instruction.list` | `{}` | `Instruction[]` (personal singleton first when present, then every project instruction) |
| `instruction.get` | `{ id: string }` (`'default'` for personal; slug otherwise) | `Instruction` |
| `instruction.save` | `{ instruction: Instruction; isCreate?: boolean }` | `{ instruction: Instruction; syncReport: SyncResult[] }` |
| `instruction.delete` | `{ name: string; removeSymlinks?: boolean }` | `{ ok: true; syncReport?: SyncResult[] }` |

`Instruction` is a discriminated union: `PersonalInstruction` (`name === 'default'`, `scopes === ['personal']`) or `ProjectInstruction` (any slug except `'default'`, `scopes === ['project']`, absolute `repoPath: string`). Enforced by `personalInstructionId` / `projectInstructionSlug` (`src/main/domain/instruction-id.ts`) and by `instructionEntitySchema` (branch via `superRefine`). Storage is **frontmatter-free**; the personal singleton lives at `instructions/default.md`, project instructions at `instructions/project/<slug>/{INSTRUCTION.md,meta.json}` — see [Entity schema](customization-schema.md#instruction). `save`'s sync report fans out to Claude (`~/.claude/CLAUDE.md` + `~/AGENTS.md` for personal, `<repoPath>/.claude/CLAUDE.md` + `<repoPath>/AGENTS.md` for project) and — when Cursor is enabled — either the Cursor plugin files (personal) or `<repoPath>/AGENTS.md` (project). `delete` removes the entity plus its symlinks / generated files by default; pass `removeSymlinks: false` to keep the sync artefacts.

### `session`

| Method | Params | Result |
|---|---|---|
| `session.spawn` | `{ entityUrn: string }` | `SessionSnapshot` |
| `session.write` | `{ sessionId: string; data: string }` | `void` |
| `session.resize` | `{ sessionId: string; cols: number; rows: number }` | `void` |
| `session.kill` | `{ sessionId: string }` | `void` |
| `session.status` | `{ sessionId: string }` | `SessionSnapshot \| null` |

`SessionSnapshot` (`src/shared/session.ts`): `{ entityUrn: string; cwd: string; status: 'running' \| 'exited' }`. A session is anchored to a single Skill, Agent, or Instruction entity by its `urn` — there's no separate "project" registry, and the `sessionId` taken by `write`/`resize`/`kill`/`status` is always that same `urn` (the port itself never mints a separate id). `session.spawn` is idempotent: calling it again for an `entityUrn` that already has a live session returns the existing `SessionSnapshot` instead of spawning a second PTY, and concurrent calls for the same `entityUrn` share the same in-flight spawn rather than racing. Working directory is derived from the entity, never asked for: a `ProjectInstruction` uses its own `repoPath`; every other kind uses the app's workspace root. Backed by `SessionService` (`src/main/application/services/session-service.ts`) over `ClaudeSessionPort` (`NodePtySessionAdapter`, `src/main/infrastructure/claude-cli/`) — see [Session bounded context](architecture.md#session-bounded-context). `session.spawn` surfaces `kind: 'io'` for spawn failures (binary missing, PTY spawn error) and `kind: 'not_found'` for an unknown `entityUrn`; `session.write`/`resize`/`kill`/`status` never throw for an unrecognized or non-running `sessionId` — they silently no-op (`status` returns `null`). Live PTY output streams separately over the `session:output` / `session:exit` push channels (see above) — `session.spawn`'s response only confirms the process started, it doesn't carry any output itself.

### `command` *(removed)*

The `command.*` namespace is gone — there is no `command` entity kind anymore. A slash-command is now a `skill` with `explicitOnly: true` (`disable-model-invocation: true` in frontmatter); it's saved and listed through `skill.*`. Pre-existing `commands/*.md` files under the workspace are orphaned — there is no migration.

### `hook`

Hooks are not part of the canonical `Entity` model yet — they live in `.claude/settings.json` and are read/written by `hook-service.ts` independently of `EntityRepository` (Phase 1 will bring them under the `Entity` contract). They share the per-entity facade *pattern* (list/get/save/delete + scope), not the type.

| Method | Params | Result |
|---|---|---|
| `hook.list` | `{ scope?: 'personal' \| 'project' }` (default `'personal'`) | `Hook[]` |
| `hook.get` | `{ id: string; scope?: 'personal' \| 'project' }` | `Hook` |
| `hook.save` | `{ hook: { id?; event; matcher?; description?; handler }; scope?: 'personal' \| 'project' }` | `{ hook: Hook; syncReport: SyncResult[] }` |
| `hook.delete` | `{ id: string; scope?: 'personal' \| 'project' }` | `{ ok: true }` |

### `marketplace`

| Method | Params | Result |
|---|---|---|
| `marketplace.list` | `{ scope: 'personal' \| 'project' }` | `MarketplaceSummary[]` (record + parsed manifest if available) |
| `marketplace.get` | `{ scope; id }` | `MarketplaceSummary \| null` |
| `marketplace.add` | `{ scope; id; source: { path: string } }` | `void` (persists to `extraKnownMarketplaces`) |
| `marketplace.remove` | `{ scope; id }` | `void` |
| `marketplace.refresh` | `{ scope; id }` | `MarketplaceSummary \| null` (re-parses manifest from disk) |
| `marketplace.addFromUrl` | `{ scope; url: string }` | `{ id; manifest }` (clones/detects a marketplace from a Git URL, then persists it) |
| `marketplace.detect` | `{ url: string }` | marketplace detection result *(registered in `plugin-handlers.ts`)* |

`plugin.installFromMarketplace` and `plugin.previewFromMarketplace` (in the `plugin` namespace) install or inspect a plugin from a marketplace entry.

### `customization` *(removed)*

The `customization.*` IPC namespace has been **removed**, and so has the polymorphic `Customization`/`CustomizationFrontmatter` model behind it. All entity access now goes through the typed namespaces above (`skill`, `agent`, `instruction`, `hook`) backed by the canonical `Entity` contract in [`src/shared/entity.ts`](../../src/shared/entity.ts) — `src/shared/customization.ts` no longer exists. The renderer's `CustomizationListScreen` component and `useCustomizationList` hook keep their (now generic) names but are parameterized by a concrete `listMethod` (e.g. `skill.list`) rather than calling a `customization.*` method.

`SyncResult` still lives in [`src/shared/sync-result.ts`](../../src/shared/sync-result.ts). See [Entity schema](customization-schema.md) for the current field contract.

### `adapter`

| Method | Params | Result |
|---|---|---|
| `adapter.syncAll` | `{ adapterId?: string }` (or none) | `SyncResult[]` |
| `adapter.removeAll` | `{ adapterId: string }` | `RemoveAdapterResult` |
| `adapter.setEnabled` | `{ adapterId: string; enabled: boolean; removeSymlinks?: boolean; runSyncAll?: boolean }` | See below |
| `adapter.countDestinations` | `{ adapterId: string }` | `{ count: number }` |

`adapter.setEnabled` returns:

- When `enabled: false` — a `RemoveAdapterResult` (default `removeSymlinks: true`); pass `removeSymlinks: false` to skip cleanup.
- When `enabled: true` — `{ syncReport: SyncResult[] }` (default `runSyncAll: true`); pass `runSyncAll: false` to skip the sync.

`RemoveAdapterResult`:

```ts
interface RemoveAdapterResult {
  removed: number;
  skipped: number;
  errors: { destination: string; kind: string; message: string }[];
}
```

### `plugin`

| Method | Params | Result |
|---|---|---|
| `plugin.import` | `{ url: string; ref?: string; scope?: string }` | `PluginSummary` |
| `plugin.list` | `{ scope?: string }` | `PluginListItem[]` |
| `plugin.get` | `{ id: string; scope?: string }` | `PluginDetail` |
| `plugin.update` | `{ id: string; scope?: string }` | `PluginSummary` |
| `plugin.remove` | `{ id: string; scope?: string }` | `void` |
| `plugin.toggle` | `{ id: string; scope?: string; enabled: boolean }` | `void` |
| `plugin.createOwned` | `{ id: string; version: string; description?: string; scope?: string }` | `PluginSummary` |
| `plugin.deleteOwned` | `{ id: string; scope?: string }` | `void` |
| `plugin.publish` | `{ id: string; scope?: string; repoName?: string; visibility?: 'public' \| 'private'; version: string; commitMessage?: string }` | `PluginPublishInfo` |
| `plugin.installFromMarketplace` | `{ plugin: MarketplacePlugin; scope?: string; marketplaceId?: string }` | `PluginSummary` |
| `plugin.previewFromMarketplace` | `{ plugin: MarketplacePlugin }` | `PluginManifest` (artifact counts shown before install) |

**Plugin types:**

```ts
interface PluginListItem {
  id: string;
  name: string;
  version: string;
  source: 'imported' | 'owned';
  enabled: boolean;
}

interface PluginDetail extends PluginListItem {
  description?: string;
  author?: string;
  publishedTo?: Array<{ registry: string; url: string; version: string; publishedAt: string }>;
}

interface PluginSummary {
  id: string;
  version: string;
  enabled: boolean;
}

interface PluginPublishInfo {
  id: string;
  version: string;
  registryUrl: string;
  releaseUrl: string;
  publishedAt: string;
}
```

**Error conditions:**

- `plugin.import` — `{ kind: 'validation' }` if `url` is empty or invalid; `{ kind: 'external_api' }` if the remote registry is unreachable; `{ kind: 'conflict' }` if a plugin with that `id` already exists.
- `plugin.publish` — `{ kind: 'auth', message: 'PublishAuthMissing' }` if no GitHub PAT is configured; `{ kind: 'conflict' }` if the version already exists or local/remote branches diverge.

### `credentials`

| Method | Params | Result |
|---|---|---|
| `credentials.setGithubToken` | `{ token: string }` | `void` |
| `credentials.clearGithubToken` | — | `void` |
| `credentials.hasGithubToken` | — | `{ hasToken: boolean }` |

**Credential storage:**

- `setGithubToken` — encrypts the PAT using Electron's `safeStorage` and persists it; the token is **never** returned by any method.
- `clearGithubToken` — erases the stored credential.
- `hasGithubToken` — returns only a boolean; never returns the token itself.

### `mcp`

| Method | Params | Result |
|---|---|---|
| `mcp.list` | `{}` | `McpServer[]` (global + project-local + project-shared + plugin + detected, with health) |
| `mcp.get` | `{ id: string }` | `McpServer \| undefined` |
| `mcp.save` | `{ server: McpServerInput; isCreate?: boolean }` | `{ ok: true }` |
| `mcp.delete` | `{ id: string }` | `{ ok: true }` |
| `mcp.setEnabled` | `{ id: string; enabled: boolean }` | `{ ok: true }` |
| `mcp.authenticate` | `{ id: string }` | `{ ok: true }` |

`McpServer` is read-only when `source.kind === 'plugin'` **or** `source.kind === 'detected'`. `mcp.delete` and `mcp.setEnabled` throw `OperationNotAllowedForOriginError` (kind `validation`) for plugin- and detected-sourced ids. `mcp.save` cannot target a plugin/detected server by construction (its `scope` excludes both). Writes to `~/.claude.json` are surgical (only `mcpServers` / `projects[path].mcpServers` are touched), atomic, and backed up to `<file>.bak`.

**Detected servers** (`source.kind === 'detected'`, `scope === 'detected'`, `transport` absent, `def === {}`) are servers the Claude Code runtime knows about (via logs / `mcp-needs-auth-cache.json`) that have a health problem (`error` or `needs-auth`) **and** no broker-readable config. They are surfaced read-only so failures are visible; healthy orphans are intentionally omitted to avoid noise. `mcp.authenticate` opens the external claude.ai connectors page (`https://claude.ai/customize/connectors`) — the app cannot complete the OAuth flow itself (it has no def/URL for runtime-managed connectors), so it acts as a trampoline. The `id` is validated but the v1 target URL is fixed regardless of which server. Throws `internal` if no shell port is configured.

Disable semantics: project-shared servers use `projects[repoPath].disabledMcpjsonServers` in `~/.claude.json`; inline (global / project-local) servers are parked in `~/.ai-companion/mcp-disabled.json` and restored on enable.

### `health`

| Method | Params | Result |
|---|---|---|
| `health.getReport` | `{ scope?: 'personal' \| 'project' }` (default: `'personal'`) | `HealthReport` |
| `health.notify` | `{ title: string; body: string }` | `void` |

`scope` only affects the **config-drift** category (it lists plugins per scope). The `mcp-auth`, `mcp-runtime`, `symlink` and `generated-file` categories read global state and are identical across scopes — see the `HealthCollector` interface docs.

**Types** (see [`src/shared/health.ts`](../../src/shared/health.ts)):

```ts
type Severity = 'ok' | 'warning' | 'error';
type HealthCategory = 'mcp-auth' | 'mcp-runtime' | 'config-drift' | 'symlink' | 'generated-file';

interface HealthCheck {
  id: string;           // stable id used for notification diffing
  category: HealthCategory;
  severity: Severity;
  title: string;
  detail?: string;
  target?: string;      // MCP/plugin/symlink name this check concerns
  remediation?: string; // actionable hint, e.g. "Run /mcp to authenticate"
  observedAt: string;   // ISO timestamp
}

interface HealthReport {
  generatedAt: string;
  worst: Severity;      // drives the nav badge color
  counts: { ok: number; warning: number; error: number };
  checks: HealthCheck[];
}
```

**Error conditions:**

- `health.getReport` — `{ kind: 'validation' }` if `scope` is present but not `'personal'` or `'project'`.
- `health.notify` — `{ kind: 'validation' }` if `title` or `body` is missing or not a string.

## Validation rules (handler side)

Every handler that takes parameters validates them before delegating to the service. Common patterns:

- Non-empty string fields → `validation` error: `Missing or invalid '<field>'`.
- Enum fields (`type`, `targetType`) → `validation` error: `Invalid '<field>' (must be <a> | <b> | …)`.
- Object fields where an object is required → `validation` error: `Invalid '<label>' payload`.
- Booleans are required when the field is non-optional → `validation` error: `Missing or invalid '<field>'`.

Schema-level validation (entity field rules) runs deeper, inside the services — see [Entity schema](customization-schema.md).

## Adding a new method

1. Define params and result types in `src/shared/ipc-contract.ts` (or a focused shared module).
2. Add the handler in `src/main/ipc/registry.ts` under the appropriate namespace, validating raw params with the helpers (`asString`, `asObject`, `asScope`, …) from [`_validators.ts`](../../src/main/ipc/_validators.ts).
3. Use `callIpc<Result>('namespace.method', params)` from the renderer.

There is no separate registration file for the channel itself — the dispatcher receives the full handler map and looks up `method` directly.

## See also

- [Architecture overview](architecture.md) — how IPC sits between renderer and services.
- [Entity schema](customization-schema.md) — field rules enforced after the handler accepts the payload.
