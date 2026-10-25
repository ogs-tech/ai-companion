---
title: On-disk layout
description: Every file and directory the app owns, edits or reads — inside its own data dirs and inside each harness's config surface.
---

# On-disk layout

What lives where. Paths below use `~` for the home directory. For the paths each adapter *materializes*
entities to, see [Adapter targets](adapter-targets.md); for the shape of the entity files themselves, see
[Entity schema](customization-schema.md).

## Two kinds of data dir

| Dir | What it is |
|---|---|
| `~/.ai-companion/` | The **Global data dir** ("Início"). Holds app-global state *and* every `personal` entity. Always loaded, whichever workspace is open. Global is not a workspace — the home dir can't be opened as one. |
| `<workspace.rootPath>/.ai-companion/` | A **workspace data dir**, one per workspace (any folder the user opened). Holds that workspace's `workspace`-scoped entities. Created when the workspace is registered (`workspace.create`/`workspace.open`) and re-bootstrapped (self-healed) every time it is activated. |

The dir name comes from `brand.workspaceDirName` (`src/shared/brand.ts`). On first launch,
`ProductMigrationService` renames a legacy `~/.superset-ai-app/` (and `~/.cursor/plugins/superset-ai/`)
to the current names.

## Global data dir — app-global files

Only ever read from `~/.ai-companion/`, whichever workspace is open.

| Path | Owner | Contents |
|---|---|---|
| `settings.json` | `SettingsService` | `Settings` (`src/shared/settings.ts`): `adapters.<harness>.enabled`, `ui.theme`, `language`, optional `pricing` overrides, optional `openWith` memory. |
| `workspaces.json` | `WorkspaceService` | `{ schemaVersion: 2, workspaces, activeWorkspaceId }` — every `Workspace` (`id`, `name`, `rootPath` as a real path, `createdAt`); `activeWorkspaceId: null` means Início. Written empty on a fresh install, or by the boot migration from the project-era shape. |
| `plugins/` | `PluginCacheFile` | Personal-scope plugins: imported clones and owned plugins, each with `_meta.json`. |
| `marketplaces-cache/` | `MarketplaceService` | Personal-scope marketplace clones. |
| `mcp-disabled.json` | `McpDisabledStash` | Inline MCP server definitions parked while disabled (restored on enable). |
| `_backups/<timestamp>/…` | `SymlinkManager`, `FileMaterializer` | Copies of whatever a sync overwrote — always here, whichever workspace is open. Never pruned automatically. |
| `_backups/migration-v2-<timestamp>/` | `WorkspaceModelMigration` | Pre-migration copies of the project-era files (absolute paths preserved beneath it) plus `log.json`. Written once, by the boot migration. |
| `bin/open` | `UnixSocketLinkRouter` | Shell shim, rewritten (mode `0755`) on every start. Prepended to a session PTY's `PATH` and set as its `$BROWSER`, so a URL the `claude` CLI opens reaches the app instead of the default browser. Non-`http(s)` or flagged invocations pass straight to `/usr/bin/open`. |
| `run/link.sock` | `UnixSocketLinkRouter` | Unix socket (mode `0600`, dir `0700`) the shim writes URLs to; removed on quit. Falls back to `$TMPDIR/ai-companion-<uid>/` when the path would exceed macOS's socket-path limit. |
| `dev.lock` | dev launcher | Present only while `npm run dev` runs. |

## Entity files (every data dir)

Laid out the same in Global's and in each workspace's data dir: `personal` entities live in Global's,
`workspace` entities in the owning workspace's. Global's is always loaded; a workspace's only while it's
open.

