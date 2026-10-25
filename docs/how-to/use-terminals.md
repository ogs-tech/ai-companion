---
title: Use integrated terminals
description: Open shells in the workspace root or any subfolder, keep several running, and stop them from one place.
---

# Use integrated terminals

A workspace can hold any number of interactive terminals, each with its own working directory. They show up as
tabs in the canvas and are managed from the **Terminais** section at the bottom of the Explorer. They are not
available at Início (no workspace, no folder). Contract: [IPC contract → `terminal`](../reference/ipc-contract.md#terminal).

## Open one

- **Ctrl+`** — a shell at the workspace root.
- **＋ ▾ → Novo terminal na raiz** — same thing.
- **＋ ▾ → Novo terminal em…** — a searchable folder list: type to filter, ↑/↓ to move, Enter to open.
- **Right-click a folder → Abrir terminal aqui** (on a file, its containing folder).
- **＋ ▾ → ▶ \<configuration\>** — runs a `launch.json` configuration; see [Run launch configurations](run-launch-configs.md).

A shell is your login shell (`$SHELL`), named after it (`zsh`).

## Tabs are views, not processes

Closing a tab does **not** stop anything. The terminal keeps running and its output keeps being buffered
(the last 200 000 characters, in memory); its row in **Terminais** shows `sem aba` until you click it, which
reopens the tab with the scrollback replayed.

## The Terminais section

Each row shows a status dot (green running, hollow exited 0, red exited non-zero), the name, the folder
relative to the workspace root (`raiz`), a `launch` tag for launched configurations, `sem aba` when no tab is
open, and the exit code once exited. Actions: **■** stops a running terminal; **↻** restarts an exited one
(same command and folder, same row); **✕** removes an exited one. A shell you quit with `exit` stays as an
exited row until you remove it.

## What ends terminals

Quitting the app, or switching workspace. Switching asks first if anything is still running ("Encerrar e
trocar"); exited terminals do not trigger the prompt. Nothing is restored on the next launch.
