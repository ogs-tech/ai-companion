# Integrated Launcher (.vscode/launch.json) — Design

- **Date:** 2026-09-19 (validated against the codebase and revised 2026-09-27)
- **Status:** Validated against the current codebase via `/feature-dev` (three parallel code-explorer passes); two open design gaps found during validation are now resolved (§3.9). Approved, ready for implementation.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Read `launch.json` (`type: "node"`, `request: "launch"` configurations only) from every
  Project registered in the active Workspace, and let the user run one as a plain child process from a
  new "Launch Configurations" section nested under each Project in the Explorer Panel's `FolderTree`.
  `tasks.json` and non-`node` debug types are explicitly out of scope, deferred to follow-ups.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The originating request ("preciso de um launcher integrado le o mesmo formato do .vscode")
> and the clarifying conversation were in pt-BR.

---

## 1. Context and goal

The user wants to run VS Code-style launch configurations from inside AI Companion instead of switching
to VS Code — a "Run" affordance, not a debugger (this app has no debug adapter, so nothing here attaches
a real debugger; "launch" means "spawn the configured program as a plain process and show its output").

## 2. Decisions made during clarifying Q&A

1. **Format: `launch.json` only.** `tasks.json` is a natural, structurally-similar follow-up (same
   `.vscode/` directory, same JSONC parsing, same "named config → runnable command" shape) but is not
   part of this delivery.
2. **Type support: `node` only.** `launch.json`'s `type` field normally selects a VS Code debug adapter
   (`node`, `chrome`, `python`, `go`, ...); since this app has no debug adapter, every config is run as a
   plain process. Only `type: "node"` (mapped to `node <program> [...args]`) is guaranteed correct.
   Configs of any other `type`, or `request: "attach"` (nothing to attach to), are listed but shown as
   unsupported (disabled row, tooltip explaining why) rather than attempted with a best-effort/likely-wrong
   command. Rejected alternative: a generic fallback that runs `program` directly for any type — silently
   wrong for types that need a runtime prefix (e.g. Python), so rejected in favor of an explicit
   "unsupported" state.
3. **Execution model: plain child process, not the PTY session infrastructure.** Explicitly NOT reusing
   `ClaudeSessionPort`/`node-pty` (that's `claude`-CLI-specific, interactive, and carries native-module
   rebuild baggage this feature doesn't need) and NOT surfacing launched processes as `Session`s (no
   `claude`-specific concepts — no transcript, no anchor resolution) apply here.
4. **Scope: every Project registered in the active Workspace.** `ProjectService.list()` already returns
   exactly this (all Projects of the currently active workspace, not scoped to whichever project happens
   to be selected in the UI); there is no cross-workspace Project enumeration anywhere in the app today,
   and this feature does not introduce one.
5. **UI placement: nested per-Project in the Explorer Panel**, not the Control Panel, not a command-palette
   quick-picker. `FolderTree` already has a per-Project pinned-row extension point
   (`renderProjectInstructionRow`, today used only for the Project's own "Instructions" row) — a sibling
   callback (`renderProjectLaunchConfigsRow`) is the natural extension, rendered directly below it.
6. **Output panel: reuse `@xterm/xterm` in read-only mode.** Already a dependency (used by `SessionPanel`);
   gets ANSI color handling for `npm`/`node` output for free, without hand-rolling an escape-code parser.
   No `write`/`resize`-to-PTY behavior is needed — this is one-directional (process → panel), unlike
   `SessionPanel`'s bidirectional PTY.
7. **New dependency: `jsonc-parser`.** `launch.json` is JSON-with-comments-and-trailing-commas; no JSONC
   parser exists in this codebase today. `jsonc-parser` is the library VS Code itself uses for its own
   `.vscode/*.json` files. Rejected alternative: hand-rolled comment/trailing-comma stripping — reinvents
   a solved problem and risks diverging from VS Code's own parsing on edge cases (e.g. `//` inside a
   string literal).

## 3. Architecture

### 3.1 Shared types — `src/shared/launch-config.ts`

