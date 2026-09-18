---
title: PRD — AI Companion
internal_name: ai-companion
codename: forge
public_name: AI Companion
status: Ready
created_at: 2026-04-19
updated_at: 2026-09-17
---

# PRD — AI Companion

> [!NOTE]
> Vocabulary — what a *harness* is, and the `manage`/`run` capabilities this
> document leans on throughout — in [harness-model.md](harness-model.md).
> Stack and technical decisions in [reference/architecture.md](../reference/architecture.md).

## 1. Problem

A developer who works with AI does not work with *one* AI tool. They have Claude
Code in the terminal, Cursor open on another repo, and a third harness they are
trying out this month. Each one keeps its configuration in its own place, in its
own format:

- The same instruction gets written three times — `~/.claude/CLAUDE.md`,
  `~/AGENTS.md`, a Cursor rule — and the three copies drift apart within a week.
- A skill written for one harness is invisible to the others, so it gets
  rewritten instead of reused.
- Nothing is versioned together, so there is no single thing to review, roll
  back, or carry to a new machine.
- The *work* is just as scattered: sessions live in whichever terminal tab
  started them, and what each conversation cost is buried in a JSONL file
  nobody reads.

Switching harness — or simply using two — should not mean redoing the
customization work. Today it does.

## 2. What this is

A local desktop app that is the **single source of truth for your AI
customizations**, and materializes them into each harness's own config surface —
plus the one place to open and review the sessions of the harnesses that expose
a CLI.

Authored once, as Markdown + YAML, versioned in git. Adapted per harness by the
app.

## 3. Audience

**Engineering: developers and engineering teams who run more than one harness.**
That is the shape of the product today — the vocabulary, the file formats and
the git-backed workflow all assume someone comfortable in a repository.

Validation is by dogfooding: the author uses it daily, on real work, across
Claude Code and Cursor.

**Verticalizing later — specializing for a particular area or company — is a
next step, not a non-goal.** The harness model is deliberately generic enough
to survive that move: nothing in `manage`/`run` assumes the customizations are
about code.

## 4. Differentiator

**Breadth of adapters across the main harnesses on the market.** A customization
is written once and materialized in the format each harness actually reads.
Competing approaches either target a single harness, or ask the user to maintain
parallel copies by hand.

Two things make the breadth real rather than aspirational:

- **The `Adapter` port names no vendor.** Adding a harness is an entry in the
  registry plus one adapter — see "Adding a harness" in
  [harness-model.md](harness-model.md).
- **Symlinks, not copies.** The harness reads the canonical file itself, so
  there is no sync step to forget and no second copy to diverge.

Depth, where it exists, is the second differentiator: for a CLI harness, the
same app that owns its configuration also opens its sessions and reads back what
they cost.

## 5. Scope

Scope is stated per capability. See
[harness-model.md](harness-model.md#the-two-capabilities) for why the two are
not symmetric, and which harnesses have which today.

### `manage` — the baseline

- CRUD over customizations as canonical `Entity` objects in Markdown + YAML:
  **skills** (a slash-command is a skill with `explicitOnly`), **agent
  profiles**, **instructions**.
- Scoping: `personal`, `workspace`, `project` — an entity resolves to a concrete
  path at the point of use, never a stored one.
- Materialization into each enabled harness's config surface, by symlink where
  the format allows it and by marker-owned generated file where it does not.
- The adjacent configuration a harness reads but does not own: **hooks**,
  **MCP servers**, **plugins** and their **marketplaces**.
- **Health**: drift, broken symlinks, foreign files, MCP auth and runtime — the
  app reports when reality and the source of truth disagree.

### `run` — where a CLI exists

- Spawn a real harness CLI process per session inside a PTY, anchored on an
  entity, a project or a workspace.
- Read-only **session history** off the harness's own transcripts, including
  per-conversation **token cost** — read from the CLI's own accounting where it
  records one, priced from a bundled table only where it does not.

### Organization

- **Workspaces** and **Projects** as registries: one active workspace at a time,
  each with its own data directory and its own set of projects.
- A file browser over the workspace's real files, with preview for text and
  spreadsheets.

## 6. Non-goals

- **Being a harness.** The app does not run an agent loop of its own, does not
  talk to a model API, and does not replace Claude Code or Cursor. It manages
  them. Every model call this product is responsible for happens inside a
  harness the user already installed.
- **Collaboration, multi-user, team sync.** Single machine, single user. Sharing
  happens through git, like any other file in the repo.
- **Cloud anything.** No backend, no API, no telemetry, no account.
- **Managing a harness that keeps no config on disk.** A web chat has nothing to
  adapt — see the boundary test in [harness-model.md](harness-model.md#the-boundary-test).
- **Estimating cost the harness did not record.** Where a transcript carries no
  accounting of its own and the model is unpriced, the answer is blank, never a
  number that is quietly too low.
- **Git history in the UI.** The repo is the history; use a git client.

## 7. Success metrics

- The author authors **zero** customizations outside the app — no loose notes,
  no direct edits in `~/.claude/` or `~/.cursor/`.
- At least one customization is genuinely consumed by a harness in a real work
  session, on ≥ 10 working days (verifiable in the CLI's own transcripts).
- A customization written once is in use by **two different harnesses**
  simultaneously — the differentiator, exercised rather than claimed.
- Zero broken symlinks, unresolved conflicts or desynced customizations
  persisting more than one working day after the health screen reports them.
- Adding a new harness adapter costs a registry entry plus one adapter file,
  with no change to any service.

## 8. Assumptions

- The config file formats read by the supported harnesses stay roughly stable;
  where the app depends on an *observed* rather than published contract, that
  dependency is isolated in a single adapter and documented as such.
- The author's local git repos are enough to exercise project scope for real.
- A harness worth adopting will keep exposing its configuration as files on
  disk. If the market moves to opaque cloud-side config, the `manage` side of
  this product loses its footing — that is the central bet.

## Changelog

- **2026-09-17** — Repositioned from "customization manager for Claude Code" to
  **harness manager**. Introduced the harness vocabulary and the `manage`/`run`
  capability split ([harness-model.md](harness-model.md)), dropped the
  validation-spike framing (4/8-week caps, stop rules, retro checkpoints), named
  the audience (engineering, with verticalization as a next step rather than a
  non-goal), and removed the "tools other than Claude Code" non-goal, which the
  Cursor adapter had already contradicted. Scope restated per capability, and
  brought in line with what the app actually ships (hooks, MCP, plugins,
  marketplaces, sessions, history and cost, workspaces and projects).
- **2026-05-04** — Reinstated under `docs/explanation/`. Updated terminology:
  *artifacts* → *customizations*; added `global-instruction` as a fourth
  customization type. Pointer to architecture moved to
  `reference/architecture.md`.
- **2026-04-29** — Last revision before docs were removed.
