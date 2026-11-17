---
title: Work with multi-folder workspaces
description: Group several repositories in one workspace, and see how files, Git, terminals, sessions and customizations behave across them.
---

# Work with multi-folder workspaces

A workspace holds one or more folders. A one-folder workspace is the common case and is unchanged; a
**multi-folder workspace** is the same thing grown by adding folders, for projects that live in several
repositories (a frontend and a backend, for instance). Each folder keeps its own customizations, and the
workspace gets a shared set of its own. Background:
[Architecture → Multi-folder workspaces](../../../technical/architecture/reference/architecture.md#multi-folder-workspaces).

A folder belongs to at most one workspace. Folders are identified by name everywhere in the UI (no colours).

## Add a folder

1. Open the workspace, then open the context switcher in the TopNav.
2. Click **Adicionar pasta ao workspace…** and pick the folder.
3. The first time a workspace goes from one folder to two, the app asks you to rename it, because the old
   name described only the first folder. The dialog (**Renomear workspace**) is pre-filled; click
   **Renomear** or **Manter nome**.

If the folder already belongs to another workspace, the app refuses and names that workspace.

Adding or removing a folder rebuilds the workspace like a switch does: running sessions and terminals end.
Renaming does not.

> **Criar workspace…** (**⌘O**, same entry in the command palette as **Abrir pasta…**) always starts a new
> one-folder workspace. Use **Adicionar pasta ao workspace…** to grow an existing one.

## Remove a folder

Context switcher → **Remover pasta «name» do workspace**. These entries appear only when the workspace has
more than one folder. Nothing is deleted from disk, and the folder's own `.air-ide/` stays where it is.

## What changes across folders

### Files

In **Arquivos**, the top-level rows are the folders. Each shows its `⎇ branch` and a changes pill; clean
folders are dimmed. Paths inside the tree start with the folder's name.

### Git

In the **Git** view of the rail, **Repositórios** lists every folder as its own repository:

- Folders with changes open with their files; clean ones stay collapsed.
- Each folder commits on its own, with a **Commit (name)…** action (the same commit box as in
  [Use the Git panel](../../source-control/how-to/use-the-git-panel.md)). There is no commit across repositories.
- A folder with no repository shows one muted line, which runs `git init` when clicked.

### Terminals

In **Terminais**, sessions are grouped by folder. **Novo terminal** (the ＋ in the section header) offers
**Novo terminal em «name»** for each folder, **Novo terminal na raiz do workspace**, and **Novo terminal em…**
to pick any subfolder. A terminal opened outside every folder is listed under **Raiz do workspace**.
See [Use terminals](../../terminal/how-to/use-terminals.md).

### Sessions

**Nova sessão** asks which folders the session sees. Tick **Todas as pastas** or any subset; the default
is the first folder. Folders you leave out are completely outside the session, not even an extra directory.
The choice is per session, and folders added later do not join a running session.

- One folder ticked: the session runs inside that folder.
- Two or more ticked: the session runs from a helper directory under `~/.air-ide/` that links to
  the ticked folders, and the folders are equals (no main one).

Cursor sessions receive each ticked folder as an extra directory instead. See
[Start and manage sessions](../../sessions/how-to/start-and-manage-sessions.md).

### Customizations

The **Customizações** panel has a **Workspace** section and a **Global** one, grouped by type. A folder is a
tag on the row (`commit-msg · api`), not a level of the tree, and each folder has its own
**Instructions · <folder>** row. New items from **+** (Novo) go to the workspace's shared set.

- A folder's skills, agents and instructions live in `<folder>/.air-ide/` and are linked into that
  folder's `.claude/` (and `.cursor/`, if enabled).
- The **Workspace** shared set lives in `~/.air-ide/workspaces/<id>/`, never inside your folders.
  Consequence: a session on **one** folder does not load the shared set; a session on **two or more**
  folders does, together with each ticked folder's own skills and agents (the shared set wins a name clash).
  For Cursor, the shared set is not visible in a multi-folder session.
- To create something in a level, use the **+** on its Skills or Agents group, or its **Instructions** row.
  Names are unique across all levels.
- Hooks, MCP servers and plugins still follow the primary (first) folder only.

Details of the tree: [Create skills, slash-commands and agents](../../customizations/how-to/create-skills-and-agents.md) and
[Write instructions](../../customizations/how-to/write-instructions.md).
