---
title: Entity schema
description: Field contract for the canonical Entity model (skill, agent, instruction) — flat TS shape, on-disk frontmatter rules, per-kind constraints and validation error shape.
---

# Entity schema

An **entity** is the canonical, tool-agnostic unit synced to Claude Code — the `Entity` interface in [`src/shared/entity.ts`](../../src/shared/entity.ts). It replaced the old polymorphic `Customization`/`CustomizationFrontmatter` model: fields are **flat** on the object (`entity.name`, `entity.description`, `entity.content`) rather than nested under `frontmatter`/`body`, and every entity carries a `urn` (`urn:{kind}:{name}`).

Three kinds are implemented today — `skill`, `agent`, `instruction`. (`EntityKind` also lists `'mcp'` and `'hook'` for a future unification; those two are **not yet** canonical entities — `hook-service`/`mcp-service` have their own separate schemas and storage, see [Architecture](architecture.md).) The former `command` kind has been **removed**: a slash-command is now a `skill` with `explicitOnly: true` (↔ frontmatter `disable-model-invocation: true`). Existing `commands/*.md` files under the workspace are orphaned — there is no migration.

```ts
interface Entity {
  urn: string;              // `urn:{kind}:{name}`
  kind: EntityKind;
  name: string;
  description: string;
  scopes: Scope[];
  scopeId?: string;          // a Workspace.id — required for scopes[0] === 'workspace'; absent for 'personal'
  metadata: EntityMetadata; // version, tags?, createdAt, updatedAt
  source: EntitySource;     // { kind: 'workspace' } | { kind: 'plugin'; pluginId; provenance }
  ext?: Record<string, unknown>;
}

interface Skill extends Entity { kind: 'skill'; content: string; explicitOnly?: boolean; }
interface Agent extends Entity { kind: 'agent'; systemPrompt: string; model?: string; tools?: string[]; deniedTools?: string[]; }

type Scope = 'personal' | 'workspace';  // personal = Global (~/.ai-companion); workspace = one opened folder

// One interface, two valid shapes picked by scopes[0] (enforced by instructionEntitySchema;
// isPersonalInstruction / isWorkspaceInstruction tell them apart): the personal singleton
// (name === 'default', scopes ['personal'], no scopeId) or a workspace instruction (any other
// slug, scopes ['workspace'], scopeId = Workspace.id). Neither carries a path field —
// resolveScopePath turns scopeId into the workspace root at point of use.
interface Instruction extends Entity { kind: 'instruction'; content: string; }
```

`skill` and `agent` are still stored as a Markdown file with a YAML frontmatter block followed by a body — `EntitySerializer` (`src/main/application/entity/entity-serializer.ts`) maps the flat fields to/from frontmatter:

```markdown
---
name: my-skill
type: skill
description: Short, one-line summary of what this entity does.
scopes:
  - workspace
scopeId: 3f9a2b1c-...  # Workspace.id — omitted entirely for scopes: [personal]
version: 1.0.0
createdAt: 2026-05-04T12:00:00.000Z
updatedAt: 2026-05-04T12:00:00.000Z
tags:
  - example
---

# Body

Free Markdown — this becomes `content` (skill) or `systemPrompt` (agent).
```

