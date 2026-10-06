---
title: Diagnose and reset
description: Read the Diagnóstico screen, fix broken links, MCP auth and plugin drift, recover a backed-up file, and factory-reset the app.
---

# Diagnose and reset

## Check overall health

The chip in the top bar summarizes the latest health report: **sincronizado**, **atenção** or **erro**.
Click it, or open the **Diagnóstico** tab, for the details. When a new error appears, the app also sends a
macOS notification.

**Diagnóstico** groups checks by category; each failing check has a title, a detail line and, when there
is one, a suggested fix. **Atualizar** re-runs every check.

| Section | What it compares | Typical fix |
|---|---|---|
| **MCP Authentication** | Servers Claude Code flagged as needing OAuth | Run `/mcp` in a session, or **Authenticate** on the server ([MCP how-to](configure-mcp-servers-and-hooks.md#fix-a-server-that-needs-authentication)). |
| **MCP Runtime** | Servers that failed to start, from Claude Code's logs | Fix the command/URL in the server's definition. |
| **Config Drift** | Installed plugins vs. what `~/.claude/settings.json` says | Toggle the plugin off and on, or reinstall it. |
| **Symlinks** | Every expected adapter link vs. what is on disk (missing, broken, pointing elsewhere, replaced by a real file) | Re-save the entity, or toggle the harness off/on in Settings to re-sync all. |
| **Generated Files** | Every expected marker-owned file (Cursor `AGENTS.md`, Cursor plugin) vs. disk | Same as Symlinks. |

Symlink and generated-file checks cover the **active workspace's** entities only.

## Recover a file the app overwrote

Whenever a sync replaces an existing file, the previous content is copied first to
`<data dir>/_backups/<timestamp>/<original path>` (`~/.ai-companion/_backups/…` in the Global workspace),
and the **Sync report** shown after the save names the exact path. Copy what you need back by hand —
for example, into the body of the instruction that replaced it. Backups are never deleted automatically.

## Re-read files changed outside the app

The file tree, previews and lists refresh by themselves when the app's own data changes. If something you
edited elsewhere still looks stale, use **Reler do disco** (refresh icon) in the Explorer header.

## Factory reset

**Settings** → **Zona de perigo** → **Restaurar para estado inicial**, then confirm. Switch to the Global
workspace first for a full reset. The app:

1. removes every symlink and owned generated file it created for the active workspace's entities;
2. removes each registered Project's `.ai-companion/index.md` link;
3. deletes the active workspace's data dir — entities, settings, backups;
4. resets `enabledPlugins` and `extraKnownMarketplaces` in `~/.claude/settings.json` to empty —
   **including entries you added outside the app**;
5. quits.

Copy `_backups/` somewhere else first if you might need it. The next launch starts from scratch, re-seeding
the official marketplace. Details: [On-disk layout → Factory reset](../reference/on-disk-layout.md#factory-reset).
