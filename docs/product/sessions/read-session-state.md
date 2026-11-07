---
title: Read a session's state
description: The four session states (Pergunta, Trabalhando, Ocioso, Fechado), the context and cost on each row, and what a running session is using.
---

## Read a session's state

The list, the tabs, the status bar and the session header use the same four states. The shape carries the
meaning; colour only reinforces it.

| State | Mark | Meaning |
|---|---|---|
| **Pergunta** | `!` yellow, pulses (a soft ring on its tab when that tab is not the active one) | Blocked on you: a permission prompt or a question. Never shown for a session that merely finished its turn. |
| **Trabalhando** | `✻` green, spins | A turn is running. The detail shows the current tool and elapsed time. |
| **Ocioso** | dashed ring, grey | Alive and waiting at the prompt, or no signal yet. A session just started shows "iniciando…" beside it for up to 5 seconds. |
| **Fechado** | ring with a slash, grey | The process is gone. Its tab is dimmed. |

The four chips above the list filter by state and show their counts. The row also shows how much of the
context window is used (amber over 70%, red over 90%) and the cost so far. Cursor's context is an
estimate, marked `~`.

If the app cannot tell for sure it degrades to **Ocioso** (or an estimated **Trabalhando**), never to
**Pergunta**. Cursor has no hook for its approval prompt, so there the app reads the terminal output; a
miss shows as Ocioso.


## See what a running session is using

While a session runs, the app marks what it touches:

- **Skills, agents and MCP servers** — a green "1 sessão" / "N sessões" label beside the item in the
  customization tree when a running session invoked it in the current turn or in the last 10 minutes. Hover
  it to list those sessions with their state.
- **Files** — a dot beside the file in the Explorer: green while a session is editing it, grey if a session
  changed it this turn, amber if a session is editing a file where you have unsaved changes.
- **Editor banner** — above an open file, a banner says which session is editing it or changed it this turn,
  with **Ver diff**. If you have unsaved edits in that tab it turns into a warning with **Ver o que mudou**:
  saving would overwrite what the session wrote. Nothing is ever locked.

For Claude sessions this comes from the hooks the app injects into the process, so it covers sessions the
app started.
