---
title: Write instructions
description: Edit the Global instruction and create workspace and folder instructions that every harness loads automatically.
---

# Write instructions

An **instruction** is the always-loaded context file a harness reads at the start of every conversation
(`CLAUDE.md` / `AGENTS.md` in Claude Code, a rule or `AGENTS.md` in Cursor). There are three levels:
the **Global** (personal) instruction, the **workspace** instruction, and, in a multi-folder workspace, one
**folder** instruction per folder. Instructions are stored without frontmatter: the file is the body.
Targets: [Adapter targets](../../technical/reference/adapter-targets.md).

Each level has an **Instructions** row at the top of its group in the **Customizações** panel. A row shows
a chip per enabled harness (**Claude**, **Cursor**), green once that harness's file is in sync, and a status
dot: synced, pending, not created, or detected. Hover the dot for its meaning.

## Edit the personal instruction

1. Go to **Início** (TopNav switcher → **Início**).
2. In the panel, click the **Instructions** row. The first click on an empty one opens a new instruction tab.
3. Write, then press **⌘S**.

It is linked to `~/.claude/CLAUDE.md` **and** `~/AGENTS.md` (plus a Cursor rule, if Cursor is enabled).
A pre-existing hand-written `~/.claude/CLAUDE.md` is moved to `~/.ai-companion/_backups/<timestamp>/`
on the first sync, and the Sync report tells you where. Copy anything you want to keep into the new body.

## Add an instruction for a workspace

1. Switch to the workspace.
2. In the **Workspace** group, click the **Instructions** row (or **+** → **Instruction**), write, **⌘S**.
   Extra workspace instructions that already exist are nested under the row by name.

Targets resolve to the workspace's primary folder: `<root>/.claude/CLAUDE.md` and `<root>/AGENTS.md`.

## Add an instruction for one folder

Only in a multi-folder workspace (see [Work with multi-folder workspaces](../workspaces/work-with-multi-folder-workspaces.md)).
Click the **Instructions** row inside the folder's group, write, **⌘S**. Targets are
`<folder>/.claude/CLAUDE.md` and `<folder>/AGENTS.md` (plus `<folder>/.cursor/rules/<name>.mdc` with Cursor
enabled). Inside a folder, the harness reads that folder's file and those of its parent directories.

## Existing files are never overwritten

If a level's target already holds a file the app does not own, the **Instructions** row shows the file name,
a blue **Aplicar** and a dashed *detected* dot. **Aplicar** imports its content as the level's instruction;
the original is backed up under `~/.ai-companion/_backups/` before being replaced.

> **Avoid enabling Cursor if you rely on workspace instructions.** Both adapters claim
> `<folder>/AGENTS.md`; with both enabled they overwrite each other on every sync. See
> [Adapter targets → Known issues](../../technical/reference/adapter-targets.md#known-issues).

## Remove a workspace instruction

Right-click its **Instructions** row (or use the row's actions button) → **Remover**. The instruction file and
its links are deleted. The Global instruction cannot be removed, only emptied. Inside a workspace the Global
row is read-only (edit it from Início).

## Set the reply language for every session

**Settings** (gear icon) → **Language**. Any value other than **Off** writes a `<language>…</language>`
block into the **personal** instruction (and re-syncs it); **Off** removes the block. **Mirror** tells the
model to reply in whatever language you write in. Code, comments and identifiers are always requested in
English. The block is plain text in the instruction — you can see and edit it there.

## Draft an instruction with an agent

Right-click an **Instructions** row → **New Action**. A `claude` session opens with `@<instruction file>`
drafted as the first message; ask it to write or refine the instruction. Its edits land in the canonical
file and re-sync automatically.
