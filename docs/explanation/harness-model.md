---
title: The harness model
description: What a harness is, why this app organizes itself around that word, and the two capabilities — manage and run — it declares per harness.
created_at: 2026-09-17
updated_at: 2026-09-17
---

# The harness model

> This is the vocabulary doc. Every other document in `docs/` assumes the words
> defined here. The executable counterpart is `src/shared/harness.ts` — the
> registry that turns these definitions into the list the app actually ships.

## What a harness is

**A harness is the program that turns a language model into an agent that works
on your code.** The model thinks; the harness acts.

A language model, on its own, only produces text. It does not open files, run
tests or commit. What does that is the program around it: it decides what goes
into the context, offers the tools (read a file, edit it, run a command),
executes what the model asked for, feeds the result back, and repeats — until
the task is done. That program is the harness.

Claude Code is a harness. Cursor is another. Codex CLI, Gemini CLI and Copilot
are others. They can all run **the same model underneath** and still behave
completely differently, because an agent's behaviour is decided by its harness,
not by its model.

## Why that word

*Harness* is the tack that straps a horse to a cart. It generates no force of
its own; it converts the horse's force into useful, steerable motion. Without
one, the horse is just as strong and just as useless for pulling a load.

That is the relationship exactly. The model is the force; the harness is what
aims it at your repository. Two different harnesses on the same horse pull
different loads — which is why switching harness changes your working day even
when the model stays the same.

The term reaches software by a different route — a *test harness* is the
scaffolding that runs the code under test — but the tack image explains it
better to someone who has heard neither.

## The boundary test

A definition is only useful when it settles hard cases. Something is a harness,
for our purposes, when all three hold:

1. **It runs the agentic loop** — model → tool → result → model, until done.
2. **It has its own on-disk configuration surface** — files it reads to learn
   its instructions, skills and agents.
3. **The user installs it on their own machine.**

Which excludes:

| Not a harness | What it is |
|---|---|
| Opus 5, GPT-5 | the **engine** — the force, not the tack |
| The Anthropic API | the **plumbing** — transport, no loop, no config |
| An MCP server | a **tool** the harness exposes to the model |
| A skill, an instruction | **content** the harness consumes |
| ChatGPT, claude.ai | a **chat** — no access to your disk, no config in files |

That last cut is what gives the word commercial value. "Adapters for the main AI
tools" is vague — does Copilot autocomplete count? Does ChatGPT? **"Adapters for
the main harnesses" names exactly the market this app serves:** the tools that
read configuration off your disk.

Criterion 2 is not incidental. It is precisely what the `Adapter` port consumes:
`resolveEntityDestinations` only ever needs to know which paths a given harness
reads. Anything passing criterion 2 is adaptable today, with no new machinery
beyond its own adapter.

## The two capabilities

For each harness in the registry, this app declares what it can do:

- **`manage`** — this app owns the harness's customization files (skills,
  agents, instructions) and materializes them into that harness's own config
  surface. Every listed harness supports this; it is the reason it is listed.
- **`run`** — this app can spawn and observe that harness's own sessions. Only
  a harness that exposes its agentic loop as a **CLI** qualifies.

The asymmetry follows straight from the boundary test rather than being
arbitrary. Every harness runs the loop (criterion 1), but only some expose that
loop as a command-line program that can be spawned inside a PTY. Cursor runs
its loop inside its own GUI process — unreachable to `NodePtySessionAdapter`,
and no amount of work on our side changes that.

**`manage` is the baseline; `run` is depth.** Most harnesses will only ever
offer `manage`, and that is where breadth of coverage lives. A manage-only
harness is not a second-class citizen — it is the normal case.

## What the app supports today

| Harness | manage | run | Surface |
|---|:---:|:---:|---|
| **Claude Code** | ✅ | ✅ | `~/.claude/`, `<repo>/.claude/`, `~/AGENTS.md` · the `claude` CLI and its JSONL transcripts |
| **Cursor** | ✅ (opt-in, off by default) | — | `~/.cursor/`, `<repo>/.cursor/`, a generated `AGENTS.md` per repo |

Source of truth: `HARNESSES` in `src/shared/harness.ts`. Default settings,
settings validation and the Settings screen's toggles all derive from it, so
the table above cannot drift from the code without the tests noticing.

## Adding a harness

1. **Check the boundary test.** If it fails criterion 2, there is nothing to
   adapt and it does not belong in the registry.
2. **Add an entry to `HARNESSES`** (`src/shared/harness.ts`) with its
   `displayName`, its `capabilities` and its `defaultEnabled`. A new harness
   defaults to `false`: enabling a sync target is the user's decision.
3. **Implement the `Adapter` port** under
   `src/main/infrastructure/adapters/`, mapping each `Entity` kind to that
   harness's paths via `resolveEntityDestinations`. Prefer `strategy:
   'symlink'`; reach for `strategy: 'write'` only when the harness's format
   cannot be a symlink, and then always with an `ownershipMarker` so
   `FileMaterializer` never overwrites a file the app does not own.
4. **Wire it in the composition root** (`src/main/index.ts`) into the
   `AdapterManager`'s adapter map.

Adding `run` to a harness is a larger piece of work and is not covered by these
steps — see the named debt below.

## Named debt: the ports still say "Claude"

The `manage` side is harness-agnostic: `AdapterManager` iterates a
`Map<adapterId, Adapter>` and the `Adapter` port names no vendor.

The `run` side is not. `ClaudeSessionPort`, `ClaudeRuntimePort`,
`ClaudeSettingsPort` and `SessionTranscriptPort` put a vendor's name inside the
**application layer** — the hexagonal direction is respected (no service
imports `node-pty`), but the core knows there is a product called Claude.

This is deliberate for now, and honest: those ports encode knowledge that is
genuinely Claude-specific and should never leak into a generic service. The
clearest example is `FsClaudeTranscriptAdapter` reading a conversation from a
16 KB head plus a 256 KB tail — which works only because the Anthropic CLI
re-appends `cost-state` and `ai-title` on every turn. That is an *observed*
contract, never a published one. It belongs pinned to one harness.

Generalizing the naming (`ClaudeSessionPort` → `HarnessSessionPort`, and so on)
touches 38 files and 92 occurrences across four ports, with no behaviour change.
It is a mechanical rename and deserves its own commit, not a ride along with a
feature.

## See also

- [PRD](prd.md) — who this is for and what it promises.
- [Architecture](../reference/architecture.md) — where harness adapters sit in
  the hexagonal layout.
- [Entity schema](../reference/customization-schema.md) — what gets managed.
