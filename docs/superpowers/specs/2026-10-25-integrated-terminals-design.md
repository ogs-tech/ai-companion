# Integrated terminals — design

Status: draft for review · Date: 2026-10-25 · Branch context: `feat/folder-workspace-model`

## Intent

A developer working in a workspace regularly needs to run a command in a specific folder — for example the
`console` worktree under the workspace root — and today must leave AI Companion to do it. The only terminal-like
thing in the app is the launch-config runner, which is read-only, `node`-only and not organised: its output opens
as a tab, and the group sits pinned inside the file tree.

This feature adds **integrated terminals**: any number of interactive shells (or commands) per workspace, each with
its own working directory, shown as tabs in the canvas and managed from a **Terminals section at the bottom of the
Explorer panel**. Launch configs stop being a separate mechanism and become "create a terminal that runs this
command".

Mockups (throwaway, not committed): `.superpowers/brainstorm/49722-1792897717/content/`.

## Goals

- Open an interactive terminal at the workspace root, or in any subfolder, without leaving the app.
- Run several terminals at once; closing a tab does **not** end the process.
- One place to see and stop everything that is running in the workspace.
- Launch configs run through the same mechanism, so they gain keyboard input, Ctrl+C and restart.

## Non-goals

- Persisting terminals across app restarts, or surviving the app (no daemon, no tmux-style reattach).
- Terminals at Início (no workspace is open, so no cwd).
- Split panes inside a tab, terminal profiles/shell picker, or user-configurable keybindings.
- Changing `claude` sessions. They keep `SessionService`/`NodePtySessionAdapter` as-is; terminals are a sibling.
- Debugging features for launch configs (still a launcher, not a debugger — see `docs/how-to/run-launch-configs.md`).

## Anti-goals

- A second place that lists running processes. If launched processes and terminals are visible in two lists,
  the feature failed.
- Stopping a process as a side effect of closing a tab.

## Decisions made with the user

1. **Terminals are objects owned by the main process; tabs are views.** Closing a tab hides the view. The
   process keeps running and its output keeps being buffered. Reopening the tab replays the buffer.
2. **Stopping is always explicit** and lives in the Explorer's Terminals section (a stop button on the row).
   The tab itself has no stop button.
3. **Quitting the app ends every terminal.**
4. **Explorer layout: option A.** One collapsible **Terminais** section at the bottom of the Explorer panel,
   styled like VS Code's Outline/Timeline sections. Its header has a **＋ ▾** menu:
   `Novo terminal na raiz`, `Novo terminal em…`, then the workspace's launch configurations as
   `▶ <name>` entries. There is no separate Launch section. The Launch Configurations group pinned in the file
   tree goes away.
5. **Opening in a folder: path 2.** Right-click a folder in the file tree → `Abrir terminal aqui` (on a file,
   the containing folder). `Novo terminal em…` in the ＋ menu opens a searchable folder picker over the workspace's
   folders (type to filter, Enter opens). Both create the same kind of terminal.
6. **A terminal row shows** a status dot (green running, hollow exited 0, red exited non-zero), name, relative cwd
   (`raiz` for the root), and — when relevant — a `launch` tag, `sem aba` when no tab is open, and the exit code.
   Row actions: `■` stop while running; `↻` restart and `✕` remove once exited.
7. **Launch semantics are preserved:** running the same configuration twice creates two independent terminals.
   Configurations that are not `node` + `launch` stay listed but disabled, with the reason in the tooltip.
8. **Restart** re-runs the same command, args, env and cwd in a new PTY and reuses the row's position and name.

## Calls made by the author (please check)

- **Terminals use a PTY (`node-pty`), not `child_process`.** This is what makes input, Ctrl+C and interactive
  prompts work. It replaces `LaunchProcessPort` / `NodeChildProcessAdapter` and the read-only
  `LaunchProcessPanel`; their tests migrate. `node-pty` is already a dependency (used by
  `NodePtySessionAdapter`), so nothing new is added.
- **A new `TerminalService` + `TerminalPort`**, not an extension of `SessionService`. Sessions have anchors,
  resume ids and JSONL health reading; terminals have none of that. The scrollback buffer logic (200 000 chars,
  head-trimmed, in memory only) is the same shape as `SessionService.appendToBuffer` and
  `LaunchProcessService.appendToBuffer`; the builder should extract one shared helper rather than copy it a third
  time (this is the only refactor in scope, and only to avoid a third copy).
