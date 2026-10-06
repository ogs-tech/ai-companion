---
title: Enable or disable a harness
description: Turn syncing to Cursor (or Claude Code) on and off, and clean up what the app wrote there.
---

# Enable or disable a harness

Each harness the app can `manage` has an on/off switch. Claude Code is on by default; Cursor is off. Turning
one on materializes every entity of the active workspace into that harness; turning it off can remove
everything the app put there. Paths: [Adapter targets](../reference/adapter-targets.md).

## Enable Cursor

1. Open **Settings** (gear icon, top right).
2. Under **Adapters**, switch **Cursor** on.

The app immediately syncs every skill, agent and instruction of the **active workspace** into
`~/.cursor/…` and `<repo>/.cursor/…`. The personal instruction becomes a local Cursor plugin at
`~/.cursor/plugins/ai-companion/` with an always-applied rule — restart Cursor so it loads the plugin.
If any target had to be overwritten, a **Sync report** lists each one with its backup path.

Other workspaces' entities are synced the next time each one is saved while its workspace is active.

> Cursor and Claude Code both claim `<folder>/AGENTS.md` for workspace/Project instructions, and with
> both enabled they overwrite each other on every sync. See
> [Adapter targets → Known issues](../reference/adapter-targets.md#known-issues).

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