| Path | Owner | Contents |
|---|---|---|
| `index.md` | `WorkspaceBootstrapService` | Static "this folder is managed by AI Companion" marker. |
| `skills/<name>/SKILL.md` | `FsEntityRepository` | Skill — YAML frontmatter + Markdown body. The whole `<name>/` dir is what gets symlinked. |
| `agents/<name>.md` | `FsEntityRepository` | Agent — YAML frontmatter + system prompt. |
| `instructions/default.md` | `FsEntityRepository` | The personal instruction (Global only). Frontmatter-free: the file *is* the body. |
| `instructions/project/<slug>/INSTRUCTION.md` | `FsEntityRepository` | A workspace instruction body (frontmatter-free; workspace data dirs only — `project/` is a legacy dir name). |
| `instructions/project/<slug>/meta.json` | `FsEntityRepository` | Its sidecar: description, version, timestamps, `scope: 'workspace'`, `scopeId`. |
| `open-editors.json` | `OpenEditorsService` | The Workbench tabs that were open in this data dir — references only (`PersistedTab`), rebuilt from disk on reload. A workspace's own file while it is open, Global's at Início. Hand-editable; malformed tabs are dropped on read. |
| `attachments/` | `SessionService` | Images pasted into a session terminal, staged so the CLI can read them by path — in the open workspace's data dir, or Global's at Início. |

Global's data dir and the open workspace's are watched recursively (`EntityWatchService`): editing an
entity file by hand, or from a `claude` session, re-syncs its adapter targets without going through the
app's editor.

## Inside a workspace folder

Besides its `.ai-companion/` data dir, the app touches a workspace's folder (`<rootPath>`) only here:

| Path | Contents |
|---|---|
| `<rootPath>/.ai-companion/plugins/`, `<rootPath>/.ai-companion/marketplaces-cache/` | Claude Code `project`-tier plugins and marketplace clones, while that workspace is open. |
| `<rootPath>/.vscode/launch.json` | **Read only** — the source of Launch Configurations. |
| `<rootPath>/.git/` | Read and written only through the Git panel's explicit actions (`git.*`). |

Adapter targets inside a workspace (`.claude/…`, `.cursor/…`, `AGENTS.md`) are listed in
[Adapter targets](adapter-targets.md).

## Files the app edits outside its data dir

Besides adapter targets, the app edits Claude Code's own config files directly. Every one of these
writes is surgical — only the keys listed are touched.

| Path | Keys touched | By |
|---|---|---|
| `~/.claude/settings.json` (`project` tier: the open workspace's `<rootPath>/.claude/settings.json`) | `hooks`, `enabledPlugins`, `extraKnownMarketplaces` | `HookService`, `PluginInstaller`, `MarketplaceService` (through `ClaudeSettingsFile`) |
| `~/.claude/plugins/cache/local/<id>` (`project` tier: `<rootPath>/.claude/plugins/cache/local/<id>`) | symlink to the plugin in `~/.ai-companion/plugins/` (or the workspace's) | `PluginInstaller` |
| `~/.claude.json` | `mcpServers`, `projects[<path>].mcpServers`, `projects[<path>].disabledMcpjsonServers` | `McpService` (atomic write, previous file kept as `~/.claude.json.bak`) |
| `<repo>/.mcp.json` | project-shared MCP servers | `McpService` |

## Files the app only reads

| Path | Used for |
|---|---|
| `~/.claude/projects/<slug>/<uuid>.jsonl` | Session history, cost and token counts. Never written. |
| `~/.claude/plugins/installed_plugins.json` | Provenance of plugins installed by Claude Code itself (shown read-only). |
| `~/.claude/mcp-needs-auth-cache.json`, `~/Library/Caches/claude-cli-nodejs/` | MCP health (needs-auth / runtime errors) on the Diagnóstico screen. |

## Outside the home directory

| Path | Contents |
|---|---|
| `~/Library/Application Support/<app name>/credentials.enc` | The GitHub PAT, encrypted with Electron `safeStorage` (macOS Keychain-backed). Never returned over IPC. |

## Claude Code's `project` tier

Claude Code's `project` tier (plugins, hooks, marketplaces) resolves against the **open workspace's root**;
at Início, with no workspace open, it isn't available and those calls fail `validation`.

## Factory reset

**Settings → Zona de perigo → Restaurar para estado inicial** (`app.restore`) removes every adapter symlink
and owned generated file, then Global's whole data dir `~/.ai-companion/` (each workspace's own
`<rootPath>/.ai-companion/` stays in its folder), and finally
resets `enabledPlugins` and `extraKnownMarketplaces` in `~/.claude/settings.json` to `{}` — **including
entries you added from Claude Code itself**, not only the app's own — before quitting. Backups live in Global's
data dir and go with it, so copy `~/.ai-companion/_backups/` out first if you need them.
