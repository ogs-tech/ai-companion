---
title: Manage workspaces
description: Open, switch and remove workspaces; reach Global entities from inside one.
---

# Manage workspaces

A **workspace** is any folder you opened, with its own set of customizations (its own `.ai-companion/`
data dir). **Início** is Global (`~/.ai-companion`) — not a workspace. Nothing here is ever synced to a
harness by itself. Background: [Architecture → Global / Workspace](../reference/architecture.md#global--workspace).

The context you are in is always shown in the TopNav, right of the back/forward buttons: `🏠 Início ▾` or
`📁 <workspace> ▾` (hover it for the workspace's folder). Every action below starts from that switcher, ⌘K,
or Início's own panels.

## Open a folder as a workspace

Any of:

- **⌘O**, or the switcher → **Abrir pasta…**, or ⌘K → **Abrir pasta…**, then pick the folder.
- On **Início**, the left panel's **Workspaces** header → **+**.
- Inside a workspace, right-click a folder in **Arquivos** → **Abrir como workspace**.

A folder already registered reopens its workspace; a new one is named after the folder and gets its data dir
`<folder>/.ai-companion/`. Your home folder is Global and can't be opened as a workspace. A sub-folder that is
itself a workspace shows a small folder badge in the file tree.

## Switch workspace

- **To another workspace:** the switcher → a **Recentes** entry (the last 5 you opened) or **Todos os
  workspaces ▸**; ⌘K → **Ir para workspace…**; or, on **Início**, a row in **Workspaces** or the
  **Recentes** card on Visão geral.
- **Back to Início:** the switcher → **Início**, or ⌘K → **Ir para Início**.

Choosing the context you are already in just brings its **Visão geral** tab (⌘0) to the front.

Switching closes the open Workbench tabs (it asks first if any has unsaved changes), stops every running
`claude` session and launched process of the outgoing context, and closes its embedded browser tabs. Symlinks
already written to `~/.claude/` and `~/.cursor/` are **not** re-pointed — see
[Adapter targets → Known issues](../reference/adapter-targets.md#known-issues).

## Remove a workspace

- **The open one:** the switcher → **Remover este workspace…**, then confirm. The app goes to Início first.
- **Any one:** on **Início**, right-click its row in **Workspaces** → **Remover…**, then confirm.

Removal only drops the workspace from `workspaces.json`: its folder, its `.ai-companion/` dir, its entities
and any symlinks they produced stay on disk. Delete the dir by hand if you want it gone. The same row menu
also offers **Revelar no Finder**.

## Use Global entities from inside a workspace

Inside a workspace, the right panel's Skills and Agents list only what belongs to that workspace. Global
skills, agents and your personal instruction are listed at the bottom, under **Herdado do Global**
(collapsed). They open read-only; the **Editar no Início** button switches to Início and opens the entity
there, editable.

## See also

- [On-disk layout](../reference/on-disk-layout.md) — what each workspace stores and where.
- [Write instructions](write-instructions.md) — per-workspace instructions.
