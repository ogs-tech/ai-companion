---
title: Manage workspaces and projects
description: Create, switch and remove workspaces; register folders as Projects and remove them.
---

# Manage workspaces and projects

A **workspace** is a root folder with its own set of customizations (its own `.ai-companion/` data dir).
A **Project** is a folder registered inside a workspace, so entities, sessions, Git and Launch
Configurations can be scoped to it. Neither is ever synced to a harness. Background:
[Architecture → Workspace / Project](../reference/architecture.md#workspace--project).

## Create a workspace

1. Click the **Início** tab. If a non-default workspace is active, this switches back to the **Global**
   workspace first.
2. In the workspace list, click **Novo workspace** and pick the root folder.

The workspace is named after the folder, its data dir `<folder>/.ai-companion/` is created, and the
folder itself is registered as the workspace's first Project. Creating does **not** switch to it.

## Switch workspace

- **To another workspace:** on **Início** (Global), click its row in the workspace list.
- **Back to Global:** click the **Início** tab, or the `..` row at the top of the file tree.

Switching stops every running `claude` session and launched process of the outgoing workspace, and closes
its embedded browser tabs. Open sessions do not carry over. Symlinks already written to `~/.claude/` and
`~/.cursor/` are **not** re-pointed — see [Adapter targets → Known issues](../reference/adapter-targets.md#known-issues).

## Register a folder as a Project

Either:

- **From the file tree:** in a non-default workspace, Explorer panel → **Arquivos**, click **Usar como
  Project** on a top-level folder's row. Only folders directly under the workspace root offer this.
- **From an entity's properties:** set **Scope** to **Project** and choose a folder in the **Project**
  picker. Any folder works here; it is registered on the fly (`project.findOrCreateByPath`).

Registering creates `<folder>/.ai-companion/index.md`, a symlink back to the workspace's marker file.

Once a top-level folder is a Project, its row shows **Abrir customizations do projeto** instead. Click it
to scope the Explorer, the Customizations list and the Git panel to that Project; `..` steps back out.

## Remove a Project

Scope the screen to it (see above), then **Mais ações** (⋮ in the Explorer header) → **Remover projeto**.
This unregisters the Project and removes its `index.md` symlink. The folder and its files are untouched.
Entities scoped to it remain in the data dir but can no longer be synced (their scope no longer resolves),
so re-scope or delete them first.

## Remove a workspace

- **The active one:** **Mais ações** → **Remover workspace**. The app switches to Global first, then removes it.
- **Another one:** on **Início** (Global), click the trash icon on its row.

The Global workspace cannot be removed. Removal only drops the workspace from `workspaces.json`: its
`<root>/.ai-companion/` dir, its entities and any symlinks they produced stay on disk. Delete the dir by
hand if you want it gone.

## Show or hide customizations from other scopes

Inside a non-default workspace, the Customizations list shows only what is scoped to the workspace or
Project in view. **Mais ações** → **Mostrar entidades globais** also shows Personal-scope and
plugin-provided entities.

## See also

- [On-disk layout](../reference/on-disk-layout.md) — what each workspace stores and where.
- [Write instructions](write-instructions.md) — per-workspace and per-Project instructions.
