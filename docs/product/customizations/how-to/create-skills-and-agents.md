---
title: Create skills, slash-commands and agents
description: Create, edit, scope, rename and delete skills and agent profiles, and turn a skill into a slash-command.
---

# Create skills, slash-commands and agents

Skills and agents are edited the same way. A **slash-command** is a skill the model may not invoke on its
own — there is no separate kind for it. Field rules (name format, length limits) are in
[Entity schema](../../../technical/customizations/reference/customization-schema.md); where each one lands on disk is in
[Adapter targets](../../../technical/channels/reference/adapter-targets.md).

## Create one

1. In the right panel (the **PanelRight** toggle in the TopNav shows it if hidden), click **+**
   (**Novo**) in the **Customizações** header and choose **Skill** or **Agent**.

   ![The Novo button in the Customizações header](../../../assets/screenshots/create-skills-and-agents/01-new-button.png)

   ![The Novo menu: Skill, Agent, Instruction](../../../assets/screenshots/create-skills-and-agents/02-new-menu.png)

2. A new tab opens with a **Properties** dialog. Fill in:
   - **Name** — lowercase letters, digits and hyphens, starting with a letter or digit
     (`^[a-z0-9][a-z0-9-]*$`). It becomes the folder/file name in every harness.
   - **Description** — up to 200 characters. For a skill, this is what the model reads to decide when
     to use it, so describe the trigger, not the content.
   - **Version** — free-form; informational.
   - **Scope** — **Personal** (all your repos) or **Workspace** (the open workspace's folder). **Workspace**
     is only available while a workspace is open, not on Início. In a multi-folder workspace, **Novo** creates
     the item in the workspace's shared set
     (see [Work with multi-folder workspaces](../../workspaces/how-to/work-with-multi-folder-workspaces.md)).

   ![The Properties dialog](../../../assets/screenshots/create-skills-and-agents/03-properties.png)

3. Close the dialog and write the body in the editor: the skill's instructions, or the agent's system prompt.

   ![Writing the skill body](../../../assets/screenshots/create-skills-and-agents/04-editor.png)

4. Press **⌘S** (Ctrl+S). There is no save button; the tab shows a dirty marker until saved.

   ![The skill saved and listed in Customizações](../../../assets/screenshots/create-skills-and-agents/05-saved.png)

On save the canonical file is written to the data dir of its scope and linked into every enabled harness.
If any target needed overwriting, a **Sync report** dialog lists it with the path of the backup.

## Read the Customizações tree

At Início the panel lists Global's items. Inside a workspace it lists the open workspace's own items (and what was
detected in its folders) first, then a **Global** section — *Global — vale para todos os workspaces* — with Início's
items, collapsed. Global's items are edited right here like the workspace's own; a change reaches every workspace.

Each scope starts with its **Instructions** row, then one group per type: **Skills**, **Agents**, **MCP**,
**Hooks**, then **Plugins**. A group with nothing in it is not shown — **+** is where a new one starts; a scope with
nothing at all says *Nenhuma customização ainda*. Hooks have no workspace scope, so inside a workspace they all
sit under **Global**. The group already names the type, so item rows carry no icon. A plugin is one row (name,
version, its error tag and **Atualizar** when they apply) that expands to one collapsible sub-header per type it
provides, read-only; those items are not repeated in the type groups. Turning the plugin off keeps them listed and
marks them *Desativado*.

In a multi-folder workspace the folder is a tag on the row (`commit-msg · api`), not a level of the tree, and
each folder has its own **Instructions · <folder>** row.

Every item is in one of three states. A row speaks only when it is not installed; silence means it is:

| State | Row shows | Meaning |
|---|---|---|
| Installed | nothing | It reached every channel that is on. |
| Draft | **Importar** | Found in Claude's or Cursor's own files, not yet managed by the app. Click it to import. |
| | **Instalar** | A file the app doesn't manage sits where the item goes. Click it to install over it (the file is backed up; the toast offers **Desfazer**). |
| | *Desativado* | You turned it off. It goes to no channel; the row reads quieter. |
| Error | ● *Erro no Claude* (or *Erro em 2 canais*) | Something is wrong in that channel (missing, out of date, needs sign-in). Click it to open Diagnósticos on the item. |

An error in one channel outranks a draft in another: the row shows the error. A group header counts its errors
(● N) before its total.

Under the search box, a chip appears only for what needs attention: **N com erro** and **N rascunhos**. Click one
to keep only those rows, click it again to see everything; while one is on, a second row (**Todos os canais** ·
**Claude N** · **Cursor N**) narrows it to one channel. They combine with the search, and each count is what
selecting the chip shows. The header shows the total; while a search or chip is active it reads `n de N`. When
nothing matches, the empty state names the query and offers **Limpar filtros**, which clears both. The states are
checked when the app opens or reloads, when you switch between Início and a workspace, and after you change
something — not on a timer. Switching between Início and a workspace resets the search and the chip.

Every row's menu opens with a right-click or from the **⋯** the row shows on hover or keyboard focus.

- A green **N sessões** beside a skill, agent or MCP server means running sessions used it in the last ten
  minutes; hover for the list.
- Open a skill, agent or instruction's **Editar** (or the MCP or hook editor) to see **Sincronização**: for
  each channel, where the item lands and how (`Ligado por link simbólico`, `Arquivo gerado`,
  `Entrada em mcp.json`, or *lê o mesmo arquivo do Claude* for a channel that reads Claude's copy), or what is
  wrong there with **Abrir diagnóstico**. A channel that is off reads *Desativado*; LM Studio reads *Só roda
  sessões*. An item you turned off shows one line: *Desativado — não vai para nenhum canal*.

## Edit, preview, rename

- **Edit:** click the row. The tab reopens on the current file.
- **Visualizar:** right-click the row → **Visualizar** renders the body as Markdown, read-only.
- **Editar:** right-click → **Editar** reopens the Properties form.
- **Desativar / Ativar:** right-click → **Desativar** takes it out of every channel and keeps the file
  (frontmatter `enabled: false`); **Ativar** puts it back.
- **Rename:** change **Name** and save. The old file and its links are removed and the new ones created.

> **Changing Scope without renaming leaves the old link behind.** Save only cleans up previous
> destinations on a rename, so moving `my-skill` from Personal to Workspace keeps
> `~/.claude/skills/my-skill` in place next to the new `<workspace>/.claude/skills/my-skill`. Delete the
> stale link by hand, or rename and rename back.

## Make a skill a slash-command

The editor has no control for this yet. Set it in the canonical file's frontmatter:

1. Close the skill's tab if it is open (saving from a tab opened before your edit would overwrite it).
2. Open `<data dir>/skills/<name>/SKILL.md` — `~/.air-ide/skills/<name>/SKILL.md` for a personal
   skill, `<workspace>/.air-ide/skills/<name>/SKILL.md` for a workspace one — in any editor.
3. Add to the frontmatter:

   ```yaml
   disable-model-invocation: true
   ```

4. Save the file. The app's file watcher picks it up and re-syncs; no restart needed.

In Claude Code, invoke it as `/<name>`. Later saves from the app preserve the flag
(it round-trips as `explicitOnly: true`).

## Delete one

Right-click the row → **Excluir**. The row disappears at once and a toast offers **Desfazer** for 6 seconds;
when it ends, the canonical file and every link the app created for it are removed (also if you close the panel
or switch scope first). Plugin-provided entries are read-only and have no delete action — manage them from
[their plugin](install-plugins-and-marketplaces.md).

## Use it in a session right away

Right-click the row (or **⋯**) → **Nova sessão**. A fresh `claude` session opens in the entity's scope with
`@<path-to-the-entity>` drafted (not sent) as the first message, so you can ask the agent to work on it.
See [Start and manage sessions](../../sessions/how-to/start-and-manage-sessions.md).
