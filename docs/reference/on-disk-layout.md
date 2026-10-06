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
| `~/.ai-companion/` | The **home data dir**. Holds app-global state *and* doubles as the data dir of the default ("Global") workspace, whose `rootPath` is `~`. |
| `<workspace.rootPath>/.ai-companion/` | A **workspace data dir**, one per non-default workspace. Created on `workspace.create` and re-bootstrapped (self-healed) every time that workspace is activated. |

The dir name comes from `brand.workspaceDirName` (`src/shared/brand.ts`). On first launch,
`ProductMigrationService` renames a legacy `~/.superset-ai-app/` (and `~/.cursor/plugins/superset-ai/`)
to the current names.

## Home data dir — app-global files

Only ever read from `~/.ai-companion/`, whichever workspace is active.

| Path | Owner | Contents |
|---|---|---|
| `settings.json` | `SettingsService` | `Settings` (`src/shared/settings.ts`): `adapters.<harness>.enabled`, `ui.theme`, `language`, optional `pricing` overrides, optional `openWith` memory. |
| `workspaces.json` | `WorkspaceService` | Every `Workspace` (`id`, `name`, `rootPath`, `isDefault`, `createdAt`) plus `activeWorkspaceId`. Seeded with the default workspace on first read. |
| `plugins/` | `PluginCacheFile` | Personal-scope plugins: imported clones and owned plugins, each with `_meta.json`. |
| `marketplaces-cache/` | `MarketplaceService` | Personal-scope marketplace clones. |
| `mcp-disabled.json` | `McpDisabledStash` | Inline MCP server definitions parked while disabled (restored on enable). |
| `dev.lock` | dev launcher | Present only while `npm run dev` runs. |

## Per-workspace files

Present in every data dir (the home one included, for the default workspace). Everything here is
rebuilt against a different directory on `workspace.switchTo`.

| Path | Owner | Contents |
|---|---|---|
| `index.md` | `WorkspaceBootstrapService` | Static "this folder is managed by AI Companion" marker. |
| `skills/<name>/SKILL.md` | `FsEntityRepository` | Skill — YAML frontmatter + Markdown body. The whole `<name>/` dir is what gets symlinked. |
| `agents/<name>.md` | `FsEntityRepository` | Agent — YAML frontmatter + system prompt. |
| `instructions/default.md` | `FsEntityRepository` | The personal instruction. Frontmatter-free: the file *is* the body. |
| `instructions/project/<slug>/INSTRUCTION.md` | `FsEntityRepository` | A project- or workspace-scoped instruction body (frontmatter-free). |
| `instructions/project/<slug>/meta.json` | `FsEntityRepository` | Its sidecar: description, version, timestamps, `scopes`, `scopeId`. |
| `projects.json` | `ProjectService` | Every `Project` (`id`, `name`, `path`, `createdAt`) registered in this workspace. |
| `_backups/<timestamp>/…` | `SymlinkManager`, `FileMaterializer` | Copies of whatever a sync overwrote. Never pruned automatically. |
| `attachments/` | `SessionService` | Images pasted into a session terminal, staged so the CLI can read them by path. |

The data dir is watched recursively (`EntityWatchService`): editing an entity file by hand, or from a
`claude` session, re-syncs its adapter targets without going through the app's editor.

## Inside a registered Project

| Path | Contents |
|---|---|
| `<project.path>/.ai-companion/index.md` | Symlink back to the owning workspace's `index.md`. Created on `project.create`, removed on `project.delete` and on factory reset. |
| `<project.path>/.vscode/launch.json` | **Read only** — the source of Launch Configurations. |
| `<project.path>/.git/` | Read and written only through the Git panel's explicit actions (`git.*`). |

Adapter targets inside a project (`.claude/…`, `.cursor/…`, `AGENTS.md`) are listed in
[Adapter targets](adapter-targets.md).

## Files the app edits outside its data dir

Besides adapter targets, the app edits Claude Code's own config files directly. Every one of these
writes is surgical — only the keys listed are touched.

| Path | Keys touched | By |
|---|---|---|
| `~/.claude/settings.json` | `hooks`, `enabledPlugins`, `extraKnownMarketplaces` | `HookService`, `PluginInstaller`, `MarketplaceService` (through `ClaudeSettingsFile`) |
| `~/.claude/plugins/cache/local/<id>` | symlink to the plugin in `~/.ai-companion/plugins/` | `PluginInstaller` |
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

## Known issues

- **`project` scope for plugins, hooks and marketplaces follows the process's working directory, not
  the active workspace.** `src/main/index.ts` resolves their `project` paths from `process.cwd()`
  (`<cwd>/.ai-companion/plugins/`, `<cwd>/.claude/settings.json`, …), and those services are built once
  at startup, not per workspace. In practice `project`-scope plugin/hook/marketplace data lands wherever
  the app was launched from.

## Factory reset

**Settings → Zona de perigo → Restaurar para estado inicial** (`app.restore`) removes every adapter symlink
and owned generated file, every Project's `index.md` symlink, then the **active workspace's** data dir (the whole `~/.ai-companion/` when the Global workspace is
active — which is the case for a full reset), and finally
resets `enabledPlugins` and `extraKnownMarketplaces` in `~/.claude/settings.json` to `{}` — **including
entries you added from Claude Code itself**, not only the app's own — before quitting. Backups go with the
data dir, so copy `_backups/` out first if you need them.
