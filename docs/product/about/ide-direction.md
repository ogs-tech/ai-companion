---
title: Direction — an AI-first IDE that brings your own harness
status: Draft
created_at: 2026-11-03
---

# Direction — an AI-first IDE that brings your own harness

> [!NOTE]
> This is a **direction**, not shipped behaviour. Nothing here changes what the
> app does today; the editor does not exist yet. Vocabulary (harness, `manage`,
> `run`) in [harness-model.md](../harnesses/harness-model.md); scope and non-goals in
> [prd.md](prd.md).

## Decision

AI Companion evolves from a **harness manager** into an **AI-first IDE**
positioned as *the IDE where you bring your own harness*. Claude Code and Cursor
stay the **suppliers** of the agent loop; the app is the workbench around them —
sessions, customizations, review of what the agent changed, and (new) an editor.

The working tagline is a placeholder, not final copy.

## Why this positioning

The agent-first IDEs on the market (VS Code's agent sessions, Antigravity) ship
with their own agent. This app already works the other way round: one set of
customizations materialized into several harnesses, several harness sessions
running side by side across scopes, and cost and health read back per
conversation. Being **harness-agnostic** is the one thing a vendor's own IDE
cannot offer, and it is the part this codebase already has.

What is missing to earn the word *IDE* is a place to read and edit code and to
review what a session changed. That is the editor.

## The three paths

How the app relates to the harnesses it hosts. These are not mutually exclusive;
they are ordered.

| Path | What it is | Status |
|---|---|---|
| **1. Layer over third-party harnesses** | Each harness enters through an adapter (`manage`, plus `run` when it has a CLI). Sessions are a PTY plus read-only transcripts. | **Now.** This is the path the editor is built on. |
| **2. Structured channel to the suppliers** | Sessions emit structured events (edits, tool calls, permission requests) instead of being an opaque terminal. Feeds inline diff review and a visible plan. | **Next.** The evolution of path 1, not a prerequisite for the first editor. |
| **3. Being a supplier** | The app owns an agent loop, tools and permissions; the user brings model and key. | **Not now.** Contradicts the current non-goal "being a harness". |

### Consequence for the editor

The first editor must work **without** path 2. "What changed since this session
started" can come from git and the file watcher the app already has. When a
structured channel exists it replaces the *source* of those diffs; the interface
does not change. This is a constraint on the editor's design, not a prediction
of its shape.

### What would reopen path 3

Path 3 stays closed unless one of these becomes true:

- A supplier's CLI cannot expose the structured events the editor needs, and no
  other supplier can.
- The terms or billing of a supplier's CLI stop allowing the app to host it.
- Control of the agent loop itself — not only its events — becomes the product.

If one of these happens, revisit the non-goal in the PRD first; do not add a
model API call as a side effect of a feature.

## Not decided yet

- **Layout of the central canvas** — agent-centric with the editor on demand,
  editor-centric with the agent beside it, or two switchable surfaces (manager
  and editor). Compared in mockups; no choice recorded.
- **Editor engine and its dependency cost.** A new dependency; flag it and its
  alternatives before adding it.
- **How far the editor goes.** The anti-goal is competing as a general-purpose
  code editor; the line between "review and edit in place" and "a full editor"
  is for the editor's own design document.

## Assumptions

- Review of agent work is the job the editor must do well; typing code is
  secondary.
- The suppliers keep exposing either a CLI or a structured stream. This is the
  central bet of path 2, in the same way the PRD's central bet is that
  harnesses keep their configuration on disk.
