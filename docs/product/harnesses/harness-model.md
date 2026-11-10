---
title: Harnesses and channels
description: What a harness is (the configuration set that steers an agent), what a channel is (the tool it reaches you through), and the two capabilities — manage and run — declared per channel.
created_at: 2026-09-17
updated_at: 2026-11-10
---

# Harnesses and channels

> This is the vocabulary doc. Every other document in `docs/` assumes the words
> defined here. The executable counterpart is `src/shared/channel.ts` — the
> registry that turns these definitions into the list of channels the app ships.

Two words, two layers:

- **Harness** — the whole set of configuration that makes a language model work
  as an agent on your code: **skills, agents, instructions, MCP servers and
  hooks.** It is what this app manages, once, in `~/.ai-companion/` and in each
  workspace's `.ai-companion/`.
- **Channel** — a tool the harness reaches an agent through: **Claude, Cursor,
  LM Studio.** Each channel has its own on-disk surface and, sometimes, a CLI
  this app can run. Config > **Canais** lists them.

The model thinks; the harness steers it; the channel is where the work happens.
One harness, many channels — the same skill can reach Claude and Cursor without
being written twice.

> **Vocabulary change (2026-11).** Earlier versions of these docs called the
> tool itself "the harness" (Claude Code *is* a harness). That now names the
> configuration set; the tools are **channels**. In code, `ChannelId`,
> `CHANNELS` and `src/shared/channel.ts` replace `ChannelId`, `CHANNELS` and
> `src/shared/channel.ts`. Persisted and IPC field names (`settings.adapters`,
> `SessionSnapshot.harness`, `adapter.*`, `session.*`) are unchanged on purpose:
> renaming them would need a data migration.

## Why "harness"

A harness is the tack that straps a horse to a cart. It generates no force of
its own; it converts the horse's force into useful, steerable motion. The model
is the force; the configuration is what aims it at your repository. Two
different harnesses on the same model pull different loads — which is why this
app exists: to keep that configuration in one place instead of once per tool.

## What makes something a channel

A channel is listed in the registry because the app can do at least one of two
things for it:

1. **Manage** — it has an **on-disk configuration surface** (the files it reads
   for instructions, skills, agents, MCP, hooks) that the app can materialize
   into. This is exactly what the `Adapter` port consumes:
   `resolveEntityDestinations` only needs to know which paths a channel reads.
2. **Run** — it exposes a **CLI** the app can spawn inside a PTY and observe.

And the user installs it on their own machine. That excludes:

| Not a channel | What it is |
|---|---|
| Opus 5, GPT-5 | the **engine** — the model itself |
| The Anthropic API | the **plumbing** — transport, no config, no CLI |
| An MCP server | a **tool** a channel exposes to the model |
| A skill, an instruction | **content** of the harness |
| ChatGPT, claude.ai | a **chat** — no access to your disk, no config in files |

## The two capabilities

- **`manage`** — this app owns the channel's customization files and
  materializes the harness into that channel's own config surface.
- **`run`** — this app can spawn and observe that channel's own sessions. Only
  a channel that exposes a **CLI** qualifies; a GUI-only tool would be
  `manage`-only.

**`manage` is the baseline for tools that read config off disk; `run` is
depth.** The two are independent: Claude and Cursor have both, and **LM Studio
is run-only** — `lms chat` talks to a local model but there are no skills,
agents or instructions on disk to sync, and no loop beyond a plain chat.

## What the app supports today

| Channel | manage | run | Surface |
|---|:---:|:---:|---|
| **Claude** | ✅ | ✅ | `~/.claude/`, `<repo>/.claude/`, `~/AGENTS.md` · the `claude` CLI and its JSONL transcripts |
| **Cursor** | ✅ (opt-in, off by default) | ✅ (same switch) | `~/.cursor/`, `<repo>/.cursor/`, a generated rule per workspace instruction · the `cursor-agent` CLI and its chat metadata (`~/.cursor/chats/`) — cost is estimated from the chat text in `store.db` (model is real, tokens are not recorded) |
| **LM Studio** | — | ✅ (opt-in, off by default) | the `lms` CLI (`lms chat` in a PTY). No resume, no history, no cost: a session is a fresh chat |