Where an entity's files live depends on its scope: a `personal` entity is stored in Global's data dir (`~/.ai-companion/`), a `workspace` entity in that workspace's own data dir (`<root>/.ai-companion/`) — the paths below are relative to that dir. `ScopedEntityRepository` routes each write by `scopes[0]`, so changing an entity's scope moves its files between the two (see [Architecture](architecture.md#global--workspace)).

`instruction` is stored **frontmatter-free**: the file is the body (`content`) verbatim so the assistant-facing target (`AGENTS.md`, `CLAUDE.md`) never has to strip YAML. The storage layout differs by scope:

- **Personal** singleton (Global) → `instructions/default.md` (body only). Metadata (`description`, `metadata.*`) is defaulted on read; the legacy fallback `global-instructions/default.md` is still tolerated for backwards compatibility on `get`/`exists`.
- **Workspace** (the workspace's data dir) → `instructions/project/<slug>/INSTRUCTION.md` for the body, `instructions/project/<slug>/meta.json` for the sidecar (`InstructionSidecar`: `description`, `version`, `createdAt`, `updatedAt`, `tags?`, `scope: 'workspace'`, `scopeId`). The `project/` directory name is legacy, kept to avoid churn. A sidecar without `scopeId` fails to parse — the old `repoPath`-only shape was rescoped once by the boot migration. Both files are written atomically; a slug dir with a body but no `meta.json` is treated as "not found" so partial writes don't poison the list.

The old dead fields (`activation`, `globs`) were removed; the on-disk model is exactly what's described above.

Entities are validated by `EntityValidator` (`src/main/application/services/entity-validator.ts`) against the Zod schemas in [`src/main/application/schemas/entity-schema.ts`](../../src/main/application/schemas/entity-schema.ts) — one schema per kind (`skillEntitySchema`, `agentEntitySchema`, `instructionEntitySchema`). This replaced the old, since-removed `schema-validator.ts`/`SchemaValidator`.

## Common fields

All three kinds share these fields (defined once in `entity-schema.ts`'s `entityBase`, extended per kind). The on-disk frontmatter keys for `skill`/`agent` are unchanged from before the refactor; `metadata.*` maps to top-level frontmatter keys (`version`, `tags`, `createdAt`, `updatedAt`), and `kind` maps to frontmatter `type`.

| Field | Type | Required | Rule |
|---|---|---|---|
| `name` | string | yes | Slug — must match `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens; no leading hyphen). |
| `kind` (frontmatter `type`) | enum | yes | One of `skill` · `agent` · `instruction`. |
| `description` | string | yes for skill/agent | 1–1024 characters for `skill`/`agent` (empty string rejected); always `''` for `instruction` (frontmatter-free, see above). |
| `scopes` | array | yes | At least 1 entry, no duplicates, each `personal` or `workspace`. All three kinds are single-scope: exactly `['personal']` or `['workspace']` — enforced per-kind by a `superRefine` (see [Per-kind rules](#per-kind-rules)). |
| `scopeId` | string | conditional | Required (non-empty) when `scopes[0]` is `workspace`; must be absent when `scopes[0]` is `personal`. References a `Workspace.id` — resolved to a path at use time by `resolveScopePath` (see [Scope semantics](#scope-semantics)). On save, `EntityService` additionally requires it to be the **open** workspace (`validation`, `details.reason` `no-active-workspace` at Início or `scope-id-mismatch` otherwise). |
| `metadata.version` | string | yes | Semver `^\d+\.\d+\.\d+(-[\w.-]+)?$` (e.g. `1.2.3`, `1.2.3-rc.1`). |
| `metadata.createdAt` | string | yes | ISO 8601 datetime (e.g. `2026-05-04T12:00:00.000Z`). |
| `metadata.updatedAt` | string | yes | ISO 8601 datetime. |
| `metadata.tags` | array | no | Optional. Each tag must match `^[a-z0-9-]+$`. |
| `source` | object | yes | `{ kind: 'workspace' }` or `{ kind: 'plugin'; pluginId; provenance }`. Plugin-sourced entities reject `save`/`delete` (`OperationNotAllowedForOriginError`). |

> Every kind's Zod schema uses `.passthrough()`, so unknown frontmatter keys are kept on `entity.ext` rather than rejected. Adapters and renderer code, however, only read the fields above.

## Per-kind rules

Each kind's schema extends the common base. Only the differences are listed.

### `skill`

- `content: string` (the Markdown body).
- `explicitOnly?: boolean` — maps to frontmatter `disable-model-invocation: true` when set. A skill with `explicitOnly: true` is not offered for implicit model invocation — this is exactly what the removed `command` kind used to mean; commands are now expressed this way.
- `scopes`/`scopeId` follow the shared single-scope rule (see [Common fields](#common-fields)): `personal` | `workspace`, with `scopeId` required for `workspace`. Scope picks both the store — `skills/<name>/` under Global's `~/.ai-companion/` for `personal`, under the workspace's `<root>/.ai-companion/` for `workspace` — and the adapter sync destination (see [Scope semantics](#scope-semantics)).
- `kind` (frontmatter `type`) must be the literal `skill`.

### `agent`

- `systemPrompt: string` (the Markdown body — the old `body` field, renamed).
- `model?: string`, `tools?: string[]`, `deniedTools?: string[]` — optional frontmatter fields, passed through verbatim.
- `scopes`/`scopeId` follow the same single-scope rule as `skill` (see above).
- `kind` (frontmatter `type`) must be the literal `agent`.

### `instruction`

Split by `scopes[0]`: **Personal** is the machine-wide singleton (stored in Global), **Workspace** carries a
`scopeId` resolved against a `Workspace` (stored in that workspace's data dir; any number per workspace) — see
[Architecture](architecture.md#global--workspace). Both are stored frontmatter-free.

| Variant | `name` | `scopes` | `scopeId` |
|---|---|---|---|
| Personal (singleton) | must be the literal `default` | exactly `["personal"]` | must be absent |
| Workspace (per `Workspace`) | any slug except `default` | exactly `["workspace"]` | required, references a `Workspace.id` |

Enforced by `instructionEntitySchema` in `entity-schema.ts` (branch via `superRefine`) and by the domain
guards `personalInstructionId()` and `projectInstructionSlug()` in `src/main/domain/instruction-id.ts`.
`resolveScopePath(entity, { workspaceService })` (`src/main/application/resolve-scope-path.ts`)
maps `scopeId` to a concrete absolute path at sync/session-spawn time — the path itself is never persisted
on the entity, only the id.

Project-era data (`scopes: ['project']` entities, `repoPath`-only sidecars) is no longer read: the one-time
boot migration (`WorkspaceModelMigration`) rescoped it to `workspace` and moved it into the target
workspace's data dir — see `docs/reference/architecture.md`'s "Global / Workspace" section.

## Body

The Markdown body is unconstrained at the schema layer — `content: string` (skill/instruction) or `systemPrompt: string` (agent). Validation only covers the structured fields (frontmatter for skill/agent; the flat `Entity` fields in memory for instruction, since instruction has no on-disk frontmatter to validate).

## Scope semantics

| Scope | Meaning | Adapter target (typical) |
|---|---|---|
| `personal` | Global — applies machine-wide for the author. Stored in `~/.ai-companion/`. | `~/.claude/` (instruction: **both** `~/.claude/CLAUDE.md` and `~/AGENTS.md`; skill/agent: `~/.claude/skills/<name>` / `~/.claude/agents/<name>.md`; and — when Cursor is enabled — the Cursor equivalents, personal instruction via the plugin under `~/.cursor/plugins/ai-companion/`). |
| `workspace` | Applies to the `Workspace` (an opened folder) the entity's `scopeId` references. Stored in `<rootPath>/.ai-companion/`. | For a workspace instruction: `<resolved Workspace.rootPath>/.claude/CLAUDE.md` + `<resolved Workspace.rootPath>/AGENTS.md`. For a workspace skill/agent: `<resolved Workspace.rootPath>/.claude/skills/<name>` / `.claude/agents/<name>.md` (and the Cursor equivalents). |

## Validation result

`EntityValidator.validate(entity)` (`src/main/application/services/entity-validator.ts`) does not return a result object — it **throws** on failure:

```ts
class EntityValidator {
  validate(entity: Entity): void; // throws DomainError on failure
}
```

On success it returns `void`. On failure it throws:

```ts
new DomainError('validation', 'Entity failed validation', {
  errors: Array<{ path: string; message: string }>,
});
```

`path` is the dotted Zod issue path rooted at the **entity field**, not `frontmatter` (e.g. `name`, `metadata.version`, `scopes[0]`) — there is no `frontmatter.` prefix, since the in-memory model is flat. `message` is Zod's own issue message (or the custom message supplied in `entity-schema.ts`, e.g. `'instruction name must be "default"'`). The dispatcher maps this straight to `IpcError { kind: 'validation', message: 'Entity failed validation', details: { errors } }` — see [IPC contract](ipc-contract.md#dispatch-and-error-mapping). This replaced the old `SchemaValidator.validate()` → `ValidationResult` API and its curated error-`kind` taxonomy (`required`, `format`, `min-length`, …), which no longer exists; there is no per-issue `kind` field today, only `path` + `message`.

## See also

- [Architecture overview](architecture.md) — where the validator sits in the layers.
- [IPC contract](ipc-contract.md) — `skill.*` / `agent.*` / `instruction.*` methods that carry these entities over IPC.
- [PRD — schema validation as should-have](../explanation/prd.md#5-scope) — why the schema is currently lenient (`passthrough`) and what it would tighten if promoted from should-have.