- **Launch becomes a thin layer.** `LaunchConfigService` still reads/validates `launch.json`; `launchConfig.run`
  now calls `TerminalService` to spawn a terminal with the resolved command, and returns that terminal's
  snapshot. `launchConfig.kill`/`status` are superseded by the `terminal.*` methods.
- **Default shell** is the user's login shell (`$SHELL`, falling back to `/bin/zsh` on macOS), started as an
  interactive shell in the chosen cwd. Launch terminals run the resolved `node …` command directly, not through
  a shell, so exit codes stay accurate. When it exits the row shows the code and the tab stays readable.
- **Switching workspace ends the current workspace's terminals, after asking** (decided with the user). If any
  terminal is running, switching/going home shows a confirm dialog ("Encerrar e trocar" / "Cancelar"); with none
  running it switches without asking. This replaces today's silent `killAll` on activation in
  `src/main/index.ts`. Exited terminals do not trigger the prompt. Quitting the app still ends everything
  without asking, as the user specified.
- **Names:** a shell terminal is named after its shell (`zsh`); a launch terminal after its configuration. The
  user can rename later; renaming is not in this scope.
- **Folder picker is custom, not the native dialog**, so it stays inside the app and can be keyboard-driven.
- **Terminal theme:** ink background (`#142036`) with cream text, from the OGS tokens in `src/renderer/tokens.ts`,
  instead of the current solarized-cream `LaunchProcessPanel` theme.
- **Tab title** is `<status dot> >_ <name> · <relative cwd>`.
- **At Início the Terminals section is hidden** (no workspace, no cwd), not shown disabled.
- **A shell that exits** (the user types `exit`) behaves like any exited terminal: the row stays with its exit
  code, offering `↻` restart and `✕` remove. Nothing is auto-removed.
- **No cap on terminal count and no auto-prune.** Memory is bounded per terminal by the 200 000-char scrollback;
  removing exited rows is manual. Revisit only if it shows up in use.
- **Launch under PTY carries over unchanged:** `resolveLaunchCommand` still resolves `program`, `args`, `env`,
  `cwd` and `${workspaceFolder}`; the PTY adds `TERM=xterm-256color` on top of the app's environment.
- **Tabs are not persisted.** On reopening a workspace there are no terminals at all (they ended with the app or
  the workspace switch), so there is nothing to restore.

## Constraints

- Follow the hexagonal split: `TerminalService` depends on a `TerminalPort`; the `node-pty` adapter lives in
  `src/main/infrastructure/`.
- New IPC under a `terminal` namespace, documented in `docs/reference/ipc-contract.md` (create, write, resize,
  kill, restart, remove, list, status/replay; output and exit events like `launchProcess:output`/`:exit`).
- Terminals are per active workspace; at Início the namespace returns `validation` (same as `launchConfig.list`
  returning `null`/`validation` today).
- Docs updated with the change: `docs/how-to/run-launch-configs.md`, `docs/reference/ipc-contract.md`,
  `docs/reference/architecture.md`, `docs/reference/on-disk-layout.md` only if anything is written to disk
  (nothing is planned).
- Lint, typecheck and tests green; Vitest coverage thresholds from `CLAUDE.md` still apply.

## What is left to the builder

- The exact `Terminal`/`TerminalSnapshot` shape in `src/shared/` and the `terminal.*` method list.
- How the canvas tab model represents a terminal view and a "no tab open" terminal (see
  `src/renderer/lib/workspace-tabs-guard.ts` and `WorkspaceScreen.tsx`).
- The scrollback replay protocol on tab reopen (the sessions' reattach path is the reference).
- Resize handling between xterm and the PTY, including hidden tabs.
- Keyboard shortcut for "new terminal at root" (the mockup shows ⌃`; confirm it does not collide).
- Whether the folder picker reuses the existing file-browser port (`file-browser-service`) for the folder list.
- Migration of existing launch tests and the removal of `LaunchProcessPanel`/`LaunchConfigsTreeGroup` once
  replaced.