Source of truth: `CHANNELS` in `src/shared/channel.ts`. Default settings,
settings validation and the Config view's channel pages all derive from it, so
the table above cannot drift from the code without the tests noticing.

## Install and sign in from the app

Each channel's page in Config > Canais shows where it stands — **installed**,
**signed in**, **enabled** — and offers one button for the next step:

| Step | Button | What happens |
|---|---|---|
| Not installed | **Instalar** | Runs the vendor's install command in a visible terminal dialog (you can type into it). Claude: `curl -fsSL https://claude.ai/install.sh \| bash`; Cursor: `curl https://cursor.com/install -fsS \| bash`. LM Studio: `curl -fsSL https://lmstudio.ai/install.sh \| bash` installs the headless `llmster` + `lms` into `~/.lmstudio/bin` (not the GUI app). |
| Installed, signed out | **Entrar** | Runs `claude auth login` / `cursor-agent login` in the same dialog. The app never sees credentials; the CLI stores them itself. LM Studio has no account, so it has no sign-in step. |
| Ready | **Ativar** | The channel's switch appears only when it is installed and signed in, so there is no half-working state to enable. |

Status is read with the channel's own CLI (`--version`, `claude auth status`,
`cursor-agent status`) and re-checked when the app regains focus and when the
terminal dialog closes. Commands come from `CHANNELS[id].setup`, never from the
renderer.

## Adding a channel

1. **Decide the capabilities.** It needs an on-disk config surface (`manage`)
   and/or a CLI to run (`run`). If it has neither, it does not belong.
2. **Add an entry to `CHANNELS`** (`src/shared/channel.ts`) with its
   `displayName`, `capabilities`, `defaultEnabled` and `setup` (binary, version
   args, install command or download URL, and the sign-in command + status
   check, or `auth: null`). A new channel defaults to `false`: enabling a sync
   target is the user's decision.
3. **For `manage`: implement the `Adapter` port** under
   `src/main/infrastructure/adapters/`, mapping each `Entity` kind to that
   channel's paths via `resolveEntityDestinations`. Prefer `strategy:
   'symlink'`; reach for `strategy: 'write'` only when the format cannot be a
   symlink, and then always with an `ownershipMarker` so `FileMaterializer`
   never overwrites a file the app does not own. Wire it into the
   `AdapterManager`'s adapter map in `buildWorkspaceScopedServices`
   (`src/main/application/workspace-scoped-services.ts`). A run-only channel
   skips this step.
4. **For `run`: add a `CliProfile`** (`src/main/infrastructure/session-runtime/cli-profiles.ts`)
   and a `NodePtySessionAdapter` entry in `sessionRuntimes` (`src/main/index.ts`).
5. **Add a mark** in `ChannelMark.tsx` (the only place the renderer needs a
   per-channel asset).

Step by step, with tests: [Add a channel adapter](../../technical/how-to/add-a-harness-adapter.md).

## Named debt: the ports still say "Claude"

The `manage` side is harness-agnostic: `AdapterManager` iterates a
`Map<adapterId, Adapter>` and the `Adapter` port names no vendor.

The `run` side is not. `SessionRuntimePort`, `ClaudeRuntimePort`,
`ClaudeSettingsPort` and `SessionTranscriptPort` put a vendor's name inside the
**application layer** — the hexagonal direction is respected (no service
imports `node-pty`), but the core knows there is a product called Claude.

This is deliberate for now, and honest: those ports encode knowledge that is
genuinely Claude-specific and should never leak into a generic service. The
clearest example is `FsClaudeTranscriptAdapter` reading a conversation from a
16 KB head plus a 256 KB tail — which works only because the Anthropic CLI
re-appends `cost-state` and `ai-title` on every turn. That is an *observed*
contract, never a published one. It belongs pinned to one harness.

Generalizing the naming (`SessionRuntimePort` → `ChannelSessionPort`, and so on)
touches 38 files and 92 occurrences across four ports, with no behaviour change.
It is a mechanical rename and deserves its own commit, not a ride along with a
feature.

## See also

- [PRD](../about/prd.md) — who this is for and what it promises.
- [Architecture](../../technical/reference/architecture.md) — where channel adapters sit in
  the hexagonal layout.
- [Entity schema](../../technical/reference/customization-schema.md) — what gets managed.
