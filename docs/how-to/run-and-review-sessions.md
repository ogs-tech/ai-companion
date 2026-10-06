---
title: Run and review sessions
description: Start Claude Code sessions inside the app, give them a browser, stop and resume them, and review past sessions and their cost.
---

# Run and review sessions

A session is a real `claude` CLI process running in a terminal inside the app — the `run` capability,
Claude Code only. History and cost are read from the CLI's own transcripts in `~/.claude/projects/`; the
app stores nothing of its own about past sessions. Internals:
[Architecture → Session bounded context](../reference/architecture.md#session-bounded-context).

**Prerequisite:** the `claude` CLI installed and signed in, available on your `PATH`.

## Start a session

**Customizations** panel → **Sessões** → **+** (**Nova sessão**). The session starts in:

- the **Project** in view, if the screen is scoped to one;
- otherwise the active **workspace's root** (your home folder in the Global workspace).

Each click starts a fresh conversation; several can run side by side. Each opens in its own tab in the
center area.

To start a session focused on one item instead, right-click a file, folder, skill, agent or
**INSTRUCTIONS** row → **New Action**. The session starts in that item's scope with `@<path>` already
typed (not sent) as your first message.

## Work in the terminal

- Type as you would in a normal terminal; the CLI's own UI and slash-commands work unchanged.
- **Paste an image** (⌘V) to attach it: the app saves it under the workspace's `attachments/` folder and
  inserts its path for the CLI.
- The tab header shows the state: **Iniciando**, running, **Parada** (exited) or **Erro** — with
  **Tentar novamente** to respawn.

## Give the session a browser

Click the session's globe button (**Ativar navegador da sessão**). The session gets a browser embedded in
the app, exposed to Claude as an MCP server, so it can open pages, click and read them while you watch.

Turning the browser on or off **restarts** the `claude` process (the CLI only reads MCP config at startup).
The conversation resumes automatically, but whatever the CLI was doing at that instant is interrupted.

The top bar's **Abrir navegador** button opens a standalone browser tab, unrelated to any session.

## Stop, resume, remove

In the **Sessões** list:

- **Encerrar** (stop icon) — kills the process. The row stays, marked as finished, and the session can be
  resumed with its conversation intact.
- **Apagar** (trash) — kills it if needed and removes the row. The transcript on disk is untouched; you
  can still resume it from history.

Sessions do not survive leaving the workspace: switching workspace or quitting the app stops all of them.
Their conversations remain resumable from history.

## Review past sessions and cost

1. In **Sessões**, click **Ver todas as N** at the bottom of the list. The **Histórico** tab opens.
2. The chart shows spend per day; click a day to filter to it.
3. The table lists conversations sorted by cost — **Quando**, **Sessão** (the CLI's own title),
   **Pasta**, **Modelo**, **Duração**, **Tokens**, **Custo**.
4. **Só este projeto** limits the list to the folder in view; switch it off to see every conversation on
   the machine.
5. **Retomar** on a row reopens that conversation in a new session tab (`claude --resume`).

Cost is the CLI's own figure (its `cost-state` record) whenever the transcript has one. Older transcripts
fall back to a bundled price table; a model with no known price shows no cost rather than `$0`.

### Override a model price

There is no UI for this. Add a `pricing` map to `~/.ai-companion/settings.json`, keyed by model id, in USD
per million tokens (the values below are placeholders — use your own rates):

```json
{
  "pricing": {
    "claude-opus-5-5": { "input": 15, "output": 75 }
  }
}
```

Overrides only apply where the CLI did not record a cost itself.
