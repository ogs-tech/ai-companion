---
title: Diagnose and reset
description: Read the Diagnóstico screen, fix broken links, MCP auth and plugin drift, recover a backed-up file, and start over by hand.
---

# Diagnose and reset

## Check overall health

The chip at the left of the status bar (bottom of the window) summarizes the latest health report: **sincronizado**, **atenção** or **erro**.
Click it, or open **Diagnóstico** in Início's left panel, for the details.

![Diagnóstico on Início](../../../assets/screenshots/diagnose-and-reset/01-diagnostico.png) When a new error appears, the app also sends a
macOS notification.

**Diagnóstico** groups checks by category; each failing check has a title, a detail line and, when there
is one, a suggested fix. **Atualizar** re-runs every check.

| Section | What it compares | Typical fix |
|---|---|---|
| **MCP Authentication** | Servers Claude Code flagged as needing OAuth | Run `/mcp` in a session, or **Authenticate** on the server ([MCP how-to](../../customizations/how-to/configure-mcp-servers-and-hooks.md#fix-a-server-that-needs-authentication)). |
| **MCP Runtime** | Servers that failed to start, from Claude Code's logs | Fix the command/URL in the server's definition. |
| **Config Drift** | Installed plugins vs. what `~/.claude/settings.json` says | Toggle the plugin off and on, or reinstall it. |
| **Symlinks** | Every expected adapter link vs. what is on disk (missing, broken, pointing elsewhere, replaced by a real file) | Re-save the entity, or toggle the harness off/on in Settings to re-sync all. |
| **Generated Files** | Every expected marker-owned file (Cursor `AGENTS.md`, Cursor plugin) vs. disk | Same as Symlinks. |

Symlink and generated-file checks cover the **active workspace's** entities only.

## Recover a file the app overwrote

Whenever a sync replaces an existing file, the previous content is copied first to
`<data dir>/_backups/<timestamp>/<original path>` (`~/.air-ide/_backups/…` for personal entities),
and the **Sync report** shown after the save names the exact path. Copy what you need back by hand —
for example, into the body of the instruction that replaced it. Backups are never deleted automatically.

## Re-read files changed outside the app

The file tree, previews and lists refresh by themselves when the app's own data changes. If something you
edited elsewhere still looks stale, use **Reler do disco** (refresh icon) next to the **Arquivos | Git** toggle in the left panel.

## Start over by hand

The app has no reset button — it was removed because a button can only undo what the app *knows* it
created, and it left hooks and MCP entries behind (the **MCP** and **Hooks** groups still showed them). Wiping by
hand is explicit about what goes. Quit the app first, then work through this list; every step is optional,
pick the depth you want.

1. **Turn off the signal hooks first.** Open **Config → Sessões** and revoke "Ver o estado exato de
   sessões fora do app" (or set it to "só estimado"). That removes the app's `signals` hooks from
   `~/.claude/settings.json` and `~/.cursor/hooks.json`. If you skip this, those hooks stay in the files
   and keep showing up under **Hooks** as items detected in Claude and Cursor.
2. **Copy `~/.air-ide/_backups/` somewhere else** if you might need the files the app overwrote.
3. **Delete the app's links and generated files** in each harness's config surface — the list is in
   [Adapter targets](../../../technical/channels/reference/adapter-targets.md). In short: symlinks under
   `~/.claude/` (`skills/`, `agents/`, `CLAUDE.md`) and `~/AGENTS.md` that point into `~/.air-ide/`;
   `~/.cursor/plugins/air-ide/`; and, in every workspace folder you opened, the same symlinks under
   `<folder>/.claude/` and `<folder>/.cursor/`, plus `<folder>/.cursor/rules/*.mdc` files carrying the
   app's marker. Check with `ls -l` that a link points into `.air-ide` before removing it — never delete a
   real file you wrote yourself.
4. **Remove the MCP and hook entries the app merged** into `~/.claude.json`, `~/.claude/settings.json`,
   `~/.cursor/mcp.json`, `~/.cursor/hooks.json` and each folder's `.mcp.json` / `.cursor/{mcp,hooks}.json`.
   `~/.air-ide/merge-index.json` lists which entries are the app's. Entries you added yourself stay.
5. **Clear plugin registrations** (optional): `enabledPlugins` and `extraKnownMarketplaces` in
   `~/.claude/settings.json`, and the symlinks in `~/.claude/plugins/cache/local/`. These keys also hold
   what you added from Claude Code itself, so edit rather than empty them if that matters.
6. **Delete the data dirs:** `rm -rf ~/.air-ide` and, for each workspace you want to forget,
   `<folder>/.air-ide`. Your project files are untouched.
7. **Optional:** delete `~/Library/Application Support/<app name>/credentials.enc` to drop the stored
   GitHub token.

The next launch starts from scratch and re-seeds the official marketplace. Details of every path:
[On-disk layout](../../../technical/architecture/reference/on-disk-layout.md#removing-the-apps-footprint-by-hand).
