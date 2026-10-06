---
title: Adapter targets
description: Every path each harness adapter writes to, per entity kind and scope, and how conflicts with existing files are resolved.
---

# Adapter targets

Where each `manage` adapter materializes an `Entity`. Source of truth:
`src/main/infrastructure/adapters/{claude,cursor}-adapter.ts`. For what a scope *means*, see
[Entity schema → scopes](customization-schema.md); for why most targets are symlinks, see
[Why symlinks](../explanation/why-symlinks.md).

## Notation

| Symbol | Meaning |
|---|---|
| `~` | The user's home directory. |
| `<data>` | The active workspace's data dir — `<workspace.rootPath>/.ai-companion/` (`~/.ai-companion/` for the default workspace). See [On-disk layout](on-disk-layout.md). |
| `<scope>` | The path a `project`/`workspace`-scoped entity resolves to at sync time: `Project.path` or `Workspace.rootPath`, looked up from `scopeId` by `resolveScopePath` (`src/main/application/resolve-scope-path.ts`). Never cached on the entity. |
| `<name>` | The entity's `name`. |
| 🔗 | `strategy: 'symlink'` — a symlink pointing at the canonical file in `<data>`. |
| ✍️ | `strategy: 'write'` — a generated regular file, recognized as app-owned by a marker. |

## Claude Code (`claude`)

Enabled by default. Every destination is a symlink — the Claude adapter never uses `write`.

| Entity | `personal` | `project` / `workspace` | Canonical source |
|---|---|---|---|
| Skill | 🔗 `~/.claude/skills/<name>` (dir) | 🔗 `<scope>/.claude/skills/<name>` (dir) | `<data>/skills/<name>/` |
| Agent | 🔗 `~/.claude/agents/<name>.md` | 🔗 `<scope>/.claude/agents/<name>.md` | `<data>/agents/<name>.md` |
| Instruction | 🔗 `~/.claude/CLAUDE.md` **and** 🔗 `~/AGENTS.md` | 🔗 `<scope>/.claude/CLAUDE.md` **and** 🔗 `<scope>/AGENTS.md` | personal: `<data>/instructions/default.md`; scoped: `<data>/instructions/project/<name>/INSTRUCTION.md` |

## Cursor (`cursor`)

Off by default (`settings.adapters.cursor.enabled`). `manage` only — see
[the harness model](../explanation/harness-model.md#the-two-capabilities).

| Entity | `personal` | `project` / `workspace` |
|---|---|---|
| Skill | 🔗 `~/.cursor/skills/<name>` (dir) | 🔗 `<scope>/.cursor/skills/<name>` (dir) |
| Agent | 🔗 `~/.cursor/agents/<name>.md` | 🔗 `<scope>/.cursor/agents/<name>.md` |
| Instruction | ✍️ `~/.cursor/plugins/ai-companion/.cursor-plugin/plugin.json` **and** ✍️ `~/.cursor/plugins/ai-companion/rules/personal-default.mdc` | ✍️ `<scope>/AGENTS.md` |

The personal instruction is shipped as a local Cursor plugin whose single rule has `alwaysApply: true`,
because Cursor has no home-level equivalent of `~/.claude/CLAUDE.md`. This layout is not a public Cursor
API and may break in a future Cursor release; the helper is isolated in
`src/main/application/entity/cursor-plugin-manifest.ts`.

## Ownership markers (✍️ targets)

A generated file is app-owned when it contains its marker. Markers come from `src/shared/brand.ts`:

| Target | Marker | Check |
|---|---|---|
| `AGENTS.md` | `<!-- Managed by AI Companion — edits will be overwritten -->` (first line) | starts with |
| `plugin.json` | `"x-ai-companion-managed": true` | includes |
| `personal-default.mdc` | `x-ai-companion-managed: true` (YAML frontmatter) | includes |

Markers from the previous product name (`Superset AI`, `brand.legacy`) are also recognized, so files
written before the rename are still treated as owned.

## What happens when the destination already exists

Applies on every sync (`AdapterManager` → `SymlinkManager.create` / `FileMaterializer.write`).

| Found at destination | 🔗 symlink target | ✍️ write target |
|---|---|---|
| Nothing | Symlink created. `ok`. | File written. `ok`. |
| Symlink to the right source | No-op. `ok`. | — |
| Symlink elsewhere | Re-pointed. `ok` (`details.replacedTarget`). | Link target's content backed up, link removed, file written. `conflict`. |
| Regular file | Backed up, replaced by the symlink. `conflict`. | Owned (marker present): overwritten. `ok`. Foreign: backed up, then overwritten. `conflict`. |
| Directory | Refused — directories are not backed up. `error` (`reason: 'backup-directory'`). | — |

Backups go to `<data>/_backups/<timestamp>/<path relative to data dir, or absolute path without the leading slash>`.
A `conflict` is not a failure: it means "overwritten, and here is the backup" (`details.backupPath`).
The **Sync report** dialog (shown after saving an entity or enabling an adapter, when the report is
not all `ok`) and the **Diagnóstico** screen list them.

## Removal

- Deleting an entity with `removeSymlinks: true` removes its destinations.
- Disabling an adapter (`adapter.setEnabled { enabled: false }`) removes that adapter's symlinks
  **and** its owned generated files, unless `removeSymlinks: false` is passed.
- A symlink is only removed if it points into the workspace data dir; a regular file at a symlink
  destination is skipped (`skipped-real-file`). A generated file is only removed if it carries its marker.

## Known issues

- **Both adapters claim `<scope>/AGENTS.md` for a scoped instruction.** Claude symlinks it, Cursor
  writes a generated file. With both adapters enabled, each sync replaces the other's version and
  leaves a backup in `_backups/` every time. Until this is resolved, avoid enabling Cursor if you rely on
  project/workspace instructions — or expect the file to be the Cursor-generated copy after a sync
  (Cursor runs after Claude in the adapter map, `src/main/application/workspace-scoped-services.ts`).
- **Switching workspace does not prune targets.** `~/.claude/` keeps symlinks to the previous
  workspace's entities until they are re-synced; see
  [Architecture → Workspace / Project](architecture.md#workspace--project).
- Hooks and MCP servers are not `Entity` kinds yet and are not routed through adapters; they are written
  straight into Claude Code's own files — see [On-disk layout](on-disk-layout.md#files-the-app-edits-outside-its-data-dir).
