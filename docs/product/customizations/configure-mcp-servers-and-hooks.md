---
title: Configure MCP servers and hooks
description: Add, edit, disable and authenticate Claude Code MCP servers; review and delete hooks.
---

# Configure MCP servers and hooks

MCP servers and hooks are managed once, in the app, and written to every enabled harness — Claude Code and
(if enabled) Cursor — as single entries in their own config files; your other entries are never touched. Which
files and keys:
[On-disk layout → Files the app edits outside its data dir](../../technical/reference/on-disk-layout.md#files-the-app-edits-outside-its-data-dir).
Items that already exist in those files show as **detected** until you import them (below).

Both live under **Customizations** → the **Integrações** chip.

## Add an MCP server

1. **Integrações** chip → **+** → **Servidor MCP**.
2. Fill in:
   - **Name** — the server key Claude Code will show.
   - **Scope**:
     - **Personal (global)** — every project; written to `mcpServers` in `~/.claude.json` (and `~/.cursor/mcp.json`).
     - **Project (local)** and **Project (shared / .mcp.json)** — one repo of the open workspace; written to
       `<repo>/.mcp.json` (and `<repo>/.cursor/mcp.json`). They are the same thing now: both are workspace
       servers. Needs an open workspace.
   - **Repo path** — for the two Project scopes.
   - **Transport** — `stdio` (fill **Command**) or `http` / `sse` (fill **URL**).
3. Save.

Each harness file is rewritten atomically, and its previous version is kept under
`~/.ai-companion/_backups/`. If an entry with that name already exists and the app did not write it, it is
replaced and the **Sync report** shows a conflict with the backup path.

**Arguments, env vars and headers** have no fields in the dialog. Add them by editing the server's entry
in the file above (`args`, `env`, `headers`); editing the server from the app afterwards preserves them.

## Disable, edit, delete

On the server's row: the switch disables/enables it, the pencil (**Editar**) reopens the dialog, the trash
(**Excluir**) removes it.

Disabling a server removes it from every harness's file but keeps the app's copy; enabling writes it back.

Servers provided by a plugin, and **detected** servers (see below), are read-only.

## Import what already exists

Servers found in `~/.claude.json`, `<repo>/.mcp.json` and Cursor's `mcp.json` that the app did not create
show as **detected**, labeled with the harness. Nothing is adopted automatically. On a detected row's menu
choose **Importar**: it becomes a managed server and is written to every enabled harness. Skills and agents
found in `.claude/` and `.cursor/` appear the same way under **Detectados**.

## Fix a server that needs authentication

A server Claude Code has flagged as needing OAuth shows an **Authenticate** button. It opens
`https://claude.ai/customize/connectors` in your browser — the app cannot complete the OAuth flow itself.
For servers you configured locally, run `/mcp` inside a `claude` session instead.

Servers that Claude Code reports as failing or needing auth, but whose config the app cannot find, are
listed as **detected** so the failure is visible. The **Diagnóstico** tab lists the same problems with a
suggested fix — see [Diagnose and reset](../troubleshooting/diagnose-and-reset.md).

## Hooks

The **Integrações** chip lists the app's hooks, hooks **detected** in `~/.claude/settings.json` and
`~/.cursor/hooks.json`, and hooks contributed by installed plugins (labeled with their plugin). From the app you can:

- **Review** them — event, matcher and handler are shown on the row.
- **Import** a detected one — **Importar** on its menu. It is then written to every enabled harness; for
  Cursor only what it can express (the Sync report lists any hook that was skipped).
- **Delete** a managed one — trash icon (**Excluir hook**), which also removes it from the harness files.
  Plugin hooks and detected hooks are read-only.

Creating or editing a hook is not available in the UI yet; the `hook.save` IPC method exists.

Hooks are personal-only: they are listed on **Início**, and inside a workspace under **Do Global**.
