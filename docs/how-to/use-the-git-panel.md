---
title: Use the Git panel
description: Review diffs, stage, discard and commit changes in a workspace or Project repository without leaving the app.
---

# Use the Git panel

A focused Git client for the folders the app already knows: the active workspace's root and each registered
Project. It covers the review-and-commit loop. It has no branches, history, push or pull — use your usual
Git tool for those. Method-level details: [IPC contract → `git`](../reference/ipc-contract.md#git).

**Prerequisite:** `git` on your `PATH`. Available in non-default workspaces only.

## Open it

Explorer panel (left) → switch the view from **Arquivos** to **Git**. Pick the target in **Repositório**:
**Raiz do workspace** or one of the Projects.

The target folder must itself be the repository root. A Project that is a subfolder of a larger repository
shows **Esta pasta não é um repositório git.** — open the parent instead. For a folder that really has no
repository, **Inicializar repositório** runs `git init` there.

## Review changes

Files are grouped into **Alterações em stage** and **Alterações**. Click a file to open its diff in a tab:
an unstaged file shows index → working tree (untracked files appear fully added), a staged file shows
HEAD → index. Binary files and very large diffs (over 1 MB or 20,000 lines) are not rendered.

Repositories with more than 5,000 changed files show only the first 5,000 and say so.

## Stage, unstage, discard

Per file (hover the row) or for the whole group:

| Action | Effect |
|---|---|
| **Adicionar ao stage** / **Adicionar tudo ao stage** | `git add` — deletions included. |
| **Remover do stage** / **Remover tudo do stage** | `git restore --staged` (or `git rm --cached` before the first commit). |
| **Descartar alterações** / **Descartar tudo** | Tracked files go back to their staged version; **untracked files are deleted from disk**. Always asks for confirmation; cannot be undone. |

## Commit

1. Type the message in **Mensagem do commit**.
2. Optionally tick **Amend** to rewrite the last commit instead (a message is still required; nothing needs to be staged).
3. Press **⌘↵** or click **Commit**.

Your repository's Git hooks run. If one fails, the commit is aborted and the error shows the hook's
output. Commits are made with your normal Git identity and config.

## When something goes wrong

| Message | Meaning |
|---|---|
| Lock / conflict error | Another Git process holds `index.lock`, or the tree is mid-merge. Finish or abort it elsewhere, then retry. |
| Authentication error | A credential prompt was needed. The panel never prompts — fix credentials in a terminal. |
| `GitNotFound` | `git` is not on the app's `PATH`. |
| `GitTimeout` | The command ran longer than 30 seconds and was stopped. |
