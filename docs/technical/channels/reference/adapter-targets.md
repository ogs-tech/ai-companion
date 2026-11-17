---
title: Adapter targets
description: Every path each harness adapter writes to, per entity kind and scope, and how conflicts with existing files are resolved.
---

# Adapter targets

Where each `manage` adapter materializes an `Entity`. Source of truth:
`src/main/infrastructure/adapters/{claude,cursor}-adapter.ts`. For what a scope *means*, see
[Entity schema → scopes](../../customizations/reference/customization-schema.md); for why most targets are symlinks, see
[Why symlinks](../explanation/why-symlinks.md).

## Notation

| Symbol | Meaning |
|---|---|
| `~` | The user's home directory. |
| `<data>` | The data dir the entity lives in — Global's `~/.air-ide/` for `personal`, the workspace's `<workspace.rootPath>/.air-ide/` for `workspace`. See [On-disk layout](../../architecture/reference/on-disk-layout.md). |
| `<scope>` | The path a `workspace`-scoped entity resolves to at sync time: `Workspace.rootPath`, looked up from `scopeId` by `resolveScopePath` (`src/main/application/resolve-scope-path.ts`). Never cached on the entity. |
| `<name>` | The entity's `name`. |
| 🔗 | `strategy: 'symlink'` — a symlink pointing at the canonical file in `<data>`. |
| ✍️ | `strategy: 'write'` — a generated regular file, recognized as app-owned by a marker. |
| 🧩 | `strategy: 'merge'` — one entry inside a JSON file the user also edits; the app touches only that entry. See [Merged entries](#merged-entries-mcp-and-hooks). |
| ⏭️ | `strategy: 'skip'` — the harness cannot express the entity; nothing is written and the Sync report carries a warning. |

## Claude Code (`claude`)

Enabled by default. Skills, agents and instructions are symlinks — the Claude adapter never uses `write`; MCP servers and hooks are 🧩 merged entries.

| Entity | `personal` | `workspace` | Canonical source |
|---|---|---|---|
| Skill | 🔗 `~/.claude/skills/<name>` (dir) | 🔗 `<scope>/.claude/skills/<name>` (dir) | `<data>/skills/<name>/` |
| Agent | 🔗 `~/.claude/agents/<name>.md` | 🔗 `<scope>/.claude/agents/<name>.md` | `<data>/agents/<name>.md` |
| Instruction | 🔗 `~/.claude/CLAUDE.md` **and** 🔗 `~/AGENTS.md` | 🔗 `<scope>/.claude/CLAUDE.md` **and** 🔗 `<scope>/AGENTS.md` | personal: `<data>/instructions/default.md`; workspace: `<data>/instructions/project/<name>/INSTRUCTION.md` |
| MCP server | 🧩 `~/.claude.json` → `mcpServers.<name>` | 🧩 `<scope>/.mcp.json` → `mcpServers.<name>` | `<data>/mcps/<name>.json` |
| Hook | 🧩 `~/.claude/settings.json` → `hooks.<Event>[]` | 🧩 `<scope>/.claude/settings.json` → `hooks.<Event>[]` | `<data>/hooks/<name>.json` |

## Cursor (`cursor`)

Off by default (`settings.adapters.cursor.enabled`). `manage` only — see
[the harness model](../../../product/channels/explanation/harness-model.md#the-two-capabilities).

| Entity | `personal` | `workspace` |
|---|---|---|
| Skill | 🔗 `~/.cursor/skills/<name>` (dir) | 🔗 `<scope>/.cursor/skills/<name>` (dir) |
| Agent | 🔗 `~/.cursor/agents/<name>.md` | 🔗 `<scope>/.cursor/agents/<name>.md` |
| Instruction | ✍️ `~/.cursor/plugins/air-ide/.cursor-plugin/plugin.json` **and** ✍️ `~/.cursor/plugins/air-ide/rules/personal-default.mdc` | ✍️ `<scope>/.cursor/rules/<name>.mdc` (`alwaysApply: true`) |
| MCP server | 🧩 `~/.cursor/mcp.json` → `mcpServers.<name>` (Claude's `type` key dropped) | 🧩 `<scope>/.cursor/mcp.json` |
| Hook | 🧩 `~/.cursor/hooks.json` → `hooks.<event>[]` (`version: 1` seeded on a new file), or ⏭️ | 🧩 `<scope>/.cursor/hooks.json`, or ⏭️ |

The personal instruction is shipped as a local Cursor plugin whose single rule has `alwaysApply: true`,
because Cursor has no home-level equivalent of `~/.claude/CLAUDE.md`. This layout is not a public Cursor
API and may break in a future Cursor release; the helper is isolated in
`src/main/application/entity/cursor-plugin-manifest.ts`.

### Coverage — what Cursor reads from Claude

Cursor imports Claude's `.claude/skills`, `.claude/agents` and hooks natively (its "Include Third-Party Plugins,
Skills, and Other Configs", on by default). The Cursor descriptor in `src/shared/channel.ts` declares it:
`reads: { skill: ['claude'], agent: ['claude'], hook: ['claude'] }`. While Claude is enabled and produced a
destination for the entity, `AdapterManager` writes **no** Cursor copy of a skill, agent or hook (the rows above for
those kinds apply only when coverage is off), and the next sync removes the copies the app wrote there before —
ownership-safe: a symlink only when it points into the app's data, a merge entry only when the merge index owns it,
never a user's own file. Instructions and MCP are never covered: Cursor keeps its own `.mdc` and `mcp.json` entries.

Coverage turns off when Claude is disabled, or when `settings.adapters.cursor.readsClaudeConfig` is `false` (absent =
`true`; Config › Canais › Cursor, "O Cursor importa as configurações do Claude") — Cursor then gets its own copies on
the same call (`adapter.setEnabled` and `adapter.setReadsClaudeConfig` run an unfiltered sync). Health reports a
covered Cursor destination with Claude's verdict (`HealthCheck.coveredBy`).

## Ownership markers (✍️ targets)

A generated file is app-owned when it contains its marker. Markers come from `src/shared/brand.ts`:

| Target | Marker | Check |
|---|---|---|
| `AGENTS.md` | `<!-- Managed by AIR IDE — edits will be overwritten -->` (first line) | starts with |
| `plugin.json` | `"x-air-ide-managed": true` | includes |
| `personal-default.mdc`, `<name>.mdc` | `x-air-ide-managed: true` (YAML frontmatter) | includes |

`<scope>/AGENTS.md` is owned by the Claude adapter's symlink alone; Cursor no longer writes it (it reads `.cursor/rules/*.mdc` instead).

Markers from the previous product name (`Superset AI`, `brand.legacy`) are also recognized, so files
written before the rename are still treated as owned.

## What happens when the destination already exists

A sync leaves a file or folder the app doesn't own untouched (`details.skipped: 'foreign-file'`; health reports the item as
`draft · not-installed`). The table is what `AdapterManager.install` (`adapter.install`) does when the user installs over
it, and what a sync does for everything else (`SymlinkManager.create` / `FileMaterializer.write`).

| Found at destination | 🔗 symlink target | ✍️ write target |
|---|---|---|
| Nothing | Symlink created. `ok`. | File written. `ok`. |
| Symlink to the right source | No-op. `ok`. | — |
| Symlink elsewhere | Re-pointed. `ok` (`details.replacedTarget`). | Link target's content backed up, link removed, file written. `conflict`. |
| Regular file | Backed up, replaced by the symlink. `conflict`. | Owned (marker present): overwritten. `ok`. Foreign: backed up, then overwritten. `conflict`. |
| Directory | Moved whole into the backup, replaced by the symlink. `conflict`. | — |

Backups go to `<data>/_backups/<timestamp>/<path relative to data dir, or absolute path without the leading slash>`.
A `conflict` is not a failure: it means "overwritten, and here is the backup" (`details.backupPath`).
The **Sync report** dialog (shown after saving an entity or enabling an adapter, when the report is
not all `ok`) and the **Diagnóstico** screen list them.

## Merged entries (MCP and hooks)

`~/.claude.json`, `settings.json`, `.mcp.json` and Cursor's `mcp.json` / `hooks.json` hold the user's own
keys, so the app neither symlinks nor rewrites them. `MergeMaterializer`
(`src/main/application/services/merge-materializer.ts`) puts **one entry** in — an `object-key`
(`mcpServers.<name>`) or an `array-item` (one element of `hooks.<event>`, found again by an identity such as
`matcher` + `command`) — and leaves every other key, the indentation and the trailing newline as found.

Ownership is an index the app keeps at `~/.air-ide/merge-index.json` (per file: entry id → hash of the
value last written), not a marker inside the entry, since Claude/Cursor may reject unknown keys.

| Found in the file | Result |
|---|---|
| No such entry | Inserted. `ok`. |
| Entry equal to what we want | No write. `ok` (adopted into the index). |
| Managed entry, unchanged since our last write | Updated. `ok`. |
| Managed entry hand-edited (drift), or an unmanaged entry with the same name/identity | File backed up, entry replaced. `conflict`. |
| Not valid JSON (comments, trailing commas…) or a container of the wrong type | Refused, file untouched. `error` (`validation`). |

The file is backed up whenever an existing non-empty one changes. A lost or corrupt index degrades safely:
existing entries read as foreign (backup + replace), never as quietly ours. Removal deletes only indexed
entries; an array left empty is dropped.

**Disabled entities.** An `mcp` or `hook` with `enabled: false` keeps its canonical copy but is removed from
every harness (and re-written when enabled again).

**Hook translation to Cursor** (`src/main/application/entity/hook-translation.ts`) maps Claude events
(`PreToolUse`→`preToolUse`, `Stop`→`stop`, `UserPromptSubmit`→`beforeSubmitPrompt`, …) and tool matchers
(`Bash`→`Shell`, `Edit`→`Write`, `mcp__x__tool`→`MCP:tool`). Only `command` hooks translate. A hook whose
event, matcher or type has no Cursor equivalent is **skipped, never degraded** (dropping a matcher would make
it fire on every tool): it stays active in Claude and the Sync report lists a warning
(`details.skipped: 'unsupported-by-target'`, status `ok`).

## Detected items and import

`DetectionService` (`detected.*` IPC) reads what Claude and Cursor already have on disk — skills, agents, MCP
servers and hooks, in `~`, and in the open workspace's folders — and lists it read-only. **Importing** one
(`detected.import`) makes it a canonical entity, which then propagates to every enabled harness. Nothing is
adopted automatically. Symlinked skills/agents (the app's own links) are ignored, and an item is hidden once a
canonical one with the same kind and name exists (hooks: same event/matcher/command in that harness's shape).
Not importable, with the reason shown: a skill folder with files besides `SKILL.md` (importing only the
file would lose them), an invalid MCP definition, a Cursor hook with no Claude equivalent.

### Instruction files

Detection also covers **Instructions**, per level (Global, or one folder of the workspace): `CLAUDE.md`,
`.claude/CLAUDE.md`, `AGENTS.md` and `.cursor/rules/*.mdc` (Global: `~/.claude/CLAUDE.md` and `~/AGENTS.md`
only) that are regular files, non-empty and not carrying the app's `.mdc` marker. A level that already has an
Instruction lists nothing. "Aplicar" imports the file (backed up, see the IPC contract); "Criar do zero" starts an
empty Instruction.

### Foreign files

When a file or folder the app does not own already sits at a symlink or write destination (any kind), the sync
does **not** replace it. The Sync report gets `details.skipped: 'foreign-file'` with a message naming the file,
and the item reads `draft · instalar` in that channel until the user installs over it (backed up, undoable) or
removes it. Once installed, a deviation (missing, repointed, drifted) is an `error`. (MCP and hooks — merged
entries — keep the older behaviour: overwrite with a backup under `_backups/`.)

## Removal

- Deleting an entity with `removeSymlinks: true` removes its destinations.
- Disabling an adapter (`adapter.setEnabled { enabled: false }`) removes that adapter's symlinks
  **and** its owned generated files, unless `removeSymlinks: false` is passed.
- A symlink is only removed if it points into the entity's own data dir (Global's or the workspace's); a regular file at a symlink
  destination is skipped (`skipped-real-file`). A generated file is only removed if it carries its marker.

## Known issues

- **Switching workspace does not prune targets.** `personal` entities always live in Global, so
  `~/.claude/` no longer follows the open workspace; but `syncAll` only covers Global plus the open
  workspace and never prunes stale links — see
  [Architecture → Global / Workspace](../../architecture/reference/architecture.md#global--workspace).
- **Unverified Cursor behaviour.** Whether Cursor tolerates unknown keys in `mcpServers` entries, and
  whether it reads `<scope>/.cursor/hooks.json` (its docs list the project path, but this was not tested
  here), has not been confirmed on a real install.
- **MCP `env` values** are stored in plain text in the canonical file, the harness files and `_backups/`, as
  Claude's own file already does.
