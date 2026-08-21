---
title: AI Companion
description: Local desktop app to centralize AI customizations (skills, agent profiles) and sync them to Claude Code via symlinks.
---

# AI Companion

> **Status:** Spike — validating in 4 weeks whether centralizing AI context in a local app with symlink-based sync replaces ad-hoc folders and loose notes.

Single source of truth for AI customizations in your workspace; live copies in `~/.claude/` and `<repo>/.claude/`.

## Quick links

- **First time?** Start with the [Getting started tutorial](tutorials/getting-started.md).
- **Need internals?** Open the [Architecture reference](reference/architecture.md).
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

### How-to — task-oriented

- Create a customization _(TBD)_
- Sync customizations to Claude Code _(TBD)_
- Link an external repo _(TBD)_

### Reference — look it up

- [Architecture overview](reference/architecture.md) — Electron processes and hexagonal layout.
- [Customization schema](reference/customization-schema.md) — YAML frontmatter contract and validation errors.
- [IPC contract](reference/ipc-contract.md) — main ↔ renderer API surface, methods and error model.
- Adapter targets _(TBD)_ — paths and filename rules per tool.

### Explanation — understand the why

- [Product rationale (PRD)](explanation/prd.md) — problem, hypothesis, success metrics.
- Why symlinks (vs. copy/sync) _(TBD)_
- Architecture decision records (ADRs) _(TBD)_

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

## Scope (4-week spike)

**Must-have:** CRUD of customizations in Markdown + YAML, adapters with symlinks to Claude Code (personal + project), settings UI.

**Should-have:** Schema validation, text search, token usage stats.

**Out:** Multi-user, auto-commit, Linux/Windows, i18n, accessibility, tools other than Claude Code.

**Success criterion:** the author uses the app daily for ≥ 2 consecutive weeks without falling back to loose notes.

## Repository

Source: [github.com/ogs-tech/ai-companion](https://github.com/ogs-tech/ai-companion).
