---
title: Use the Git panel
description: Review diffs, stage, discard and commit changes in a workspace or Project repository without leaving the app.
---

# Use the Git panel

A focused Git client for the active workspace's repository. It covers the review-and-commit loop. It has no branches, history, push or pull — use your usual
Git tool for those. Method-level details: [IPC contract → `git`](../reference/ipc-contract.md#git).

**Prerequisite:** `git` on your `PATH`. Available in non-default workspaces only.

## Open it

There is no separate Git view: the Explorer panel (left) shows the file tree with git status on it.
Above the tree, a toolbar holds the branch chip (name, ↑ahead ↓behind), `N staged` / `N changes` chips, **Stage all**, **Unstage all**, **Commit…** and the
refresh button. **Ver alterações** on the overview just expands the Explorer if it is collapsed.

The workspace root must itself be the repository root. For a folder that really has no repository, the
toolbar shows a ⎇ icon whose popover offers **Inicializar** (`git init`), and a dismissible card at the
bottom of the panel does the same. Dismissing the card is remembered per workspace.

## Review changes

A changed file shows a status letter and colour: `M` modified, `A` added, `D` deleted, `R` renamed,
`C` copied, `T` type change, `U` untracked, `!` conflict. A file with staged *and* unstaged edits shows both
(`M·M`). A folder that contains changes gets a dot, even when collapsed. Deleted files are not on disk, so
they appear in a **Removidos** section at the end of the tree.

Click a file to open it. Right-click it for **Abrir diff** (a file with both kinds of edits offers
**Abrir diff (staged)** and **Abrir diff (alterações)**): unstaged shows index → working tree (untracked
files appear fully added), staged shows HEAD → index. Binary files and very large diffs (over 1 MB or
20,000 lines) are not rendered.

Repositories with more than 5,000 changed files show only the first 5,000 and say so.

## Stage, unstage, discard

Hover a row (or focus it with the keyboard) to get inline buttons: **+** stage, **−** unstage and **↶** descartar on a file (each acts on its own side when a file is both staged and modified); **+** / **−** on a folder stage or unstage everything under it. The right-click menu has the same actions plus **Abrir diff**. **Stage all** / **Unstage all** in the toolbar act on every change:

| Action | Effect |
|---|---|
| **Stage** / **Stage all** | `git add` — deletions included. |
| **Unstage** / **Unstage all** | `git restore --staged` (or `git rm --cached` before the first commit). |
| **Descartar…** | Tracked files go back to their staged version; **untracked files are deleted from disk**. Always asks for confirmation; cannot be undone. |

## Commit

1. Click **Commit…** in the toolbar and type the message in **Mensagem do commit**.
2. Optionally tick **Amend** to rewrite the last commit instead (a message is still required; nothing needs to be staged).
3. Press **⌘↵** or click **Commit**. The popover closes when the commit succeeds.

### Generate the message with AI

Click **✦ Gerar** next to **Commit** to draft the message from the staged diff. It only fills the field — read and edit it, then commit yourself. If the field already has text, you are asked before it is replaced; after a generation the button reads **✦ Regerar**.

- It runs your own `claude` CLI headless (`claude -p`), so `claude` must be on your `PATH`; otherwise the popover shows an inline error and leaves the field alone. There is no API key and nothing else leaves the machine.
- It follows the **project's** commit convention, never your personal rules. In order, it adds up: commit sections of `CONTRIBUTING.md`, `.github/CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `docs/contributing*`; commitlint config or git's `commit.template`; and whether ≥ 60 % of the last 30 subjects are Conventional Commits. With none of those it imitates your last 10 subjects, and on an empty history it uses Conventional Commits.
- **Gerar** is disabled with nothing staged, while **Amend** is ticked (the staged diff is not what an amend commits) and while a generation runs (**Commit** is disabled too). Generation takes a few seconds and times out after 60 s.
- Very large diffs are cut at about 30,000 characters; lockfiles and generated files are listed by name only.

Your repository's Git hooks run. If one fails, the commit is aborted and the error shows the hook's
output. Commits are made with your normal Git identity and config.

## Sync with the remote

The button next to the branch chip follows the repo state:

| State | Button | Runs |
|---|---|---|
| No upstream yet | **Publicar branch** | `git push --set-upstream origin <branch>` |
| Only ahead | **Push N** | `git push` |
| Only behind | **Pull N** | `git pull --ff-only` |
| Ahead and behind | **Sincronizar ↑N ↓M** | `git pull --ff-only`, then `git push` |
| Up to date | **Fetch** | `git fetch` |

It is hidden on a detached HEAD or an unborn branch and disabled mid-merge/rebase. The **⋯** menu next to it runs Fetch, Pull or Push individually. Pull never merges or rebases for you: if the branches diverged it stops and leaves the repo untouched. If a push is rejected, the error offers **Pull e tentar de novo**. Force push is not offered.

Git never prompts: credentials come from your SSH agent or credential helper.

## When something goes wrong

| Message | Meaning |
|---|---|
| Lock / conflict error | Another Git process holds `index.lock`, or the tree is mid-merge. Finish or abort it elsewhere, then retry. |
| Authentication error | A credential prompt was needed. The panel never prompts — fix credentials in a terminal. |
| `GitNotFound` | `git` is not on the app's `PATH`. |
| `GitTimeout` | The command ran longer than 30 seconds (120 for push/pull/fetch) and was stopped. |
