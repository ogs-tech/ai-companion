---
title: AIR IDE
description: Local desktop app that manages your AI harnesses — one source of truth for skills, agent profiles and instructions, materialized into each harness's own config surface.
---

# AIR IDE

> Manages your AI **harnesses** — the programs that turn a language model into an agent working on your code (Claude Code, Cursor, …). New to the word? Start with [the harness model](product/channels/explanation/harness-model.md).

Single source of truth for your AI customizations; each harness reads them from its own config surface (`~/.claude/`, `~/.cursor/`, `<repo>/.claude/`, …) through symlinks the app maintains.

## Quick links

- **First time?** Start with the [Getting started tutorial](product/get-started/tutorials/getting-started.md).
- **Need internals?** Open the [Architecture reference](technical/architecture/reference/architecture.md).
- **Want the vocabulary?** Read [the harness model](product/channels/explanation/harness-model.md).
- **Want the why?** Read the [product rationale (PRD)](product/about/explanation/prd.md).

## Documentation map

The docs are laid out as **audience / area / [Diátaxis](https://diataxis.fr/) type**: `product/` for people using the app, `technical/` for people changing the code; inside each, one folder per area (`sessions/`, `customizations/`, `channels/`, …), and inside an area one folder per type — `tutorials/`, `how-to/`, `reference/`, `explanation/`. Each product area has an `index.md` at its root. `e2e/` uses the same audience and area names. `superpowers/` holds dated design specs and plans (history, not maintained guides); `assets/` holds the screenshots the guides embed.

## Product — using the app

### [Get started](product/get-started/index.md)

Install the app, open your first workspace and create your first skill.

- [Getting started](product/get-started/tutorials/getting-started.md) — clone, install, run the app for the first time.
- [Your first skill, end to end](product/get-started/tutorials/first-skill-end-to-end.md) — create a skill, see it linked into Claude Code, use and edit it from a session, check its cost.

### [Workspaces](product/workspaces/index.md)

A workspace is a folder, or a group of folders, the app works in. Home (Início) is the place outside any workspace.

- [Manage workspaces](product/workspaces/how-to/manage-workspaces.md) — create, switch, rename and remove workspaces; what a workspace inherits from Global.
- [Work with multi-folder workspaces](product/workspaces/how-to/work-with-multi-folder-workspaces.md) — several repositories in one workspace, per-folder customizations, which folders a session sees.

### [Editor and explorer](product/editor/index.md)

Read, edit and review files inside the app.

- [Edit files and navigate](product/editor/how-to/edit-files-and-navigate.md) — explorer operations, tabs, open by name and search, Abrir com, external files.

### [Sessions](product/sessions/index.md)

A session is a real `claude` or `cursor-agent` process running in a terminal inside the app.

- [Start and manage sessions](product/sessions/how-to/start-and-manage-sessions.md) — start, work in the terminal, give a session a browser, stop, resume, remove.
- [Read a session's state](product/sessions/reference/read-session-state.md) — Pergunta, Trabalhando, Ocioso, Fechado; context, cost and what a session is using.
- [Watch sessions running outside the app](product/sessions/how-to/watch-external-sessions.md) — observe or take over sessions started in other terminals.
- [Session notifications](product/sessions/how-to/session-notifications.md) — notifications, Dock badge, inline answer.
- [Session history and cost](product/sessions/how-to/session-history-and-cost.md) — past sessions, filters, cost, model prices.

### [Customizations](product/customizations/index.md)

Skills, agents, instructions, MCP servers, hooks and plugins: one source of truth, materialized into each harness.

- [Create skills, slash-commands and agents](product/customizations/how-to/create-skills-and-agents.md) — including the Customizações tree.
- [Write instructions](product/customizations/how-to/write-instructions.md) — personal, per-workspace and per-folder; reply language.
- [Configure MCP servers and hooks](product/customizations/how-to/configure-mcp-servers-and-hooks.md)
- [Install plugins and marketplaces](product/customizations/how-to/install-plugins-and-marketplaces.md) — Starter Pack, marketplaces, Git URLs, publishing.

### [Source control](product/source-control/index.md)

Review, commit and sync the Git repositories of your workspace.

- [Use the Git panel](product/source-control/how-to/use-the-git-panel.md) — review, stage, commit (with an AI-drafted message), push and pull.
- [Connect GitHub](product/source-control/how-to/connect-github.md) — store a token so the app can reach private repositories.

### [Terminal and launch](product/terminal/index.md)

Integrated terminals and VS Code-style launch configurations.

- [Use integrated terminals](product/terminal/how-to/use-terminals.md)
- [Run launch configurations](product/terminal/how-to/run-launch-configs.md)

### [Harnesses and channels](product/channels/index.md)

A harness is the program that turns a language model into an agent working on your code: Claude Code, Cursor, …

- [The harness model](product/channels/explanation/harness-model.md) — what a harness is and the `manage` and `run` capabilities.
- [Enable or disable a harness](product/channels/how-to/enable-cursor-adapter.md) — Cursor sync on and off, what is written, cleanup.

### [Troubleshooting](product/troubleshooting/index.md)

When something looks out of sync or broken.

- [Diagnose and reset](product/troubleshooting/how-to/diagnose-and-reset.md) — Diagnóstico, backups, starting over by hand.

### [About](product/about/index.md)

Why the product exists and where it is going.

- [Product rationale (PRD)](product/about/explanation/prd.md) — problem, audience, scope, success metrics.
- [IDE direction](product/about/explanation/ide-direction.md) — the move toward an AI-first IDE that brings your own harness.

## Technical — changing the code

### Architecture

- [Architecture overview](technical/architecture/reference/architecture.md) (reference) — Electron processes and hexagonal layout.
- [IPC contract](technical/architecture/reference/ipc-contract.md) (reference) — main ↔ renderer API surface, methods and error model.
- [On-disk layout](technical/architecture/reference/on-disk-layout.md) (reference) — every file the app owns, edits or reads.
- [Add an IPC method](technical/architecture/how-to/add-an-ipc-method.md) (how-to)

### Customizations

- [Entity schema](technical/customizations/reference/customization-schema.md) (reference) — canonical `Entity` fields, scopes and validation errors.
- [Add an entity kind](technical/customizations/how-to/add-an-entity-kind.md) (how-to)

### Channels

- [Adapter targets](technical/channels/reference/adapter-targets.md) (reference) — every path each channel adapter writes, and conflict handling.
- [Add a harness adapter](technical/channels/how-to/add-a-harness-adapter.md) (how-to)
- [Why symlinks](technical/channels/explanation/why-symlinks.md) (explanation) — links instead of copies, and where the app writes files instead.

### Testing

- [Write an e2e journey](technical/testing/how-to/write-an-e2e-journey.md) (how-to) — where a spec goes, fixtures, CLI stubs.
- [Regenerate the doc screenshots](technical/testing/how-to/regenerate-doc-screenshots.md) (how-to)

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron 41 |
| UI | React 19 + TypeScript 5.9 |
| Build | electron-vite + Vite 7 |
| Tests | Vitest + Testing Library |
| Validation | Zod 4 |
| Markdown | react-markdown + YAML |

Pure TypeScript — no backend, API, database, auth, or telemetry.

## Scope

Stated per capability — `manage` (own a harness's customizations and materialize
them) and `run` (spawn and observe a CLI harness's sessions). Full breakdown, and
the non-goals that bound it, in the [PRD](product/about/explanation/prd.md#5-scope).

**Not in scope:** being a harness itself, collaboration and team sync, anything
cloud-side.

## Repository

Source: [github.com/ogs-tech/air-ide](https://github.com/ogs-tech/air-ide).
