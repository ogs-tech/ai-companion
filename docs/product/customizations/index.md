---
title: Customizations
description: Skills, agents, instructions, MCP servers, hooks and plugins: one source of truth, materialized into each harness.
---

# Customizations

Skills, agents, instructions, MCP servers, hooks and plugins: one source of truth, materialized into each harness.

The app keeps the canonical copy and links it into each harness (`~/.claude/`, `~/.cursor/`, `<repo>/.claude/`, …). See [Harnesses](../channels/index.md) for how that works.

Every kind follows one lifecycle, with the same words on every row's menu: **Abrir · Editar · Desativar/Ativar ·
Excluir · Importar · Instalar por cima**. A verb a row can't do is not shown. **Desativar** keeps the item but
takes it out of every channel (the row reads *draft · desativado*); **Excluir** hides the row at once and deletes
it when the toast's **Desfazer** window (6 s) ends. Read-only rows — Global's items inside a workspace, a plugin's
items — offer **Abrir** (and **Editar no Início** for Global's).

The app decides which channel gets what: Cursor reads Claude's skills, agents and hooks on its own, so while Claude
is on the app writes them only to Claude, and the editor's **Sincronização** says *Cursor — lê o mesmo arquivo do
Claude*. Turn that off in Config › Canais › Cursor (*O Cursor importa as configurações do Claude*) to give Cursor
its own copies. Instructions and MCP servers always get Cursor's own copy.

- [Create skills, slash-commands and agents](how-to/create-skills-and-agents.md) — including the Customizações tree.
- [Write instructions](how-to/write-instructions.md) — personal, per-workspace and per-folder; reply language.
- [Configure MCP servers and hooks](how-to/configure-mcp-servers-and-hooks.md)
- [Install plugins and marketplaces](how-to/install-plugins-and-marketplaces.md) — Starter Pack, marketplaces, Git URLs, publishing.