```ts
export interface LaunchConfig {
  name: string;
  type: string; // raw `type`, e.g. 'node', 'chrome' — determines `supported`
  request: string; // raw `request`, e.g. 'launch', 'attach'
  program: string; // raw, before ${workspaceFolder} substitution
  args: string[];
  cwd?: string; // raw, before substitution; defaults to the Project's path if absent
  env?: Record<string, string>;
  supported: boolean; // true only for type: 'node', request: 'launch'
}

export interface ProjectLaunchConfigs {
  projectId: string;
  configs: LaunchConfig[];
  error?: string; // malformed launch.json — surfaced per-project, doesn't break other projects
}

export type LaunchProcessStatus = 'running' | 'exited';

export interface LaunchProcessSnapshot {
  processId: string;
  projectId: string;
  configName: string;
  status: LaunchProcessStatus;
  exitCode?: number | null;
}

export interface LaunchProcessOutputEvent {
  processId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface LaunchProcessExitEvent {
  processId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/** Push channel main→renderer for live launch-process output (mirrors session:output). */
export const LAUNCH_PROCESS_OUTPUT_CHANNEL = 'launchProcess:output' as const;
/** Push channel main→renderer fired once when a launched process exits. */
export const LAUNCH_PROCESS_EXIT_CHANNEL = 'launchProcess:exit' as const;
```

Naming note: deliberately `launch-config`/`launchProcess`, not `launcher` — `src/main/infrastructure/
app-launcher/` already owns that word for the unrelated "open file with OS app" feature.

### 3.2 Domain — `src/main/domain/launch-config-command.ts`

Pure functions, no I/O:

- `substituteVariables(value: string, vars: { workspaceFolder: string }): string` — replaces
  `${workspaceFolder}` (the only variable this feature resolves; VS Code supports many more, out of scope).
- `resolveLaunchCommand(config: LaunchConfig, projectPath: string): { command: string; args: string[]; cwd: string; env?: Record<string,string> }`
  — for `type: 'node'`: `{ command: 'node', args: [substituted(program), ...substituted(args)], cwd: substituted(cwd ?? projectPath), env }`.
  Throws a typed `UnsupportedLaunchTypeError` for anything else (the service catches this and never calls
  the port for an unsupported config — the renderer already disabled the row, this is defense in depth).
  `UnsupportedLaunchTypeError extends DomainError`, fixing `kind: 'validation'` in its constructor — same
  shape as every other domain error (see `src/main/domain/plugin-errors.ts`), so the dispatcher's
  `DomainError → IpcError.kind` mapping needs no special-casing.

### 3.3 Ports — `src/main/application/ports/`

**`launch-config-reader-port.ts`**
```ts
export interface LaunchConfigReaderPort {
  /** Reads and parses `<projectPath>/.vscode/launch.json`. No file → `{ configs: [] }` (not an error). */
  read(projectPath: string): Promise<{ configs: LaunchConfig[] } | { error: string }>;
}
```

**`launch-process-port.ts`** — shaped like `ClaudeSessionPort` minus PTY concerns, plus distinct
stdout/stderr streams `child_process` gives for free:
```ts
export interface LaunchProcessSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}
export interface LaunchProcessPort {
  spawn(processId: string, opts: LaunchProcessSpawnOptions): Promise<void>;
  kill(processId: string, signal?: NodeJS.Signals): void;
  onOutput(listener: (processId: string, stream: 'stdout' | 'stderr', chunk: string) => void): void;
  onExit(listener: (processId: string, exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
}
```

