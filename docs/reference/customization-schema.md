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
  metadata: EntityMetadata; // version, tags?, createdAt, updatedAt
  source: EntitySource;     // { kind: 'workspace' } | { kind: 'plugin'; pluginId; provenance }
  ext?: Record<string, unknown>;
}

interface Skill extends Entity { kind: 'skill'; content: string; explicitOnly?: boolean; }
interface Agent extends Entity { kind: 'agent'; systemPrompt: string; model?: string; tools?: string[]; deniedTools?: string[]; }

// Instruction is a discriminated union by scope. Personal is the singleton
// (name === 'default'); Project is per-repo and carries the repoPath directly.
type Instruction = PersonalInstruction | ProjectInstruction;
interface PersonalInstruction extends Entity { kind: 'instruction'; name: 'default'; scopes: ['personal']; content: string; }
interface ProjectInstruction  extends Entity { kind: 'instruction'; scopes: ['project'];  content: string; repoPath: string; }
```

`skill` and `agent` are still stored as a Markdown file with a YAML frontmatter block followed by a body — `EntitySerializer` (`src/main/application/entity/entity-serializer.ts`) maps the flat fields to/from frontmatter:

```markdown
---
name: my-skill
type: skill
description: Short, one-line summary of what this entity does.
scopes:
  - personal
  - project
version: 1.0.0
createdAt: 2026-05-04T12:00:00.000Z
updatedAt: 2026-05-04T12:00:00.000Z
tags:
  - example
---

# Body

Free Markdown — this becomes `content` (skill) or `systemPrompt` (agent).
```

`instruction` is stored **frontmatter-free**: the file is the body (`content`) verbatim so the assistant-facing target (`AGENTS.md`, `CLAUDE.md`) never has to strip YAML. The storage layout differs by scope:

- **Personal** singleton → `instructions/default.md` (body only). Metadata (`description`, `metadata.*`) is defaulted on read; the legacy fallback `global-instructions/default.md` is still tolerated for backwards compatibility on `get`/`exists`.
- **Project/Workspace** → `instructions/project/<slug>/INSTRUCTION.md` for the body, `instructions/project/<slug>/meta.json` for the sidecar (`description`, `version`, `createdAt`, `updatedAt`, `scope?`, `scopeId?`, `tags?` — plus a legacy, read-only `repoPath?` tolerated on parse for pre-migration data). Both files are written atomically; a slug dir with a body but no `meta.json` is treated as "not found" so partial writes don't poison the list.

The old dead fields (`activation`, `globs`) were removed; the on-disk model is exactly what's described above.

Entities are validated by `EntityValidator` (`src/main/application/services/entity-validator.ts`) against the Zod schemas in [`src/main/application/schemas/entity-schema.ts`](../../src/main/application/schemas/entity-schema.ts) — one schema per kind (`skillEntitySchema`, `agentEntitySchema`, `instructionEntitySchema`). This replaced the old, since-removed `schema-validator.ts`/`SchemaValidator`.

## Common fields

All three kinds share these fields (defined once in `entity-schema.ts`'s `entityBase`, extended per kind). The on-disk frontmatter keys for `skill`/`agent` are unchanged from before the refactor; `metadata.*` maps to top-level frontmatter keys (`version`, `tags`, `createdAt`, `updatedAt`), and `kind` maps to frontmatter `type`.

| Field | Type | Required | Rule |
|---|---|---|---|
| `name` | string | yes | Slug — must match `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens; no leading hyphen). |
| `kind` (frontmatter `type`) | enum | yes | One of `skill` · `agent` · `instruction`. |
| `description` | string | yes for skill/agent | 1–1024 characters for `skill`/`agent` (empty string rejected); always `''` for `instruction` (frontmatter-free, see above). |
| `scopes` | array | yes | At least 1 entry, no duplicates, each `personal`, `project`, or `workspace`. Per-kind: `instruction` is a discriminated union (exactly `['personal']`, `['project']`, or `['workspace']`); `skill`/`agent` are temporarily restricted to `['personal']` — see the TODO block in `entity-schema.ts`. |
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
- No additional constraints beyond the common fields. `kind` (frontmatter `type`) must be the literal `skill`.

### `agent`

- `systemPrompt: string` (the Markdown body — the old `body` field, renamed).
- `model?: string`, `tools?: string[]`, `deniedTools?: string[]` — optional frontmatter fields, passed through verbatim.
- No additional constraints beyond the common fields. `kind` (frontmatter `type`) must be the literal `agent`.

### `instruction`

Discriminated by `scopes[0]`: **Personal** is the machine-wide singleton, **Project**/**Workspace** each
carry a `scopeId` resolved against a `Project`/`Workspace` (see [Architecture](architecture.md#workspace--project)).
All variants are stored frontmatter-free.

| Variant | `name` | `scopes` | `scopeId` |
|---|---|---|---|
| Personal (singleton) | must be the literal `default` | exactly `["personal"]` | must be absent |
| Project (per `Project`) | any slug except `default` | exactly `["project"]` | required, references a `Project.id` |
| Workspace (per `Workspace`) | any slug except `default` | exactly `["workspace"]` | required, references a `Workspace.id` |

Enforced by `instructionEntitySchema` in `entity-schema.ts` (branch via `superRefine`) and by the domain
guards `personalInstructionId()` and `projectInstructionSlug()` in `src/main/domain/instruction-id.ts`.
`resolveScopePath(entity, { workspaceService, projectService })` (`src/main/application/resolve-scope-path.ts`)
maps `scopeId` to a concrete absolute path at sync/session-spawn time — the path itself is never persisted
on the entity, only the id.

A pre-existing on-disk `ProjectInstruction` (from before this scoping generalization) carries the old
`repoPath` sidecar field instead of `scopeId`; `InstructionService.get`/`.list` migrate it transparently on
first read — see the storage layout note above and `docs/reference/architecture.md`'s Workspace/Project
section.

## Body

The Markdown body is unconstrained at the schema layer — `content: string` (skill/instruction) or `systemPrompt: string` (agent). Validation only covers the structured fields (frontmatter for skill/agent; the flat `Entity` fields in memory for instruction, since instruction has no on-disk frontmatter to validate).

## Scope semantics

| Scope | Meaning | Adapter target (typical) |
|---|---|---|
| `personal` | Applies machine-wide for the author. | `~/.claude/` (personal instruction: **both** `~/.claude/CLAUDE.md` and `~/AGENTS.md`; and — when Cursor is enabled — the plugin under `~/.cursor/plugins/ai-companion/`). |
| `project` | Applies to the `Project` the entity's `scopeId` references. | For a project instruction: `<resolved Project.path>/.claude/CLAUDE.md` + `<resolved Project.path>/AGENTS.md`. Skill/agent `project` scope is currently disallowed — a per-entity `scopeId` for skill/agent is a follow-up. |
| `workspace` | Applies to the `Workspace` the entity's `scopeId` references. | For a workspace instruction: `<resolved Workspace.rootPath>/.claude/CLAUDE.md` + `<resolved Workspace.rootPath>/AGENTS.md`. Not yet exposed in any editor UI (schema/service-level only — see the Workspace/Project spec). |

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
- [PRD — schema validation as should-have](../explanation/prd.md#4-scope) — why the schema is currently lenient (`passthrough`) and what it would tighten if promoted from should-have.
