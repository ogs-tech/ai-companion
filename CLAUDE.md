# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

**AI Companion** (`ai-companion`) — an Electron desktop app that manages a developer's AI **harnesses**.

A **harness** is the program that turns a language model into an agent that works on your code: it loads the context, exposes the tools, runs the loop (model → tool → result → model) and enforces the permissions. The model thinks; the harness acts. Claude Code is a harness; Cursor is another — both can run the same model and still behave differently. Full definition, boundary test and the list of what is *not* a harness: `docs/explanation/harness-model.md`.

The app does two things for a harness, declared per harness as **capabilities** in `src/shared/harness.ts` (the registry every default, validator and toggle derives from):

- **`manage`** — owns that harness's customizations (skills, including slash-commands expressed as explicit-only skills; agent profiles; instructions) as canonical `Entity` objects backed by Markdown + YAML files, and materializes them into the harness's own config surface: Claude Code (`~/.claude/`, `<repo>/.claude/`, plus `~/AGENTS.md` for instructions) via **symbolic links**, and optionally Cursor (`~/.cursor/`, `<repo>/.cursor/`, plus a generated, marker-owned `<repo>/AGENTS.md` per linked repo for the instruction — toggle `adapters.cursor`, default off).
- **`run`** — spawns and observes that harness's own sessions: a real `claude` CLI process per session inside a PTY, plus read-only history, token cost and health read off the CLI's own JSONL transcripts. CLI-only by construction — Cursor runs its loop inside its GUI, so it is `manage`-only. That asymmetry is the domain, not a gap.

Breadth lives on `manage` (most harnesses will only ever support it); depth lives on `run`. No backend, no API, no telemetry.

Authoritative docs live in `docs/` (Diátaxis):
- `docs/explanation/harness-model.md` — what a harness is, the two capabilities, how to add one
- `docs/explanation/prd.md` — problem, audience, scope
- `docs/reference/architecture.md` — hexagonal layout
- `docs/reference/ipc-contract.md` — every IPC method
- `docs/reference/customization-schema.md` — canonical `Entity` field rules (filename predates the Entity rename)

**Read the relevant doc before editing the area it covers** — they are the source of truth for layout, IPC and schema. CLAUDE.md only carries gotchas and pointers.

## Common commands

| Task | Command |
|---|---|
| Dev server (Electron + Vite HMR) | `npm run dev` |
| Production build (main + preload + renderer to `out/`) | `npm run build` |
| Full test suite (both projects) | `npm test` |
| Watch mode | `npm run test:watch` |
| Run a single test file | `npx vitest run tests/main/application/services/skill-service.test.ts` |
| Run only the node project | `npx vitest --project node` |
| Run only the jsdom project | `npx vitest --project jsdom` |
| Lint | `npm run lint` |
| Typecheck (both node + web tsconfigs) | `npm run typecheck` |
| Format | `npm run format` |

`npm` is the canonical package manager — `package-lock.json` is committed; `yarn.lock` is local-only.

Tests are split into two Vitest projects (`vitest.config.ts`):
- **`node`** — runs `tests/main/**` and `tests/shared/**` in node env (services, IPC, infrastructure).
- **`jsdom`** — runs `tests/renderer/**` in jsdom env with `tests/renderer/setup.ts` for Testing Library.

Coverage targets `application/`, `ipc/`, `infrastructure/`, and `renderer/screens/` with thresholds `lines/functions/statements: 80`, `branches: 70`.

## Architecture — what you must know before editing

