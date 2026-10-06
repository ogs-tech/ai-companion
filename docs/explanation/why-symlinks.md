---
title: Why symlinks
description: Why the app materializes customizations into each harness as symbolic links instead of copying them, and where it deliberately does not.
---

# Why symlinks

The app keeps one canonical copy of every skill, agent and instruction in its own data dir, and every
harness still has to find those files in *its* config surface — `~/.claude/skills/`, `<repo>/.cursor/agents/`,
`~/AGENTS.md`. Something has to bridge the two. The app's answer is a symbolic link per destination, with a
narrow, marker-guarded exception for formats a link cannot express. This page explains that choice; the
exact paths are in [Adapter targets](../reference/adapter-targets.md).

## The alternatives

**Copy on save.** Write a fresh copy into every target whenever the canonical file changes. Simple, works
on every filesystem, and every harness reads a plain file. But a copy is a second source of truth from
the moment it is written: an edit made from inside the harness (a `claude` session rewriting its own
skill, a teammate opening `~/.claude/CLAUDE.md` in an editor) lands in the copy and is silently
discarded by the next save. Reconciling that needs a drift detector, a merge story and a "which side
wins" rule — a sync engine, which this app has explicitly chosen not to be.

**Ask each harness to read from our dir.** Point the harness at `~/.ai-companion/` through its own
configuration. No harness offers this uniformly, and those that offer something (plugin dirs, include
directives) each offer something different. It would turn every adapter into a negotiation with a
vendor's configuration format.

**Symlink.** One canonical file, any number of names for it. Nothing to reconcile, because there is
nothing to diverge.

## What symlinks buy

- **No drift, by construction.** Every harness reads the same bytes the app wrote. There is no "last
  synced" state to go stale.
- **Edits from anywhere land in the source.** A session editing `~/.claude/skills/foo/SKILL.md` is
  editing `<data>/skills/foo/SKILL.md`. The app's file watcher (`EntityWatchService`) notices and refreshes
  its own view; nothing is lost and nothing has to be merged.
- **Ownership is a property of the link itself.** A symlink pointing into the app's data dir is, by
  definition, the app's. That is what lets removal be safe without a ledger: disabling an adapter removes
  only links that resolve into the workspace (`removeIfPointsToWorkspace`) and skips a real file at the
  same path (`skipped-real-file`).
- **Cheap, idempotent sync.** Re-running a sync over a correct link is a `readlink` and a no-op, which is
  why the app can afford to re-sync on every save and on every external file change.

## What they cost

- **Overwriting what was there.** A user who already had a hand-written `~/.claude/CLAUDE.md` gets it
  replaced by a link. The app never discards it: the old file is copied to `<data>/_backups/<timestamp>/…`
  first and the sync reports a `conflict` that names the backup. Directories are the one thing it will not
  back up, so it refuses to replace them (`error`, `reason: 'backup-directory'`).
- **Edits from anywhere land in the source.** The same property as above, seen from the other side: there
  is no way to make a harness-local tweak that the canonical copy does not see.
- **Every link names one workspace.** Links point at a specific data dir. Switching workspace does not
  re-point or prune them yet, so `~/.claude/` can keep pointing at the previous workspace's entities until
  they are re-synced — a [known gap](../reference/architecture.md#workspace--project).
- **The harness must follow links.** Claude Code and Cursor do. A harness that did not would fail the
  [boundary test's](harness-model.md#the-boundary-test) practical side and need a `write` adapter instead.

## Where the app writes files instead

Some targets are not "this file, under another name" but "this content, in another format":

- Cursor has no home-level instruction file, so the personal instruction becomes a small local Cursor
  plugin (`plugin.json` + an `alwaysApply: true` rule) — content the canonical Markdown does not contain.
- Cursor's per-repo `AGENTS.md` is generated with an ownership header prepended.

These use `strategy: 'write'`. Since a generated file is a copy, it inherits the copy's problem — so the
app limits it in two ways. It is always regenerated from the canonical source and never read back, so
edits to it are knowingly disposable (the marker line says so). And it carries an **ownership marker**:
`FileMaterializer` overwrites or removes a file only when the marker is present, backing up anything
foreign first. The marker is the generated file's stand-in for "this link points into our dir".

The rule for a new adapter follows from all of the above: prefer `symlink`; use `write` only when the
harness's format cannot be a link, and always with a marker
([Add a harness adapter](../how-to/add-a-harness-adapter.md)).
