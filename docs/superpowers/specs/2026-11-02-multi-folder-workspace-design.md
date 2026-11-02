# Multi-folder workspaces — design

Date: 2026-11-02. Status: draft for review. Language of the app UI: pt-BR.

## Intent and why

Today a workspace is exactly one opened folder. Real projects often live in
several repositories (e.g. a frontend and a backend). The user wants one
workspace that holds N folders, so that one place shows their files, git state,
terminals, sessions and customizations, while each folder keeps its own
customizations.

A single-folder workspace stays the common case. A multi-folder workspace is the
same thing grown by adding folders; it is not a separate kind of object.

## Goals

- A workspace holds 1..N folders.
- Two explicit actions in the workspace menu: **Criar workspace** and
  **Adicionar pasta ao workspace**.
- Each folder keeps its own customizations (skills, agents, instructions,
  hooks, MCP) in `<folder>/.ai-companion/`, as today.
- A multi-folder workspace has its own shared set of customizations that belongs
  to no folder (see Storage).
- Files, git, terminals, sessions and the customizations list all show which
  folder an item belongs to, using one colour per folder everywhere.

## Non-goals

- No change to how Início (Global) works.
- No new harness, no change to the `manage`/`run` capability model.
- No cross-folder operations (no multi-repo atomic commit, no moving
  customizations between folders).
- No change to plugin-provided entities (still read-only).

## Anti-goals

- A multi-folder workspace must not require migrating or visibly changing
  existing single-folder workspaces.
- Removing a folder from a workspace must not delete anything on disk.
- Nothing may assume a single open root where several can now exist (git,
  launch configs, file browser, terminals, sessions).

## User-facing behaviour (decided by the user)

### Creating and growing a workspace
- **Criar workspace**: the user picks a folder. The workspace is named after
  that folder. This is a one-folder workspace.
- **Adicionar pasta ao workspace**: adds another folder to the open workspace.
  Because the old name described one folder, the app asks the user to rename the
  workspace right after the first addition. The rename dialog is pre-filled with
  the current name.
- The existing "Abrir pasta… (⌘O)" keeps working as a one-folder workspace
  (my reading; confirm during planning that it is the same as Criar workspace).

### Customizations list (right panel)
- Grouping is **origin › kind › item**: `Workspace › Skills › skill-x` and
  `frontend › Skills › skill-y`. Origins are the workspace's shared set plus one
  group per folder. Every level collapses.
- The existing top-level groups ("Neste workspace", "Do Início") and the filter
  chips (Tudo, Skills, Agents, Integrações) stay. Only "Neste workspace" gains
  the extra origin level. "Do Início" is unchanged.
- The breadcrumb of an open item says which folder it comes from.

### Files and git (left panel)
- One root per folder in the file tree, each showing its branch.
- The git toolbar becomes per root: changes count, stage, commit, fetch/push are
  separate for each folder, because each folder is its own repository.

### Terminals
- Each terminal tab shows the folder it was opened in.
- "Novo terminal" offers a drop-list: each folder, or the workspace root. The
  default is the folder of the active item (my call).

### Sessions (the `claude` CLI)
- At start the user ticks which folders the session sees: one, several, or all
  (a "Todas as pastas" shortcut ticks everything). The choice is per session.
- Folders that are not ticked are completely outside the session (decided by the
  user): not the working directory, not an extra directory.
- One folder ticked: the session's working directory is that folder.
- Two or more ticked: the folders are equals, with no main folder. My proposed
  mechanism, to be confirmed by the builder: a helper directory under
  `~/.ai-companion/` containing links to the ticked folders only, used as the
  working directory. Folders added to the workspace later do not join a running
  session.
- The default tick is the folder of the active item (my call).

### Visual identity
- One colour dot per origin, used in the tree, git blocks, terminal tabs and the
  item chip: workspace shared set is neutral/white, then one colour per folder
  from a fixed palette.

## Storage (decided in conversation)

- Per-folder customizations: `<folder>/.ai-companion/`, unchanged.
- The multi-folder workspace's own shared set lives in `~/.ai-companion/`, not
  inside any folder, so it does not depend on the first folder and survives
  removing any folder. Exact layout is left to the builder.
- **One folder, one workspace (decided by the user):** a folder cannot belong to
  two workspaces. "Adicionar pasta" refuses a folder already used by another
  workspace and names that workspace. "Abrir pasta…" on a folder that already
  belongs to a workspace opens that workspace instead of creating another (my
  call, following from the rule).
- **Where the shared set is materialized (decided by the user):** inside the
  workspace's own directory under `~/.ai-companion/` (e.g. its `.claude/`), never
  inside the user's folders. Consequence the user was told about: a
  one-folder session (cwd in that folder) does not load the shared set by
  itself; a session with two or more folders, which runs from that directory,
  does. The builder must check whether Claude Code loads skills and instructions
  from an `--add-dir` directory's `.claude/`; if it does, the workspace directory
  should also be passed as an extra directory in one-folder sessions. Otherwise
  surface in the UI that the shared set only applies to sessions with two or
  more folders.

## Calls I made (not discussed with the user)

- Removing a folder: action "Remover pasta do workspace"; it never touches disk
  and leaves the folder's `.ai-companion/` in place.
- Existing workspaces become one-folder workspaces with no visible migration.
- Hooks, MCP and Plugins follow the same origin › kind › item tree, under
  Integrações.
- "Raiz do workspace" in the terminal drop-list is the workspace's own
  directory under `~/.ai-companion/` (see Storage), the same one the
  "all folders equal" session uses.
- The sessions list groups sessions by the workspace's folders, and also
  includes sessions opened in the workspace's own directory.
- Git, file browser and launch configs receive the list of folders instead of
  one root; how the code is shaped is the builder's call.
- A one-folder workspace does not show the "Workspace" origin in the customizations
  tree. It appears when the second folder is added.

## Constraints from the codebase

- Hexagonal rule: services depend on ports; I/O in `infrastructure/`.
- Scope model is `personal | workspace` with `scopeId` = `Workspace.id`; this
  design introduces a per-folder origin inside `workspace`. How that maps onto
  `Scope`/`scopes`/`scopeId` is for the builder, guided by
  `docs/reference/architecture.md` and `docs/reference/customization-schema.md`.
- Every activation rebuilds workspace-scoped services; git, launch configs and
  file browser currently assume one root.
- Lint, typecheck and tests must be green before done.

## Left to the builder

- Data model for folders inside a workspace and its storage layout.
- IPC method names and shapes for the two actions and per-folder git.
- How `Scope`/`scopeId` represent the per-folder origin.
- The palette for folder colours and the rename dialog's exact wording.
- Test strategy.

## Mockups

[`2026-11-02-multi-folder-workspace-mockups.html`](./2026-11-02-multi-folder-workspace-mockups.html)
(open in a browser; uses the app's dark theme). Screens: workspace menu with
the two new actions, rename dialog after adding the second folder, error for a
folder that already belongs to another workspace, main screen (one root per
folder, origin › kind › item tree, terminal drop-list), and the new-session
dialog with one, several and all folders ticked. All texts in the mockups are
my proposals, not agreed copy.
