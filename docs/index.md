---
title: AI Companion
description: Local desktop app that manages your AI harnesses — one source of truth for skills, agent profiles and instructions, materialized into each harness's own config surface.
---

# AI Companion

> Manages your AI **harnesses** — the programs that turn a language model into an agent working on your code (Claude Code, Cursor, …). New to the word? Start with [the harness model](explanation/harness-model.md).

Single source of truth for your AI customizations; each harness reads them from its own config surface (`~/.claude/`, `~/.cursor/`, `<repo>/.claude/`, …) through symlinks the app maintains.

## Quick links

- **First time?** Start with the [Getting started tutorial](tutorials/getting-started.md).
- **Need internals?** Open the [Architecture reference](reference/architecture.md).
- **Want the vocabulary?** Read [the harness model](explanation/harness-model.md).
- **Want the why?** Read the [product rationale (PRD)](explanation/prd.md).

## Documentation map

This project follows the [Diátaxis](https://diataxis.fr/) framework. Each quadrant answers a different reader question; pick the one that matches your need.

| Quadrant | When to read | Folder |
|---|---|---|
| **Tutorials** | I'm new and want to learn by doing | `tutorials/` |
| **How-to guides** | I have a specific task to complete | `how-to/` |
| **Reference** | I need exact facts (schemas, contracts, layout) | `reference/` |
| **Explanation** | I want to understand the design decisions | `explanation/` |

### Tutorials — learn by doing

- [Getting started](tutorials/getting-started.md) — clone, install, run the app for the first time.
- [Your first skill, end to end](tutorials/first-skill-end-to-end.md) — create a skill, see it linked into
  Claude Code, use and edit it from a session, check its cost.

### How-to — task-oriented

Using the app:

- [Manage workspaces and projects](how-to/manage-workspaces-and-projects.md)
- [Create skills, slash-commands and agents](how-to/create-skills-and-agents.md)
- [Write instructions](how-to/write-instructions.md) — personal, per-workspace, per-Project; reply language.
- [Configure MCP servers and hooks](how-to/configure-mcp-servers-and-hooks.md)
- [Install plugins and marketplaces](how-to/install-plugins-and-marketplaces.md) — Starter Pack,
  marketplaces, Git URLs, publishing.
- [Enable or disable a harness](how-to/enable-cursor-adapter.md) — Cursor sync on/off, cleanup.
- [Run and review sessions](how-to/run-and-review-sessions.md) — terminals, session browser, history, cost.
- [Use the Git panel](how-to/use-the-git-panel.md)
- [Run launch configurations](how-to/run-launch-configs.md)
- [Connect GitHub](how-to/connect-github.md)
- [Diagnose and reset](how-to/diagnose-and-reset.md) — Diagnóstico, backups, factory reset.

Contributing:

- [Add an IPC method](how-to/add-an-ipc-method.md)
- [Add a harness adapter](how-to/add-a-harness-adapter.md)
- [Add an entity kind](how-to/add-an-entity-kind.md)

### Reference — look it up

- [Architecture overview](reference/architecture.md) — Electron processes and hexagonal layout.
- [Entity schema](reference/customization-schema.md) — canonical `Entity` fields, scopes and validation errors.
- [IPC contract](reference/ipc-contract.md) — main ↔ renderer API surface, methods and error model.
- [Adapter targets](reference/adapter-targets.md) — every path each harness adapter writes, and conflict handling.
- [On-disk layout](reference/on-disk-layout.md) — every file the app owns, edits or reads.

### Explanation — understand the why

- [The harness model](explanation/harness-model.md) — what a harness is, the `manage`/`run` capabilities, how to add one.
- [Product rationale (PRD)](explanation/prd.md) — problem, audience, scope, success metrics.
- [Why symlinks](explanation/why-symlinks.md) — links instead of copies, and where the app writes files instead.

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
the non-goals that bound it, in the [PRD](explanation/prd.md#5-scope).

**Not in scope:** being a harness itself, collaboration and team sync, anything
cloud-side.

## Repository

Source: [github.com/ogs-tech/ai-companion](https://github.com/ogs-tech/ai-companion).
