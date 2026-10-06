---
title: Configure MCP servers and hooks
description: Add, edit, disable and authenticate Claude Code MCP servers; review and delete hooks.
---

# Configure MCP servers and hooks

MCP servers and hooks are not canonical entities yet: the app edits Claude Code's own config files directly
instead of keeping a copy in its data dir and linking it. Which files and keys:
[On-disk layout → Files the app edits outside its data dir](../reference/on-disk-layout.md#files-the-app-edits-outside-its-data-dir).
Both apply to Claude Code only.

Both live under **Customizations** → **Integrações** (collapsed by default).

## Add an MCP server

1. **Integrações** → **MCP** → **+**.
2. Fill in:
   - **Name** — the server key Claude Code will show.
   - **Scope**:
     - **Personal (global)** — every project; written to `mcpServers` in `~/.claude.json`.
     - **Project (local)** — one repo, only for you; written to `projects[<repo>].mcpServers` in `~/.claude.json`.
     - **Project (shared / .mcp.json)** — one repo, committed with it; written to `<repo>/.mcp.json`.
   - **Repo path** — for the two Project scopes.
   - **Transport** — `stdio` (fill **Command**) or `http` / `sse` (fill **URL**).
3. Save.

`~/.claude.json` is rewritten atomically and the previous version kept at `~/.claude.json.bak`.

**Arguments, env vars and headers** have no fields in the dialog. Add them by editing the server's entry
in the file above (`args`, `env`, `headers`); editing the server from the app afterwards preserves them.

## Disable, edit, delete

On the server's row: the switch disables/enables it, the pencil (**Editar**) reopens the dialog, the trash
(**Excluir**) removes it.

Disabling a shared server adds it to `projects[<repo>].disabledMcpjsonServers` — `.mcp.json` itself is
untouched. Disabling a personal or local server moves its definition out of `~/.claude.json` into
`~/.ai-companion/mcp-disabled.json`, and enabling moves it back.

Servers provided by a plugin, and servers **detected** from Claude Code's runtime (see below), are
read-only.

## Fix a server that needs authentication

A server Claude Code has flagged as needing OAuth shows an **Authenticate** button. It opens
`https://claude.ai/customize/connectors` in your browser — the app cannot complete the OAuth flow itself.
For servers you configured locally, run `/mcp` inside a `claude` session instead.

Servers that Claude Code reports as failing or needing auth, but whose config the app cannot find, are
listed as **detected** so the failure is visible. The **Diagnóstico** tab lists the same problems with a
suggested fix — see [Diagnose and reset](diagnose-and-reset.md).

## Hooks

**Integrações** → **Hooks** lists every hook in `~/.claude/settings.json`, plus hooks contributed by
installed plugins (labeled with their plugin). From the app you can:

- **Review** them — event, matcher and handler are shown on the row.
- **Delete** one — trash icon (**Excluir hook**). Plugin hooks are read-only.

Creating or editing a hook is not available in the UI yet. Add it to the `hooks` key of
`~/.claude/settings.json` in Claude Code's own format; it appears in the list on the next refresh.

Hooks are personal-only: inside a non-default workspace they are hidden until **Mais ações** →
**Mostrar entidades globais**.