- **Three processes** (`main`, `preload`, `renderer`) + `shared` types. Built as separate bundles by `electron.vite.config.ts` into `out/{main,preload,renderer}`. Layout in `docs/reference/architecture.md`.
- **Hexagonal split inside `src/main/`** (`domain` / `application/{ports,services,schemas}` / `infrastructure` / `ipc`). **Rule:** services must depend on **ports**, never on `node:fs`, `electron`, `simple-git`, `@octokit/rest` directly — concrete I/O lives in `infrastructure/`. Enforced socially (no lint check). Layout in `docs/reference/architecture.md`.
- **Composition root:** `src/main/index.ts` wires every adapter + service and passes the `handlers` map to `createDispatcher`.
- **IPC** — single channel `ipc:call`, envelope `{ method, params }` → `IpcResult<T>`. Full shape, namespaces and per-method tables in `docs/reference/ipc-contract.md`. Renderer uses `callIpc<T>('ns.method', params)` from `src/renderer/lib/ipc.ts`. The dispatcher (`src/main/ipc/dispatcher.ts`) maps `DomainError(kind, …)` → `IpcError.kind` verbatim; plain `Error` → `kind: 'internal'`; unknown method → `kind: 'not_found'`.
- **Adding a new IPC method:** types in `src/shared/`, handler in `src/main/ipc/registry.ts` (validate raw params with `_validators.ts` helpers), call site uses `callIpc<Result>(...)`.
- **Canonical `Entity` model:** the polymorphic `Customization`/`CustomizationFrontmatter` model and its `customization-service` umbrella are **gone** (Phase 0 refactor). `src/shared/entity.ts` defines `Entity` (flat fields — `name`, `description`, `content`/`systemPrompt`, `metadata`, `source`, `urn: urn:{kind}:{name}`) and three implemented kinds: `Skill`, `Agent`, `Instruction`. The last is a **discriminated union**: `PersonalInstruction` (singleton, `name === 'default'`, `scopes === ['personal']`) or `ProjectInstruction` (`scopes === ['project']`, absolute `repoPath: string`). `EntityService` + `EntityRepository`/`FsEntityRepository` are the shared save/delete/list use case; `skill-service`, `agent-service`, `instruction-service` are thin per-entity facades wrapping `EntityService`, adding plugin-provenance merging for skill/agent. `hook-service` and `mcp-service` are **not** Entity-backed yet (Phase 1).
- **`command` removed, `global-instruction` renamed and expanded:** a slash-command is now a `Skill` with `explicitOnly: true` (↔ frontmatter `disable-model-invocation: true`) — no `command.*` IPC, no command screen. `global-instruction.*` IPC was renamed to `instruction.*` and grew `instruction.list` + `instruction.delete`; the singleton is joined by any number of project instructions. `CustomizationListScreen`/`useCustomizationList` keep their (now generic) names but call the typed namespaces (e.g. `skill.list`) via a `listMethod` param.
- **Adapters** — `claude-adapter.ts` and `cursor-adapter.ts` under `src/main/infrastructure/adapters/`, both implementing the `Adapter` port via `resolveEntityDestinations`, returning `AdapterDestination`s with `strategy: 'symlink' | 'write'` (write destinations may carry `ownershipMarker` + `ownershipCheck: 'startsWith' | 'includes'` so `FileMaterializer` recognizes app-owned files across marker syntaxes — HTML comment, JSON key, YAML key). `AdapterManager` orchestrates, dispatching `symlink` destinations to `SymlinkManager` and `write` destinations to `FileMaterializer`. Targets and sync flow in `docs/reference/architecture.md`.
- **Cursor gets a plugin-shaped hack:** Cursor has no home-level equivalent to `~/.claude/CLAUDE.md`, so the personal instruction is materialized as a local Cursor plugin under `~/.cursor/plugins/ai-companion/` (a `plugin.json` manifest and an `alwaysApply: true` rule .mdc). This is a hack — the layout is not an official public API and may break in a future Cursor release; the helper is isolated in `src/main/application/entity/cursor-plugin-manifest.ts` for easy replacement.
- **`settings.linkedRepos` is gone:** project/workspace scope now lives on the entity itself via the shared `scopes`/`scopeId` fields on `Entity` (resolved to a path at use time by `resolveScopePath`), available to `instruction`, `skill`, and `agent` alike. `Settings` no longer has a `linkedRepos` array, the `repo.link` / `repo.unlink` / `repo.list` IPC methods were removed, and the "Linked repos" section of the Settings screen was deleted.
- **Plugin-provided entities** (`source.kind === 'plugin'`) are **read-only** — `save`/`delete` raise `OperationNotAllowedForOriginError`.
- **Entity schema** — `skill`/`agent` are Markdown + YAML frontmatter; `instruction` is stored **frontmatter-free** (whole file is the body). Personal singleton at `instructions/default.md`; project instructions at `instructions/project/<slug>/{INSTRUCTION.md,meta.json}` (sidecar carries description, version, timestamps, `repoPath`). Full rules and per-kind constraints in `docs/reference/customization-schema.md`.

## Conventions and gotchas

- **Imports use `.js` extensions** even though source is `.ts` — required by `verbatimModuleSyntax: true` + ESM. Example: `import { SkillService } from './application/services/skill-service.js'`.
- **Strict TS** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` are all on. `arr[0]` is `T | undefined`; optional properties don't accept explicit `undefined` unless typed `T | undefined`.
- **No `react-router`** — `App.tsx` uses a `View` discriminated union (`'loading' | 'main' | 'settings' | 'io-error'`) with `useState`. Renderer screens for individual entities are reached via `Main.tsx`'s left-rail navigation.
- **react-query** is the data layer in the renderer — `src/renderer/lib/query-client.ts` configures it; `src/renderer/hooks/use-customization-list.ts` is the canonical example.
- **MUI + Emotion** — design tokens in `src/renderer/theme.ts`. Roboto via `@fontsource/roboto`.
- **Workspace path is per-workspace, not fixed** — `<workspace.rootPath>/.ai-companion/` (the default workspace's `rootPath` is the user's home dir, so its data dir is still `~/.ai-companion/`). Resolved at runtime and rebuilt on `workspace.switchTo` — see `docs/reference/architecture.md`'s "Workspace / Project" section. `WorkspaceBootstrapService` creates the dir tree for whichever workspace is being bootstrapped.
- **Git ops** go through `SimpleGitClient` (`simple-git`); GitHub API through `OctokitClient` (`@octokit/rest`); GitHub PAT is stored encrypted via Electron `safeStorage` (`SafeStorageCredentials`) — **never** returned by any IPC method.

## Project state

Out of the time-boxed validation spike; positioned as a harness manager for engineering. The production bar applies: **green lint + typecheck + tests are a release gate** (no "no new errors" exception). Audience, scope and non-goals in `docs/explanation/prd.md`; the vocabulary those rest on in `docs/explanation/harness-model.md`. Don't infer scope from the code; check the PRD.
