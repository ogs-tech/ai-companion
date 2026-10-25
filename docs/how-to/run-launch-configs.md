---
title: Run launch configurations
description: Start and stop a workspace's VS Code Node launch configurations from the app and watch their output.
---

# Run launch configurations

The app reads the open workspace's `.vscode/launch.json` and can run its Node configurations as
[terminals](../reference/ipc-contract.md#terminal) — handy for starting a dev server next to a `claude` session. It is a launcher, not a
debugger: no breakpoints, no attach. The file is never modified. Contract:
[IPC contract → `launchConfig`](../reference/ipc-contract.md#launchconfig).

## Run one

1. In the Explorer's **Terminais** section (bottom of the panel), open the **＋ ▾** menu.
2. Pick a configuration (`▶ <name>`). It starts as a terminal and opens in a tab; it has keyboard input, so
   Ctrl+C works.

Running the same configuration twice starts two independent terminals. Closing the tab does not stop it — the
row stays in **Terminais** (marked `sem aba`) and you can click it to reopen the tab with its output replayed.

## Stop, restart, remove

On the terminal's row: **■** stops it. Once it has exited, **↻** re-runs the same command in the same row and
**✕** removes it. Switching workspace asks for confirmation if anything is still running, then ends every
terminal; quitting the app ends them without asking.

## What runs, exactly

Only configurations with `"type": "node"` and `"request": "launch"` can run. Others are listed but
disabled, with a tooltip saying why. For a runnable one the app executes:

```
node <program> <args…>
```

- `cwd` defaults to the workspace folder.
- `env` is passed through, on top of the app's environment.
- `${workspaceFolder}` in `program`, `args` and `cwd` becomes the **workspace** folder. It is the only
  VS Code variable resolved; anything else (`${file}`, `${env:…}`, `preLaunchTask`, `runtimeExecutable`,
  `runtimeArgs`) is ignored.
- To edit the file, use **Editar launch.json** at the end of the **＋ ▾** menu.

`launch.json` may contain comments and trailing commas, as in VS Code. If it cannot be parsed, or an entry
is malformed, the row shows the error instead of the configurations. A workspace with no `launch.json` simply
shows no row.
