---
title: Install plugins and marketplaces
description: Install Claude Code plugins from the Starter Pack, a marketplace or a Git URL; enable, update, remove and publish them.
---

# Install plugins and marketplaces

A **plugin** bundles skills, agents, slash-commands, hooks, MCP servers and LSP configs. A
**marketplace** is a Git repository with a `marketplace.json` catalog of plugins. Installing a plugin
clones it into `~/.ai-companion/plugins/`, links it into `~/.claude/plugins/cache/local/<id>` and enables it
in `~/.claude/settings.json` ([On-disk layout](../reference/on-disk-layout.md)). Everything a plugin
contributes shows up in the Customizations lists with its plugin badge, read-only.

## Fastest path: the Starter Pack

1. Open the **Starter Pack** tab.
2. Browse the groups (**Core dev workflow**, **Claude Code setup**, **Integrations**, **Language
   servers**, **Output styles**, **Build for Claude**) or use **Buscar plugins…**.
3. Click **Instalar** on each plugin you want. Installed ones show **Instalado**.

## Install from a marketplace

1. Open the **Marketplaces** tab. The official marketplace is pre-registered (badge **official**).
2. To add another one, click **Importar via URL** and enter `owner/repo` or a full Git URL. The
   repository must contain a `marketplace.json`.
3. Open the marketplace, pick a plugin and click **Instalar**. A preview lists what it will add (skills,
   agents, commands, hooks, MCP, LSP); confirm with **Install**.

Use **Atualizar** on a marketplace row to re-read its catalog, and **Remover** to unregister it and
delete its cached clone. Removing a marketplace does not uninstall plugins already installed from it.

## Install straight from a Git repository

1. **Customizations** → **Integrações** → **Plugins** → **+**.
2. Enter the repository (`owner/repo` or URL) and, optionally, a branch, tag or SHA. Leave it empty for
   the default branch.
3. Click **Importar**.

## Manage installed plugins

In **Integrações** → **Plugins**:

- **Enable/disable** — the row's switch. Disabled plugins keep their files but Claude Code ignores them.
- **Details** — click the row: source, installed ref, scope, manifest and every artifact it provides.
- **Update** — row menu → **Atualizar** (imported plugins) re-fetches from the source.
- **Remove** — row menu → **Remover** deletes the clone and its link, and disables it in Claude Code.

A **Reconciliar** menu item appears for plugins flagged with drift, but it has no action behind it yet;
check the **Diagnóstico** tab's **Config Drift** section instead.

## Publish your own plugin

Owned plugins (badge **Próprio**) can be published to a GitHub repository. You need a GitHub token first —
see [Connect GitHub](connect-github.md).

1. Row menu → **Publicar**. After the first publish the same dialog opens as **Republish Plugin**.
2. Fill **Repository name**, **Version**, **Public**/**Private**, and optionally a **Commit message**.
3. Click **Publish**. The plugin's details then show the published URL, ref and date.

There is no UI to *create* an owned plugin yet (`plugin.createOwned` has no caller in the renderer).

## Scope caveat

Plugins installed with `project` scope resolve their paths from the directory the app was launched from,
not the active workspace — see [On-disk layout → Known issues](../reference/on-disk-layout.md#known-issues).
Prefer personal scope (the default) until this is fixed.