`onOutput`/`onExit` each store a **single** listener (last registration wins), exactly mirroring
`ClaudeSessionPort`'s real shape (`claude-session-port.ts`'s `onData`/`onExit`, each backed by one stored
callback in `NodePtySessionAdapter`, not an array) — events are tagged with `processId`/`stream` so one
listener demuxes many spawned processes. The array-based multi-listener fan-out lives one layer up, in
`LaunchProcessService` (mirroring `SessionService`'s `outputListeners`/`exitListeners` arrays), not on the
port.

### 3.4 Infrastructure — `src/main/infrastructure/`

- **`launch-config/fs-launch-config-reader.ts`** — `node:fs/promises` + `jsonc-parser`'s `parse()` with
  an `errors` output array; any parse error → `{ error: 'malformed launch.json' }` (explicit failure per
  project, no partial-recovery guessing — matches the existing `classifyExportFailure` idiom in
  `numbers-converter-adapter.ts` of turning a raw failure into an explicit, typed result rather than
  degrading silently). Missing file → `{ configs: [] }`.
- **`launch-process/node-child-process-adapter.ts`** — `child_process.spawn(command, args, { cwd, env })`
  (not `execFile` — needs the streaming `stdout`/`stderr` pipes, not a buffered result). Pipes `data`
  events into `onOutput` per stream, `close` into `onExit`, mirroring `NodePtySessionAdapter`'s
  listener-registration shape but keeping stdout/stderr distinct instead of merging into one PTY stream.

### 3.5 Services — `src/main/application/services/`

- **`launch-config-service.ts`** — read-only. `listForProject(projectId)`, `listAll()` (iterates
  `ProjectService.list()`, calls the reader per project, isolates one project's error from the rest).
  Depends on `ProjectService` + `LaunchConfigReaderPort`.
- **`launch-process-service.ts`** — run lifecycle, shaped like `SessionService` minus anchor resolution:
  in-memory `Map<processId, LaunchProcessSnapshot>`, a capped scrollback buffer per process, listener-array
  `onOutput`/`onExit` fan-out. `run(projectId, configName)` looks up the config via `LaunchConfigService`,
  calls `resolveLaunchCommand`, calls `LaunchProcessPort.spawn`; `kill(processId)`; `status(processId)`;
  `list()`. Spawn/domain errors become `DomainError('io' | 'validation', ...)`, matching the dispatcher's
  `DomainError → IpcError.kind` mapping.

Both are workspace-scoped (built in `buildWorkspaceScopedServices`, since `LaunchConfigService` depends on
the workspace-scoped `ProjectService`) — a workspace switch tears down and rebuilds them, and (mirroring
`switchActiveWorkspace`'s existing session-kill-on-switch behavior) kills any still-running launch
processes first.

### 3.6 IPC — one namespace, `launchConfig.*`

`src/main/ipc/launch-config-handlers.ts`, registered in `src/main/ipc/registry.ts`:

| Method | Params | Result |
|---|---|---|
| `launchConfig.list` | — | `ProjectLaunchConfigs[]` (every registered Project) |
| `launchConfig.run` | `{ projectId, configName }` | `LaunchProcessSnapshot` |
| `launchConfig.kill` | `{ processId }` | `void` |
| `launchConfig.status` | `{ processId }` | `LaunchProcessSnapshot & { outputBuffer: string }` |

Live stdout/stderr rides the push channel (`LAUNCH_PROCESS_OUTPUT_CHANNEL`/`LAUNCH_PROCESS_EXIT_CHANNEL`),
per the documented exception in `docs/reference/ipc-contract.md#push-channels-exception-to-requestresponse`
— control operations stay on `ipc:call`, streamed bytes don't.

### 3.7 Composition root — `src/main/index.ts`

Mirrors `attachSessionBridges`: a new `attachLaunchProcessBridges` wiring `launchProcessService.onOutput`/
`onExit` to `mainWindow?.webContents.send(CHANNEL, payload)`. `registerRootProject`-style workspace-scoped
instantiation of `FsLaunchConfigReader` + `NodeChildProcessAdapter` + both services inside
`buildWorkspaceScopedServices`. `before-quit` and `switchActiveWorkspace` both gain a "kill every running
launch process" step, alongside the existing session-kill step.

### 3.8 Preload — `src/preload/index.ts`

`window.api.launchConfig.onOutput(processId, listener) → unsubscribe` /
`window.api.launchConfig.onExit(processId, listener) → unsubscribe`, filtered by `processId` exactly like
`session.onOutput`/`onExit`.

### 3.9 Renderer

- **`src/renderer/hooks/use-launch-configs.ts`** — react-query wrapper over `launchConfig.list`.
- **`src/renderer/hooks/use-launch-process.ts`** — `run`/`kill` mutations + output/exit subscription feeding
  a read-only `@xterm/xterm` instance (no `write`/PTY-resize plumbing needed, unlike `SessionPanel`).
- **`FolderTree.tsx`** — new prop `renderProjectLaunchConfigsRow?: (project: Project, depth: number) =>
  React.ReactNode`, invoked right after `renderProjectInstructionRow(matchedProject, depth + 1)` so it
  renders directly under the Project's own Instructions row. **Revised during validation:** called with
  `matchedProject` alone, exactly like `renderProjectInstructionRow` — not `matchedProject ?? rootProject`.
  `TreeNode` recomputes `rootProject` identically for every depth-0 entry (it means "the workspace root is
  a Project", not "this folder is the Project"), and by the time this call site runs, `canExpand` already
  lets any depth-0 folder expand via `effectiveProjectId`'s `rootProject` fallback (`FolderTree.tsx:111-112`)
  — so gating the new row on `rootProject` too would render the root Project's "Launch Configurations" row
  once per expanded top-level folder (e.g. once under `apps/`, again under `src/`), not once. Keeping the
  gate on `matchedProject` only avoids this, at the cost of the same pre-existing limitation
  `renderProjectInstructionRow` already has today: a workspace root registered as its own Project (via
  `registerRootProject`) shows neither row at this nested call site. That's addressed separately, without
  touching this existing code path — see the next bullet.
- **`WorkspaceScreen.tsx`** — implements `renderProjectLaunchConfigsRow`: a `TreeGroup` ("Launch
  Configurations") containing one `TreeGroupRow` per config — click runs it (disabled + tooltip when
  `!supported`), a running/idle badge (a new `LaunchProcessStatusBadge`, mirroring `SessionStatusBadge`'s
  visuals but driven by `LaunchProcessStatus` since launch processes aren't `Session`s and have no
  `SessionAnchor`), and a **hover action icon on the row itself for "Stop"** while running — matching the
  existing convention for stopping something in progress (`SessionsTreeGroup`'s per-row stop icon), not a
  `RowContextMenu` entry. Right-click still opens the existing `RowContextMenu` for "Edit launch.json"
  (opens the file in the existing Editor tab flow) / "Reveal in Finder" (reuses `useRevealPath`).
  **Root-Project case (revised during validation):** when `projects.find(p => p.path === workspaceRootPath)`
  exists, `WorkspaceScreen` includes that Project's own "Launch Configurations" `TreeGroup` directly inside
  the `pinnedRows` prop it already passes to `FolderTree` (rendered once, above the folder list, outside
  the per-folder recursion — see `FolderTree.tsx:341-345`) instead of relying on the nested
  `renderProjectLaunchConfigsRow` call site. This reaches the same end state the original spec wanted (the
  workspace root's own launch configs are reachable) without the duplication bug above and without changing
  `renderProjectInstructionRow`'s existing behavior.
- **New `OpenTab` kind** — `{ kind: 'launch-process'; processId: string; label: string }`, opened on run,
  rendered as a `WorkbenchTab` hosting the read-only xterm view — a sibling to the existing `session` tab
  kind, not bolted onto `SessionPanel`.
- **`data-testid`s**, following the existing per-component prefixing exactly. **Revised during
  validation:** the sibling `renderProjectInstructionRow` row keys its testid off `project.name`
  (`tree-node-instructions-${project.name}`, `WorkspaceScreen.tsx:939`), not `project.id` — Project names
  are unique per workspace (they're directory names), so there's no collision risk that would call for
  `id` instead (unlike session rows, which use `sessionId` because session names aren't unique). Keeping
  the same key for consistency: `tree-group-launch-configs-${project.name}` (group, passed as `TreeGroup`'s
  `testId`, which the component itself prefixes with `tree-group-`), `tree-launch-config-${project.name}-
  ${configName}` (row). The "Stop" hover icon follows `SessionsTreeGroup`'s own convention,
  `tree-launch-config-stop-${project.name}-${configName}`, mirroring its `tree-session-stop-${row.key}`.
  `row-context-menu-edit-launch-json` stays a `RowContextMenu` action (`reveal` reuses the existing
  `row-context-menu-reveal` testid already produced by that shared menu).

## 4. Testing

- `node` project: `LaunchConfigService`/`LaunchProcessService` unit tests (mocked ports); `FsLaunchConfig
  Reader` tests against real JSONC fixtures (comments, trailing commas, malformed, missing file, mixed
  supported/unsupported types); `resolveLaunchCommand`/`substituteVariables` pure-function tests; IPC
  handler tests (`launchConfig.*` params validation, `DomainError` → `IpcError.kind` mapping).
- `jsdom` project: `use-launch-configs`/`use-launch-process` hook tests; `FolderTree` renders
  `renderProjectLaunchConfigsRow` under the right Project node; `WorkspaceScreen` renders the root Project's
  own group via `pinnedRows` without duplicating it per expanded top-level folder; the new `TreeGroup`/rows
  (supported vs disabled-unsupported state, running badge, hover "Stop" icon); the launch-process tab opens
  and shows streamed output.

Note: `vitest.config.ts`'s actual coverage thresholds are `lines 80 / functions 76 / statements 78 /
branches 66`, slightly different from the "80/70" figures CLAUDE.md states as the project's target — the
new files fall under the existing `coverage.include` globs either way, so this doesn't change what to test,
only which exact numbers CI enforces.

## 5. Out of scope (candidate follow-ups)

- `tasks.json` support (same `.vscode/` dir, same JSONC parsing, same "named config → command" shape —
  structurally close, deliberately deferred).
- Non-`node` `launch.json` types (`chrome`, `python`, `go`, ...) and `request: "attach"` configs.
- VS Code variable substitution beyond `${workspaceFolder}` (`${file}`, `${env:VAR}`, `${input:...}`, etc.).
- Compound configurations (`"compounds"` — running several configs together).
