---
title: Start and manage sessions
description: Start Claude Code and Cursor sessions inside the app, work in the terminal, give a session a browser, and stop, resume or remove it.
---

# Start and manage sessions

A session is a real CLI process (`claude`, or `cursor-agent` when the Cursor adapter is on) running in a
terminal inside the app — the `run` capability. History and cost are read from the CLI's own transcripts in `~/.claude/projects/`; the
app stores nothing of its own about past sessions. Internals:
[Architecture → Session bounded context](../../technical/reference/architecture.md#session-bounded-context).

**Prerequisite:** the `claude` CLI installed and signed in, available on your `PATH`.

## Start a session

Right panel → **Sessões** → **+** (**Nova sessão**), or **Nova sessão** on a workspace's Visão geral tab.
The session starts in the open **workspace's root** — or your home folder at **Início**.

When there is a choice to make, **Nova sessão** first opens a dialog; otherwise the session starts straight away.
The dialog appears if the workspace has more than one folder, or if more than one harness is enabled
and has its CLI installed:

- **Claude / Cursor** selector — the harness for this session. It always opens on Claude (the choice is not
  remembered). A harness whose CLI is not found is disabled, with a tooltip saying so. See
  [Start a Cursor session](../harnesses/enable-cursor-adapter.md#start-a-cursor-session).
- **Todas as pastas** and one checkbox per folder (multi-folder workspaces only) — the folders the session
  can see. Only the folder of the item you are looking at is ticked at first. A folder you leave unticked is
  completely outside the session, not even an extra directory. One folder: the session runs in it. Two or
  more: it runs from a helper directory that links to exactly the ticked folders.
- **Iniciar** — disabled until at least one folder is ticked.

The **Sessões** list shows the current context's own conversations: the workspace's, or at Início only
those that ran in your home folder itself. Every session that is *running* is listed regardless of where
you are: one that belongs to another workspace (or to Início) carries that scope's name on its second line,
and clicking it switches to that workspace first and then opens its tab (with the usual prompt if you have
unsaved edits). Ended sessions are listed only under their own scope. Running sessions are also summarized
on the **Visão geral** tab.

Each click starts a fresh conversation; several can run side by side. Each opens in its own tab in the
center area.

To start a session focused on one item instead, right-click a file, folder, skill, agent or
instruction row → **New Action**. The session starts in that item's scope with `@<path>` already
typed (not sent) as your first message.

## Work in the terminal

- Type as you would in a normal terminal; the CLI's own UI and slash-commands work unchanged.
- **Paste an image** (⌘V) to attach it: the app saves it under the workspace's `attachments/` folder and
  inserts its path for the CLI.
- A 24px status line under the terminal shows the session's state and current tool on the left, and on the right
  the channel and model, context and cost (Cursor's cost is marked `~` because it is estimated)
  (see [Read a session's state](read-session-state.md)); if the process fails to start,
  **Tentar novamente** (on that line) respawns it, and **Retomar** resumes a finished one.

A link the CLI opens on its own (`/login`, an MCP sign-in) appears as a tab in the embedded browser, not
in your default browser. It only applies to sessions started by the app; if the app's link channel is
unavailable, the link opens in the default browser as usual.

## Give the session a browser

The status line no longer has a browser button, so the app has no control to turn a session's browser on.
A session that already has it enabled keeps its browser, embedded in the app and exposed to Claude as an MCP server, so it can open pages, click and read them while you watch.

Turning the browser on or off **restarts** the `claude` process (the CLI only reads MCP config at startup).
The conversation resumes automatically, but whatever the CLI was doing at that instant is interrupted.

The top bar's **Abrir navegador** button opens a standalone browser tab, unrelated to any session.

## Stop, resume, remove

Closing the tab of a **running** session only minimizes it (the tab's button reads **Minimizar**): the
process keeps running, and keeps spending, until you stop it. Reopen it from the **Sessões** list. Closing
the tab of a finished session just closes it.

In the **Sessões** list:

- **Encerrar** (stop icon) — kills the process. The row stays, marked as finished, and the session can be
  resumed with its conversation intact.
- **Apagar** (trash) — kills it if needed and removes the row. The transcript on disk is untouched; you
  can still resume it from history.

Workspace and Início sessions keep running when you switch to another workspace; each is shown under the
scope that owns it. They end when the app quits, when their workspace is deleted or its folder changes,
and — for sessions opened from a skill, agent or instruction — when you switch workspace. Their
conversations remain resumable from history.
