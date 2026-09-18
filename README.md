# ai-companion

[![GitHub Repo](https://img.shields.io/badge/github-ogs--tech%2Fai--companion-blue)](https://github.com/ogs-tech/ai-companion)

> Local desktop app that manages your AI **harnesses** — one source of truth for your customizations, materialized into each harness's own config surface.

## What it does

A **harness** is the program that turns a language model into an agent that works on your code: it loads the context, exposes the tools and runs the loop. The model thinks; the harness acts. Claude Code is a harness, Cursor is another — both can run the same model and still behave differently. ([Full definition](docs/explanation/harness-model.md).)

This app does two things for a harness:

- **`manage`** — owns your customizations (skills, agent profiles, instructions) as Markdown + YAML in one versioned folder, and materializes them into each harness's own files by symlink. Write an instruction once; Claude Code and Cursor both read it. Also covers the config a harness reads but does not own: hooks, MCP servers, plugins and marketplaces.
- **`run`** — for a harness that exposes a CLI, opens its sessions inside the app and reads back their history and token cost.

Entity kinds: `skill` (a slash-command is a skill with `explicitOnly`) · `agent` · `instruction`. Scopes: `personal` · `workspace` · `project`.

Supported today: **Claude Code** (manage + run) and **Cursor** (manage, opt-in).

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron 41 |
| UI | React 19 + TypeScript 5.9 |
| Build | electron-vite + Vite 7 |
| Tests | Vitest + Testing Library |
| Validation | Zod 4 |

Pure TypeScript — no backend, API, database, auth, or telemetry.

## Quick start

```bash
git clone https://github.com/ogs-tech/ai-companion.git
cd ai-companion
npm install
npm run dev
```

On first launch, pick a workspace folder. Full walkthrough: [docs/tutorials/getting-started.md](docs/tutorials/getting-started.md).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the app in development (electron-vite). |
| `npm run build` | Production build (main + preload + renderer). |
| `npm run preview` | Preview the production build. |
| `npm test` | Run the test suite once. |
| `npm run test:watch` | Run tests in watch mode. |
| `npm run lint` | Lint with ESLint. |
| `npm run typecheck` | Typecheck Node and web TS configs. |
| `npm run format` | Format with Prettier. |

## Documentation

Documentation follows the [Diátaxis](https://diataxis.fr/) framework. Start at the hub:

**→ [docs/index.md](docs/index.md)**

Direct links:

- **Tutorials** — [Getting started](docs/tutorials/getting-started.md)
- **Reference** — [Architecture](docs/reference/architecture.md) · [Customization schema](docs/reference/customization-schema.md) · [IPC contract](docs/reference/ipc-contract.md)
- **Explanation** — [Harness model](docs/explanation/harness-model.md) · [PRD](docs/explanation/prd.md)

## Scope

- **In:** everything under `manage` and `run` above, plus workspaces/projects, health checks and a workspace file browser. Full breakdown in the [PRD](docs/explanation/prd.md#5-scope).
- **Out:** being a harness itself, collaboration and team sync, any cloud component, telemetry.
- **Adding a harness:** a registry entry plus one adapter — see [the contract](docs/explanation/harness-model.md#adding-a-harness).

## Repository

Source: [github.com/ogs-tech/ai-companion](https://github.com/ogs-tech/ai-companion).
