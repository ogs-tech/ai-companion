---
title: Enable or disable a harness
description: Turn syncing to Cursor (or Claude Code) on and off, and clean up what the app wrote there.
---

# Enable or disable a harness

Each harness the app can `manage` has an on/off switch. Claude Code is on by default; Cursor is off. Turning
one on materializes every entity of the active workspace into that harness and makes it available for new
sessions; turning it off can remove everything the app put there and hides it from new sessions and the
session history. Paths: [Adapter targets](../reference/adapter-targets.md).

## Enable Cursor

1. Open **Settings** (gear icon, top right).
2. Under **Adapters**, switch **Cursor** on.

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
written to every enabled harness. See
[Adapter targets → Detected items and import](../reference/adapter-targets.md#detected-items-and-import).

## Start a Cursor session

With Cursor enabled and the `cursor-agent` CLI installed (`~/.local/bin/cursor-agent`), **Nova sessão** opens a
dialog with a **Claude / Cursor** selector (it always opens on Claude; the choice is per session). A Cursor
session runs in the same terminal panel as a Claude one, shows the Cursor mark on its tab and row, and can be
reopened from the sessions list. If the CLI is not found, Cursor appears disabled in the selector. Cursor
sessions show an **estimated** cost and the real model: Cursor records no tokens, so they are reconstructed from the chat text (~4 characters per token, whole history re-sent every turn, no prompt-cache discount) and priced from the bundled table. A model with no published rate shows "—". Sign in to Cursor inside the terminal if the CLI asks.

## Disable a harness

1. **Settings** → **Adapters** → switch it off.
2. The dialog shows how many links the app manages there. Choose:
   - **Sim, remover N symlinks** — removes the app's symlinks and its marker-owned generated files
     for that harness. Real files at those paths, and generated files without the app's marker, are left
     alone.
   - **Não, apenas desabilitar** — stops future syncing; everything already there stays.
   - **Cancelar**.

Disabling never touches the canonical files in the data dir, so re-enabling later restores everything.

## Re-sync everything

There is no "sync now" button. Toggle the harness off (**Não, apenas desabilitar**) and back on: enabling
always runs a full sync of the active workspace. Saving an entity re-syncs just that entity.

## Check the result

The **Diagnóstico** tab has **Symlinks** and **Generated Files** sections that compare what should be on
disk with what is — see [Diagnose and reset](diagnose-and-reset.md).
