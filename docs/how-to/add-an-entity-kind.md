---
title: Add an entity kind
description: Contributor guide — bring a new customization kind (e.g. hooks or MCP servers) under the canonical Entity model so it is stored, validated, watched and synced like skills and agents.
---

# Add an entity kind

> **Audience:** contributors. Read [Entity schema](../reference/customization-schema.md) and
> [Architecture → Hexagonal layers](../reference/architecture.md#hexagonal-layers-main) first.

`EntityKind` (`src/shared/entity.ts`) already reserves `'mcp'` and `'hook'`, which today are edited in
place in Claude Code's own files by `mcp-service` / `hook-service`. Moving one of them — or adding a
brand-new kind — under `Entity` means touching every layer below. The `agent` kind is the simplest
complete example; `grep -rn "'agent'" src/` lists most touchpoints.

## Checklist

### Shared model — `src/shared/`

- [ ] `entity.ts`: add the kind's interface (extending the shared `Entity` base: `name`, `description`,
      `metadata`, `source`, `scopes`, `scopeId?`, `urn`) and add it to the `Entity` union. URNs are
      `urn:<kind>:<name>` via `entityUrn`.
- [ ] `settings.ts`: if the kind has its own top-level folder that must exist from day one, add it to
      `WorkspacePaths` (bootstrapped on workspace creation and activation).

### Storage and validation — `src/main/`

- [ ] `application/schemas/entity-schema.ts`: a Zod schema extending `entityBase` with `kind: z.literal(...)`.
- [ ] `application/services/entity-validator.ts`: map the kind to its schema (unknown kinds are rejected).
- [ ] `application/entity/entity-serializer.ts`: entity ↔ file content (frontmatter keys, body field).
      Keep it lossless — a field the editor does not show must survive a save (cf. `explicitOnly` ↔
      `disable-model-invocation`).
- [ ] `infrastructure/entity/fs-entity-repository.ts`: the kind's folder in `FOLDER`, its file path, and
      `list`/`get`/`save`/`delete` handling. Tolerate a malformed file in `list` (skip it), as the other kinds do.
- [ ] `application/entity/entity-watch-path.ts`: the reverse mapping (file path → `{ kind, name }`), so
      external edits re-sync. Keep it the exact inverse of the repository's layout.

### Sync

- [ ] `application/services/adapter-manager.ts`: the kind's canonical source path in `entitySourcePath`
      (what a symlink points at).
- [ ] Each adapter in `infrastructure/adapters/`: destinations for the new kind, or `[]` where the harness
      has no equivalent. See [Add a harness adapter](add-a-harness-adapter.md#3-implement-the-adapter-port)
      for the symlink-vs-write rules, and add the paths to [Adapter targets](../reference/adapter-targets.md).

  If the harness format is a shared file that many entities write into (e.g. all MCP servers live in one
  `~/.claude.json`), neither strategy fits as-is: a symlink would expose one entity, a `write` would clobber
  the others. That needs a new materialization strategy — design it before starting.

### Use case and IPC

- [ ] `application/services/<kind>-service.ts`: a thin facade over `EntityService` (see
      `agent-service.ts`), adding plugin provenance merging if plugins can provide the kind
      (`plugin-provenance.ts`). Plugin-provided entities are read-only.
- [ ] Wire the service in `application/workspace-scoped-services.ts`.
- [ ] `ipc/<kind>-handlers.ts` with `list` / `get` / `resolvePath` / `save` / `delete`, registered in
      `ipc/registry.ts` — see [Add an IPC method](add-an-ipc-method.md).
- [ ] If the kind was previously handled by a non-Entity service (hooks, MCP), plan the migration of
      existing on-disk data and remove the old service and namespace in the same change, as Phase 0 did for
      `command`.

### Renderer — `src/renderer/`

- [ ] `lib/blank-customization.ts`: a blank entity for the create flow.
- [ ] `components/workspace/EditorPanel.tsx`: the kind's entry in `SAVE_BY_KIND`, and its body field.
- [ ] `components/workspace/EntityTreeGroup.tsx` and `ControlPanelContent.tsx`: widen the `'skill' | 'agent'`
      unions and render a group for the kind.
- [ ] `components/shell/nav.ts`: its icon (`ENTITY_GROUP_ICONS`) and accent color (`ENTITY_ACCENT_COLOR`).
- [ ] `hooks/use-entity-change-invalidation.ts`: invalidate the kind's list query on `entity:changed`.

### Tests and docs

- [ ] Schema, serializer round-trip, repository and watch-path tests under `tests/main/`.
- [ ] Adapter destination tests for each adapter.
- [ ] Handler tests; a renderer test for the tree group.
- [ ] [Entity schema](../reference/customization-schema.md), [IPC contract](../reference/ipc-contract.md),
      [Adapter targets](../reference/adapter-targets.md) and [On-disk layout](../reference/on-disk-layout.md).

Release gate: `npm run lint && npm run typecheck && npm test`.
