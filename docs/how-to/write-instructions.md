---
title: Write instructions
description: Edit the personal instruction and create per-workspace or per-Project instructions that every harness loads automatically.
---

# Write instructions

An **instruction** is the always-loaded context file a harness reads at the start of every conversation
(`CLAUDE.md` / `AGENTS.md` in Claude Code, a rule or `AGENTS.md` in Cursor). There is one **personal**
instruction, plus at most one per workspace and one per Project. Instructions are stored without
frontmatter: the file is the body. Targets: [Adapter targets](../reference/adapter-targets.md).

All three live in the **Explorer** panel (left) as a row labeled **INSTRUCTIONS**.

## Edit the personal instruction

1. Go to the **Global** workspace (click **Início**).
2. Click the **INSTRUCTIONS** row at the top of the Explorer. The first click on an empty one opens a
   new instruction tab.
3. Write, then press **⌘S**.

It is linked to `~/.claude/CLAUDE.md` **and** `~/AGENTS.md` (plus a Cursor rule, if Cursor is enabled).
A pre-existing hand-written `~/.claude/CLAUDE.md` is moved to `~/.ai-companion/_backups/<timestamp>/`
on the first sync, and the Sync report tells you where. Copy anything you want to keep into the new body.

## Add an instruction for a workspace

1. Switch to the workspace.
2. With no Project scoped, click the Explorer's **INSTRUCTIONS** row, write, **⌘S**.

Targets resolve to the workspace's root folder: `<root>/.claude/CLAUDE.md` and `<root>/AGENTS.md`.

## Add an instruction for a Project

1. In the workspace's file tree, expand the Project's folder (it must already be a
   [registered Project](manage-workspaces-and-projects.md#register-a-folder-as-a-project)).
2. Click the **INSTRUCTIONS** row pinned at the top of that folder's children, write, **⌘S**.

Targets resolve to the Project's folder: `<project>/.claude/CLAUDE.md` and `<project>/AGENTS.md`.

> **Avoid enabling Cursor if you rely on workspace/Project instructions.** Both adapters claim
> `<folder>/AGENTS.md`; with both enabled they overwrite each other on every sync. See
> [Adapter targets → Known issues](../reference/adapter-targets.md#known-issues).

## Remove a workspace or Project instruction

Hover its **INSTRUCTIONS** row and click **Remover**. The instruction file and its links are deleted.
The personal instruction cannot be removed, only emptied.

## Set the reply language for every session

**Settings** (gear icon) → **Language**. Any value other than **Off** writes a `<language>…</language>`
block into the **personal** instruction (and re-syncs it); **Off** removes the block. **Mirror** tells the
model to reply in whatever language you write in. Code, comments and identifiers are always requested in
English. The block is plain text in the instruction — you can see and edit it there.

## Draft an instruction with an agent

Right-click an **INSTRUCTIONS** row → **New Action**. A `claude` session opens with `@<instruction file>`
drafted as the first message; ask it to write or refine the instruction. Its edits land in the canonical
file and re-sync automatically.
