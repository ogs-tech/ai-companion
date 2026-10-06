---
title: Run launch configurations
description: Start and stop a Project's VS Code Node launch configurations from the app and watch their output.
---

# Run launch configurations

The app reads each registered Project's `.vscode/launch.json` and can run its Node configurations as
plain processes — handy for starting a dev server next to a `claude` session. It is a launcher, not a
debugger: no breakpoints, no attach. The file is never modified. Contract:
[IPC contract → `launchConfig`](../reference/ipc-contract.md#launchconfig).

## Run one

1. In the Explorer's file tree, expand the Project folder. A **Launch Configurations** row is pinned at
   the top of its children when the Project has a `launch.json`.
2. Expand it and click a configuration. Its output opens in a new tab and streams live.

Running the same configuration twice starts two independent processes.

## Stop one

Click **Parar** (stop icon) on the running configuration's row. Switching workspace or quitting the app
stops every launched process.

## What runs, exactly

Only configurations with `"type": "node"` and `"request": "launch"` can run. Others are listed but
disabled, with a tooltip saying why. For a runnable one the app executes:

```
node <program> <args…>
```

- `cwd` defaults to the Project folder.
- `env` is passed through, on top of the app's environment.
- `${workspaceFolder}` in `program`, `args` and `cwd` becomes the **Project's** folder. It is the only
  VS Code variable resolved; anything else (`${file}`, `${env:…}`, `preLaunchTask`, `runtimeExecutable`,
  `runtimeArgs`) is ignored.

`launch.json` may contain comments and trailing commas, as in VS Code. If it cannot be parsed, or an entry
is malformed, the row shows the error instead of the configurations. A Project with no `launch.json` simply
shows no row.
