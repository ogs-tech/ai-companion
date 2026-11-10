---
title: Enable or disable a channel
description: Turn syncing to Cursor (or Claude Code) on and off, and clean up what the app wrote there.
---

# Enable or disable a channel

Each channel the app can `manage` has an on/off switch. Claude Code is on by default; Cursor is off. Turning
one on materializes every entity of the active workspace into that channel and makes it available for new
sessions; turning it off can remove everything the app put there and hides it from new sessions and the
session history. Paths: [Adapter targets](../../technical/reference/adapter-targets.md).

## Enable Cursor

1. Open **Config** (⌘, or the header button) → **Canais** → **Cursor**.
2. If Cursor is not installed or signed in yet, use **Instalar** / **Entrar** on that page first; **Ativar Cursor** appears once both are done. Tick it.

The app immediately syncs every skill, agent, instruction, MCP server and hook of the **active workspace**
into `~/.cursor/…` and `<repo>/.cursor/…`: workspace instructions become `.cursor/rules/<name>.mdc`, and MCP
servers and hooks are added as single entries to `mcp.json` / `hooks.json` without touching your other entries. The personal instruction becomes a local Cursor plugin at
`~/.cursor/plugins/ai-companion/` with an always-applied rule — restart Cursor so it loads the plugin.
If any target had to be overwritten, a **Sync report** lists each one with its backup path.

Other workspaces' entities are synced the next time each one is saved while its workspace is active.

A hook Cursor cannot express (an event it lacks, a matcher or a non-`command` type it cannot represent) is not
written to Cursor at all; it stays active in Claude Code and the **Sync report** lists it as a warning.

Skills, agents, MCP servers and hooks that already exist in `~/.cursor/` (or `<repo>/.cursor/`) appear as
**Detectados** rows. Import one from its row menu (**Importar**) and it becomes managed by the app and is
written to every enabled channel. See
[Adapter targets → Detected items and import](../../technical/reference/adapter-targets.md#detected-items-and-import).

## Start a Cursor session

With Cursor enabled and the `cursor-agent` CLI installed (`~/.local/bin/cursor-agent`), **Nova sessão** opens a
dialog with a **Claude / Cursor** selector (it always opens on Claude; the choice is per session). A Cursor
session runs in the same terminal panel as a Claude one, shows the Cursor mark on its tab and row, and can be
reopened from the sessions list. If the CLI is not found, Cursor appears disabled in the selector. Cursor
sessions show an **estimated** cost and the real model: Cursor records no tokens, so they are reconstructed from the chat text (~4 characters per token, whole history re-sent every turn, no prompt-cache discount) and priced from the bundled table. A model with no published rate shows "—". Sign in to Cursor inside the terminal if the CLI asks.

How a Cursor session differs from a Claude one:

- **Approval prompts** — Cursor has no hook for them, so the app reads the terminal output to spot one; a miss
  shows the session as **Ocioso** instead of **Pergunta**. See
  [Read a session's state](../sessions/read-session-state.md).
- **Context** — shown as an estimate, marked `~`.
- **History** — Cursor conversations appear in **Histórico** with a **Cursor** channel chip and can be
  resumed from there; see [Review past sessions and cost](../sessions/session-history-and-cost.md).
- **Outside the app** — Cursor sessions started in another terminal are listed too; exact state needs the
  hooks installed in `~/.cursor/hooks.json` (see [Watch sessions running outside the app](../sessions/watch-external-sessions.md)).

## Disable a channel

1. **Config** → **Canais** → **Cursor** → clear **Ativar Cursor**.
2. The dialog shows how many links the app manages there. Choose:
   - **Sim, remover N symlinks** — removes the app's symlinks and its marker-owned generated files
     for that channel. Real files at those paths, and generated files without the app's marker, are left
     alone.
   - **Não, apenas desabilitar** — stops future syncing; everything already there stays.
   - **Cancelar**.

Disabling never touches the canonical files in the data dir, so re-enabling later restores everything.

## Re-sync everything

There is no "sync now" button. Toggle the channel off (**Não, apenas desabilitar**) and back on: enabling
always runs a full sync of the active workspace. Saving an entity re-syncs just that entity.

## Check the result

The **Diagnóstico** tab has **Symlinks** and **Generated Files** sections that compare what should be on
disk with what is — see [Diagnose and reset](../troubleshooting/diagnose-and-reset.md).
