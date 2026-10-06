# Integrated Launcher (.vscode/launch.json) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user run a `type: "node"`, `request: "launch"` config from any registered Project's `.vscode/launch.json` as a plain child process from a new "Launch Configurations" tree group in the Explorer Panel, with its stdout/stderr streamed into a read-only terminal tab.

**Architecture:** Mirrors the existing Claude Code session bounded context one-for-one but swaps the PTY for a plain `child_process` and drops every session-specific concept (no `Session`, no anchor, no transcript): `LaunchConfigReaderPort`/`FsLaunchConfigReader` read and JSONC-parse `.vscode/launch.json`; `LaunchProcessPort`/`NodeChildProcessAdapter` spawn/observe the process; `LaunchConfigService`/`LaunchProcessService` are the workspace-scoped application services; `launchConfig.*` is a new IPC namespace with two push channels for live output/exit, exactly like `session:output`/`session:exit`. The renderer reuses `@xterm/xterm` read-only and extends `FolderTree`'s existing `renderProjectInstructionRow` extension point with a sibling `renderProjectLaunchConfigsRow`.

**Tech Stack:** Electron/TypeScript, `node:child_process`, `jsonc-parser` (new dependency), `@xterm/xterm` (existing dependency, new read-only usage), React + react-query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-vscode-launch-config-launcher-design.md` — validated against the current codebase and revised 2026-09-27 (two design gaps found during validation are resolved there and carried into this plan). Read it alongside this plan; it has the full rationale for every architectural choice below, this plan only has the executable steps.

## Global Constraints

- Only `type: "node"`, `request: "launch"` configurations are runnable — everything else (other `type`s, `request: "attach"`) is listed but shown disabled with a tooltip, never attempted.
- Plain `child_process`, never `node-pty`/`ClaudeSessionPort` — a launched process is never a `Session`, has no anchor, no transcript.
- Scope is every Project registered in the active Workspace (`ProjectService.list()`), not just the currently selected one.
- New dependency: `jsonc-parser` — no hand-rolled comment/trailing-comma stripping.
- Only `${workspaceFolder}` is substituted in `program`/`args`/`cwd` — no other VS Code variables.
- `vitest.config.ts`'s actual enforced coverage thresholds are `lines 80 / functions 76 / statements 78 / branches 66` (not the 80/70 figures CLAUDE.md states as the project's longer-term target).
- `src/main/infrastructure/app-launcher/` already owns the word "launcher" for the unrelated open-with-OS-app feature — this feature's own naming stays `launch-config`/`launchProcess` throughout.
- `tasks.json`, non-`node` types, `request: "attach"`, and VS Code variables beyond `${workspaceFolder}` are explicitly out of scope (see spec §5) — do not build toward them.

## Review Focus

- A malformed `.vscode/launch.json` (bad JSON, missing `configurations` array, a config entry missing a required string field) must surface as an explicit per-project error and never throw out of `LaunchConfigService.listAll()`, so one broken project never blocks every other project's configs from listing.
- A config whose `type`/`request` isn't `node`/`launch` must never actually be spawned, even if a supported-looking IPC call is forced — `resolveLaunchCommand` re-derives support from `type`/`request` itself rather than trusting a client-sent `supported` flag, and the UI disables the row so it can't be clicked in the first place.
- The app quitting or the active workspace switching while a launch process is still running must kill it, not orphan it — mirrors `SessionService.killAll()`'s existing behavior exactly.
- Killing an already-exited or unknown `processId` (double-click, stale UI) must be a silent no-op, never a thrown error, matching `SessionService.kill`'s semantics.
- A fast/chatty process's stdout must not grow the in-memory scrollback buffer without bound — capped at 200,000 chars per process, evicting from the front, exactly like `SessionService`'s own buffer.

---

### Task 1: Shared types + domain command resolution

**Files:**
- Create: `src/shared/launch-config.ts`
- Create: `src/main/domain/launch-config-command.ts`
- Test: `tests/main/domain/launch-config-command.test.ts`

**Interfaces:**
- Produces: `LaunchConfig`, `ProjectLaunchConfigs`, `LaunchProcessStatus`, `LaunchProcessSnapshot`, `LaunchProcessSnapshotWithOutput`, `LaunchProcessOutputEvent`, `LaunchProcessExitEvent`, `LAUNCH_PROCESS_OUTPUT_CHANNEL`, `LAUNCH_PROCESS_EXIT_CHANNEL` (`src/shared/launch-config.ts`) — every later task imports from here.
- Produces: `substituteVariables(value, vars)`, `resolveLaunchCommand(config, projectPath) → ResolvedLaunchCommand`, `UnsupportedLaunchTypeError` (`src/main/domain/launch-config-command.ts`) — consumed by Task 5's `LaunchProcessService`.

- [ ] **Step 1: Write `src/shared/launch-config.ts`**

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

/** A `LaunchProcessSnapshot` plus the scrollback captured so far — returned only by `launchConfig.status` (a single-process lookup), never by any aggregate list. */
export interface LaunchProcessSnapshotWithOutput extends LaunchProcessSnapshot {
  outputBuffer: string;
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

- [ ] **Step 2: Write the failing test for the domain functions**

Create `tests/main/domain/launch-config-command.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveLaunchCommand, substituteVariables, UnsupportedLaunchTypeError } from '../../../src/main/domain/launch-config-command.js';
import type { LaunchConfig } from '../../../src/shared/launch-config.js';

const nodeConfig = (overrides: Partial<LaunchConfig> = {}): LaunchConfig => ({
  name: 'Run script',
  type: 'node',
  request: 'launch',
  program: '${workspaceFolder}/index.js',
  args: [],
  supported: true,
  ...overrides,
});

describe('substituteVariables', () => {
  it('replaces every ${workspaceFolder} occurrence', () => {
    expect(substituteVariables('${workspaceFolder}/a/${workspaceFolder}/b', { workspaceFolder: '/repo' })).toBe('/repo/a//repo/b');
  });

  it('returns the value unchanged when it has no ${workspaceFolder} placeholder', () => {
    expect(substituteVariables('plain', { workspaceFolder: '/repo' })).toBe('plain');
  });
});

describe('resolveLaunchCommand', () => {
  it('resolves a node/launch config to a node invocation with substituted program/args/cwd', () => {
    const config = nodeConfig({
      program: '${workspaceFolder}/dist/server.js',
      args: ['--port', '${workspaceFolder}-suffix'],
      cwd: '${workspaceFolder}/sub',
    });
    const resolved = resolveLaunchCommand(config, '/repo');
    expect(resolved).toEqual({ command: 'node', args: ['/repo/dist/server.js', '--port', '/repo-suffix'], cwd: '/repo/sub' });
  });

  it('defaults cwd to the project path when the config has none', () => {
    const resolved = resolveLaunchCommand(nodeConfig(), '/repo');
    expect(resolved.cwd).toBe('/repo');
  });

  it('carries env through unchanged when present', () => {
    const resolved = resolveLaunchCommand(nodeConfig({ env: { NODE_ENV: 'development' } }), '/repo');
    expect(resolved.env).toEqual({ NODE_ENV: 'development' });
  });

  it('throws UnsupportedLaunchTypeError for a non-node type', () => {
    expect(() => resolveLaunchCommand(nodeConfig({ type: 'chrome' }), '/repo')).toThrow(UnsupportedLaunchTypeError);
  });

  it('throws UnsupportedLaunchTypeError for a non-launch request', () => {
    expect(() => resolveLaunchCommand(nodeConfig({ request: 'attach' }), '/repo')).toThrow(UnsupportedLaunchTypeError);
  });

  it('UnsupportedLaunchTypeError carries kind "validation" for the IPC dispatcher mapping', () => {
    try {
      resolveLaunchCommand(nodeConfig({ type: 'python' }), '/repo');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedLaunchTypeError);
      expect((err as UnsupportedLaunchTypeError).kind).toBe('validation');
    }
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run tests/main/domain/launch-config-command.test.ts`
Expected: FAIL — `src/main/domain/launch-config-command.js` does not exist yet.

- [ ] **Step 4: Write `src/main/domain/launch-config-command.ts`**

```ts
import { DomainError } from './errors.js';
import type { LaunchConfig } from '../../shared/launch-config.js';

export class UnsupportedLaunchTypeError extends DomainError {
  override readonly name = 'UnsupportedLaunchTypeError';
  constructor(message: string, details?: { type?: string; request?: string }) {
    super('validation', message, details);
  }
}

/** Replaces every `${workspaceFolder}` occurrence — the only VS Code variable this feature resolves. */
export function substituteVariables(value: string, vars: { workspaceFolder: string }): string {
  return value.replaceAll('${workspaceFolder}', vars.workspaceFolder);
}

export interface ResolvedLaunchCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

/**
 * Turns a `launch.json` config into a plain child-process invocation. Only
 * `type: 'node'`, `request: 'launch'` configs are runnable — this app has no
 * debug adapter, so anything else has no known launch command and throws.
 * Re-derives support from `type`/`request` itself rather than trusting the
 * config's own precomputed `supported` flag — defense in depth alongside the
 * renderer already disabling the row.
 */
export function resolveLaunchCommand(config: LaunchConfig, projectPath: string): ResolvedLaunchCommand {
  if (config.type !== 'node' || config.request !== 'launch') {
    throw new UnsupportedLaunchTypeError(
      `Unsupported launch config '${config.name}': type '${config.type}', request '${config.request}'`,
      { type: config.type, request: config.request },
    );
  }
  const vars = { workspaceFolder: projectPath };
  const sub = (value: string): string => substituteVariables(value, vars);
  return {
    command: 'node',
    args: [sub(config.program), ...config.args.map(sub)],
    cwd: sub(config.cwd ?? projectPath),
    ...(config.env ? { env: config.env } : {}),
  };
}
```

- [ ] **Step 5: Run the test again to confirm it passes**

Run: `npx vitest run tests/main/domain/launch-config-command.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/shared/launch-config.ts src/main/domain/launch-config-command.ts tests/main/domain/launch-config-command.test.ts
git commit -m "feat: add launch-config shared types and domain command resolution"
```

---

### Task 2: LaunchConfigReaderPort + FsLaunchConfigReader (+ jsonc-parser)

**Files:**
- Create: `src/main/application/ports/launch-config-reader-port.ts`
- Create: `src/main/infrastructure/launch-config/fs-launch-config-reader.ts`
- Create fixtures: `tests/main/infrastructure/launch-config/__fixtures__/valid-project/.vscode/launch.json`, `tests/main/infrastructure/launch-config/__fixtures__/malformed-project/.vscode/launch.json`, `tests/main/infrastructure/launch-config/__fixtures__/no-configurations-project/.vscode/launch.json`
- Test: `tests/main/infrastructure/launch-config/fs-launch-config-reader.test.ts`

**Interfaces:**
- Consumes: `LaunchConfig` (Task 1).
- Produces: `LaunchConfigReaderPort`, `LaunchConfigReadResult` (`src/main/application/ports/launch-config-reader-port.ts`); `FsLaunchConfigReader` (`src/main/infrastructure/launch-config/fs-launch-config-reader.ts`) — both consumed by Task 4's `LaunchConfigService` and Task 7's composition root.

- [ ] **Step 1: Install the new dependency**

Run: `npm install jsonc-parser`
Expected: `package.json`/`package-lock.json` gain `jsonc-parser` under `dependencies`.

- [ ] **Step 2: Write `src/main/application/ports/launch-config-reader-port.ts`**

```ts
import type { LaunchConfig } from '../../../shared/launch-config.js';

export type LaunchConfigReadResult = { configs: LaunchConfig[] } | { error: string };

export interface LaunchConfigReaderPort {
  /** Reads and parses `<projectPath>/.vscode/launch.json`. No file → `{ configs: [] }` (not an error). */
  read(projectPath: string): Promise<LaunchConfigReadResult>;
}
```

- [ ] **Step 3: Create the JSONC fixture files**

Create `tests/main/infrastructure/launch-config/__fixtures__/valid-project/.vscode/launch.json`:

```jsonc
{
  // VS Code launch configurations — trailing commas and comments are valid JSONC.
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Run server",
      "program": "${workspaceFolder}/server.js",
      "args": ["--port", "3000"],
    },
    {
      "type": "chrome",
      "request": "launch",
      "name": "Debug in Chrome",
      "program": "${workspaceFolder}/index.html",
      "args": [],
    },
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to process",
      "program": "${workspaceFolder}/server.js",
      "args": [],
    },
  ],
}
```

Create `tests/main/infrastructure/launch-config/__fixtures__/malformed-project/.vscode/launch.json`:

```
{
  "version": "0.2.0",
  "configurations": [
    { "type": "node", "request": "launch", "name": "Broken"
  ]
}
```

Create `tests/main/infrastructure/launch-config/__fixtures__/no-configurations-project/.vscode/launch.json`:

```json
{
  "version": "0.2.0"
}
```

- [ ] **Step 4: Write the failing test**

Create `tests/main/infrastructure/launch-config/fs-launch-config-reader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FsLaunchConfigReader } from '../../../../src/main/infrastructure/launch-config/fs-launch-config-reader.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const project = (name: string): string => path.join(fixturesDir, name);

describe('FsLaunchConfigReader', () => {
  it('parses a JSONC launch.json with comments and trailing commas, marking supported vs unsupported configs', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('valid-project'));
    if ('error' in result) throw new Error(`expected configs, got error: ${result.error}`);
    expect(result.configs).toEqual([
      { name: 'Run server', type: 'node', request: 'launch', program: '${workspaceFolder}/server.js', args: ['--port', '3000'], supported: true },
      { name: 'Debug in Chrome', type: 'chrome', request: 'launch', program: '${workspaceFolder}/index.html', args: [], supported: false },
      { name: 'Attach to process', type: 'node', request: 'attach', program: '${workspaceFolder}/server.js', args: [], supported: false },
    ]);
  });

  it('reports a malformed launch.json as an explicit error rather than guessing', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('malformed-project'));
    expect(result).toEqual({ error: 'malformed launch.json' });
  });

  it('reports valid JSON missing a "configurations" array as malformed', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('no-configurations-project'));
    expect(result).toEqual({ error: 'malformed launch.json' });
  });

  it('returns an empty config list, not an error, when the project has no .vscode/launch.json at all', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('does-not-exist'));
    expect(result).toEqual({ configs: [] });
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npx vitest run tests/main/infrastructure/launch-config/fs-launch-config-reader.test.ts`
Expected: FAIL — `fs-launch-config-reader.js` does not exist yet.

- [ ] **Step 6: Write `src/main/infrastructure/launch-config/fs-launch-config-reader.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import type { LaunchConfigReaderPort, LaunchConfigReadResult } from '../../application/ports/launch-config-reader-port.js';
import type { LaunchConfig } from '../../../shared/launch-config.js';

const MALFORMED: LaunchConfigReadResult = { error: 'malformed launch.json' };

function toLaunchConfig(raw: unknown): LaunchConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const { name, type, request, program } = obj;
  if (typeof name !== 'string' || typeof type !== 'string' || typeof request !== 'string' || typeof program !== 'string') {
    return null;
  }
  const rawArgs = obj['args'];
  const args = Array.isArray(rawArgs) ? rawArgs.filter((a): a is string => typeof a === 'string') : [];
  if (Array.isArray(rawArgs) && args.length !== rawArgs.length) return null;
  const cwd = obj['cwd'];
  const env = obj['env'];
  return {
    name,
    type,
    request,
    program,
    args,
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof env === 'object' && env !== null ? { env: env as Record<string, string> } : {}),
    supported: type === 'node' && request === 'launch',
  };
}

/**
 * Reads `<projectPath>/.vscode/launch.json`. JSONC (comments, trailing
 * commas), parsed with the same library VS Code itself uses for its own
 * `.vscode/*.json` files — see docs/superpowers/specs/2026-09-19-vscode-
 * launch-config-launcher-design.md §3.4. Any shape problem (parse error,
 * missing/wrong-typed `configurations`, a malformed entry) is reported as a
 * single explicit `{ error }` for the whole file — mirrors
 * `classifyExportFailure`'s "turn a raw failure into an explicit, typed
 * result" idiom (`src/main/infrastructure/spreadsheet/numbers-converter-
 * adapter.ts`) rather than silently dropping the bad entry.
 */
export class FsLaunchConfigReader implements LaunchConfigReaderPort {
  async read(projectPath: string): Promise<LaunchConfigReadResult> {
    let raw: string;
    try {
      raw = await readFile(join(projectPath, '.vscode', 'launch.json'), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { configs: [] };
      return MALFORMED;
    }
    const errors: ParseError[] = [];
    const parsed: unknown = parse(raw, errors, { allowTrailingComma: true });
    if (errors.length > 0) return MALFORMED;
    if (typeof parsed !== 'object' || parsed === null) return MALFORMED;
    const rawConfigurations = (parsed as Record<string, unknown>)['configurations'];
    if (!Array.isArray(rawConfigurations)) return MALFORMED;
    const configs: LaunchConfig[] = [];
    for (const entry of rawConfigurations) {
      const config = toLaunchConfig(entry);
      if (!config) return MALFORMED;
      configs.push(config);
    }
    return { configs };
  }
}
```

- [ ] **Step 7: Run the test again to confirm it passes**

Run: `npx vitest run tests/main/infrastructure/launch-config/fs-launch-config-reader.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add package.json package-lock.json src/main/application/ports/launch-config-reader-port.ts src/main/infrastructure/launch-config/ tests/main/infrastructure/launch-config/
git commit -m "feat: add jsonc-parser dependency and FsLaunchConfigReader"
```

---

### Task 3: LaunchProcessPort + NodeChildProcessAdapter + FakeLaunchProcessPort

**Files:**
- Create: `src/main/application/ports/launch-process-port.ts`
- Create: `src/main/infrastructure/launch-process/node-child-process-adapter.ts`
- Create: `src/main/application/services/__fixtures__/fake-launch-process-port.ts`
- Create fixtures: `tests/main/infrastructure/launch-process/__fixtures__/print-and-exit.sh`, `tests/main/infrastructure/launch-process/__fixtures__/print-env-and-cwd.sh`, `tests/main/infrastructure/launch-process/__fixtures__/sleep-forever.sh`
- Test: `tests/main/infrastructure/launch-process/node-child-process-adapter.test.ts`

**Interfaces:**
- Produces: `LaunchProcessPort`, `LaunchProcessSpawnOptions`, `LaunchProcessOutputListener`, `LaunchProcessExitListener` (`src/main/application/ports/launch-process-port.ts`); `NodeChildProcessAdapter`; `FakeLaunchProcessPort` — all consumed by Task 5's `LaunchProcessService` and its tests, and Task 6's composition root.

- [ ] **Step 1: Write `src/main/application/ports/launch-process-port.ts`**

```ts
export interface LaunchProcessSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export type LaunchProcessOutputListener = (processId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export type LaunchProcessExitListener = (processId: string, exitCode: number | null, signal: NodeJS.Signals | null) => void;

/**
 * Spawns a plain child process per `processId` — no PTY, no interactive
 * input, distinct stdout/stderr streams. `onOutput`/`onExit` each store a
 * single listener (mirroring `ClaudeSessionPort`'s real shape, one callback
 * per port instance) — the array-based multi-listener fan-out lives one
 * layer up, in `LaunchProcessService`, exactly like `SessionService` does
 * over `ClaudeSessionPort`.
 */
export interface LaunchProcessPort {
  spawn(processId: string, opts: LaunchProcessSpawnOptions): Promise<void>;
  kill(processId: string, signal?: NodeJS.Signals): void;
  onOutput(listener: LaunchProcessOutputListener): void;
  onExit(listener: LaunchProcessExitListener): void;
}
```

- [ ] **Step 2: Create the fixture scripts**

Create `tests/main/infrastructure/launch-process/__fixtures__/print-and-exit.sh`:

```sh
#!/bin/sh
echo "out:hello"
echo "err:oops" 1>&2
exit 3
```

Create `tests/main/infrastructure/launch-process/__fixtures__/print-env-and-cwd.sh`:

```sh
#!/bin/sh
echo "LAUNCH_TEST_VAR=$LAUNCH_TEST_VAR"
echo "CWD=$(pwd)"
```

Create `tests/main/infrastructure/launch-process/__fixtures__/sleep-forever.sh`:

```sh
#!/bin/sh
exec sleep 60
```

Make them executable:

Run: `chmod +x tests/main/infrastructure/launch-process/__fixtures__/*.sh`

- [ ] **Step 3: Write the failing test**

Create `tests/main/infrastructure/launch-process/node-child-process-adapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NodeChildProcessAdapter } from '../../../../src/main/infrastructure/launch-process/node-child-process-adapter.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string): string => path.join(fixturesDir, name);

describe('NodeChildProcessAdapter', () => {
  it('spawns a process, relays stdout/stderr on separate streams, and reports its exit code', async () => {
    const adapter = new NodeChildProcessAdapter();
    const outputs: Array<[string, 'stdout' | 'stderr', string]> = [];
    const exits: Array<[string, number | null, NodeJS.Signals | null]> = [];
    adapter.onOutput((processId, stream, chunk) => outputs.push([processId, stream, chunk]));
    adapter.onExit((processId, exitCode, signal) => exits.push([processId, exitCode, signal]));

    await adapter.spawn('proc-1', { command: fixture('print-and-exit.sh'), args: [], cwd: process.cwd() });

    await vi.waitFor(() => {
      expect(exits).toEqual([['proc-1', 3, null]]);
    });
    expect(outputs).toContainEqual(['proc-1', 'stdout', 'out:hello\n']);
    expect(outputs).toContainEqual(['proc-1', 'stderr', 'err:oops\n']);
  });

  it('passes cwd and merged env through to the spawned process', async () => {
    const adapter = new NodeChildProcessAdapter();
    const outputs: string[] = [];
    adapter.onOutput((_processId, _stream, chunk) => outputs.push(chunk));
    await adapter.spawn('proc-2', {
      command: fixture('print-env-and-cwd.sh'),
      args: [],
      cwd: process.cwd(),
      env: { LAUNCH_TEST_VAR: 'custom-value' },
    });
    await vi.waitFor(() => {
      expect(outputs.join('')).toContain('LAUNCH_TEST_VAR=custom-value');
    });
    expect(outputs.join('')).toContain(`CWD=${process.cwd()}`);
  });

  it('kill on an unknown processId is a no-op', () => {
    const adapter = new NodeChildProcessAdapter();
    expect(() => adapter.kill('nope')).not.toThrow();
  });

  it('kill terminates a running process, which then reports its exit via the exit listener', async () => {
    const adapter = new NodeChildProcessAdapter();
    const exits: Array<[string, number | null, NodeJS.Signals | null]> = [];
    adapter.onExit((processId, exitCode, signal) => exits.push([processId, exitCode, signal]));
    await adapter.spawn('proc-3', { command: fixture('sleep-forever.sh'), args: [], cwd: process.cwd() });
    adapter.kill('proc-3');
    await vi.waitFor(() => {
      expect(exits).toEqual([['proc-3', null, 'SIGTERM']]);
    });
  });

  it('spawn rejects when the binary does not exist', async () => {
    const adapter = new NodeChildProcessAdapter();
    await expect(
      adapter.spawn('proc-4', { command: '/definitely/not/a/real/binary-xyz', args: [], cwd: process.cwd() }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npx vitest run tests/main/infrastructure/launch-process/node-child-process-adapter.test.ts`
Expected: FAIL — `node-child-process-adapter.js` does not exist yet.

- [ ] **Step 5: Write `src/main/infrastructure/launch-process/node-child-process-adapter.ts`**

```ts
import { spawn as childSpawn, type ChildProcess } from 'node:child_process';
import type {
  LaunchProcessExitListener,
  LaunchProcessOutputListener,
  LaunchProcessPort,
  LaunchProcessSpawnOptions,
} from '../../application/ports/launch-process-port.js';

/** Spawns a plain (non-PTY) child process per launched config — see NodePtySessionAdapter for the analogous PTY-based adapter this mirrors, minus write/resize (nothing to write to; no PTY dimensions to report). */
export class NodeChildProcessAdapter implements LaunchProcessPort {
  private readonly children = new Map<string, ChildProcess>();
  private outputListener: LaunchProcessOutputListener | null = null;
  private exitListener: LaunchProcessExitListener | null = null;

  onOutput(listener: LaunchProcessOutputListener): void {
    this.outputListener = listener;
  }

  onExit(listener: LaunchProcessExitListener): void {
    this.exitListener = listener;
  }

  spawn(processId: string, opts: LaunchProcessSpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = childSpawn(opts.command, opts.args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      });
      this.children.set(processId, child);

      child.stdout?.on('data', (chunk: Buffer) => {
        this.outputListener?.(processId, 'stdout', chunk.toString('utf8'));
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        this.outputListener?.(processId, 'stderr', chunk.toString('utf8'));
      });

      child.once('spawn', () => {
        settled = true;
        resolve();
      });

      child.once('error', (err) => {
        this.children.delete(processId);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      child.once('exit', (exitCode, signal) => {
        this.children.delete(processId);
        if (!settled) {
          // Exited before 'spawn' ever fired — treat as a spawn failure.
          settled = true;
          reject(new Error(`Process exited with code ${exitCode} before spawning completed`));
          return;
        }
        this.exitListener?.(processId, exitCode, signal);
      });
    });
  }

  kill(processId: string, signal?: NodeJS.Signals): void {
    this.children.get(processId)?.kill(signal);
  }
}
```

- [ ] **Step 6: Run the test again to confirm it passes**

Run: `npx vitest run tests/main/infrastructure/launch-process/node-child-process-adapter.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 7: Write `src/main/application/services/__fixtures__/fake-launch-process-port.ts`**

No test of its own — a test double, mirroring `fake-claude-session-port.ts`, consumed by Task 5's and Task 6's tests.

```ts
import type {
  LaunchProcessExitListener,
  LaunchProcessOutputListener,
  LaunchProcessPort,
  LaunchProcessSpawnOptions,
} from '../../ports/launch-process-port.js';

export class FakeLaunchProcessPort implements LaunchProcessPort {
  spawnCalls: Array<{ processId: string; opts: LaunchProcessSpawnOptions }> = [];
  killed: Array<{ processId: string; signal?: NodeJS.Signals }> = [];

  private nextSpawnFailure: Error | null = null;
  private outputListener: LaunchProcessOutputListener | null = null;
  private exitListener: LaunchProcessExitListener | null = null;

  onOutput(listener: LaunchProcessOutputListener): void {
    this.outputListener = listener;
  }

  onExit(listener: LaunchProcessExitListener): void {
    this.exitListener = listener;
  }

  failNextSpawn(error: Error): void {
    this.nextSpawnFailure = error;
  }

  async spawn(processId: string, opts: LaunchProcessSpawnOptions): Promise<void> {
    if (this.nextSpawnFailure) {
      const err = this.nextSpawnFailure;
      this.nextSpawnFailure = null;
      throw err;
    }
    this.spawnCalls.push({ processId, opts });
  }

  kill(processId: string, signal?: NodeJS.Signals): void {
    this.killed.push(signal !== undefined ? { processId, signal } : { processId });
  }

  simulateOutput(processId: string, stream: 'stdout' | 'stderr', chunk: string): void {
    this.outputListener?.(processId, stream, chunk);
  }

  simulateExit(processId: string, exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitListener?.(processId, exitCode, signal);
  }
}
```

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/main/application/ports/launch-process-port.ts src/main/infrastructure/launch-process/ src/main/application/services/__fixtures__/fake-launch-process-port.ts tests/main/infrastructure/launch-process/
git commit -m "feat: add NodeChildProcessAdapter and its test fixtures"
```

---

### Task 4: LaunchConfigService

**Files:**
- Create: `src/main/application/services/launch-config-service.ts`
- Test: `tests/main/application/services/launch-config-service.test.ts`

**Interfaces:**
- Consumes: `LaunchConfigReaderPort` (Task 2), `ProjectService` (existing, `Pick<ProjectService,'list'|'get'>`).
- Produces: `LaunchConfigService` with `listForProject(projectId)`, `listAll()`, `getConfig(projectId, configName)` — consumed by Task 5's `LaunchProcessService`, Task 6's IPC handlers, Task 7's composition root.

- [ ] **Step 1: Write the failing test**

Create `tests/main/application/services/launch-config-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LaunchConfigService } from '../../../../src/main/application/services/launch-config-service.js';
import type { LaunchConfigReaderPort } from '../../../../src/main/application/ports/launch-config-reader-port.js';
import type { Project } from '../../../../src/shared/project.js';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '', ...overrides,
});

describe('LaunchConfigService', () => {
  it('listForProject resolves the project path and returns its configs', async () => {
    const reader: LaunchConfigReaderPort = {
      read: vi.fn().mockResolvedValue({ configs: [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }] }),
    };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.listForProject('p1');
    expect(reader.read).toHaveBeenCalledWith('/repos/acme');
    expect(result).toEqual({
      projectId: 'p1',
      configs: [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }],
    });
  });

  it('listForProject surfaces a reader error without configs, keyed to the project', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ error: 'malformed launch.json' }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.listForProject('p1');
    expect(result).toEqual({ projectId: 'p1', configs: [], error: 'malformed launch.json' });
  });

  it("listAll isolates one project's malformed launch.json from the others", async () => {
    const projects = [project({ id: 'p1', path: '/repos/a' }), project({ id: 'p2', path: '/repos/b' })];
    const reader: LaunchConfigReaderPort = {
      read: vi.fn().mockImplementation(async (path: string) =>
        path === '/repos/a' ? { error: 'malformed launch.json' } : { configs: [] },
      ),
    };
    const projectService = { get: vi.fn(), list: vi.fn().mockResolvedValue(projects) };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.listAll();
    expect(result).toEqual([
      { projectId: 'p1', configs: [], error: 'malformed launch.json' },
      { projectId: 'p2', configs: [] },
    ]);
  });

  it('getConfig finds a config by name and returns it with the project path', async () => {
    const configs = [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }];
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ configs }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.getConfig('p1', 'Run');
    expect(result).toEqual({ config: configs[0], projectPath: '/repos/acme' });
  });

  it('getConfig throws not_found for an unknown config name', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ configs: [] }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    await expect(service.getConfig('p1', 'Missing')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it("getConfig throws io when the project's launch.json is malformed", async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ error: 'malformed launch.json' }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    await expect(service.getConfig('p1', 'Run')).rejects.toMatchObject({ kind: 'io' });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/main/application/services/launch-config-service.test.ts`
Expected: FAIL — `launch-config-service.js` does not exist yet.

- [ ] **Step 3: Write `src/main/application/services/launch-config-service.ts`**

```ts
import type { LaunchConfig, ProjectLaunchConfigs } from '../../../shared/launch-config.js';
import type { LaunchConfigReaderPort } from '../ports/launch-config-reader-port.js';
import type { ProjectService } from './project-service.js';
import { DomainError } from '../../domain/errors.js';

export class LaunchConfigService {
  constructor(
    private readonly projectService: Pick<ProjectService, 'list' | 'get'>,
    private readonly reader: LaunchConfigReaderPort,
  ) {}

  async listForProject(projectId: string): Promise<ProjectLaunchConfigs> {
    const project = await this.projectService.get(projectId);
    const result = await this.reader.read(project.path);
    return 'error' in result ? { projectId, configs: [], error: result.error } : { projectId, configs: result.configs };
  }

  /** Every registered Project's launch configs — one project's malformed launch.json never blocks the others. */
  async listAll(): Promise<ProjectLaunchConfigs[]> {
    const projects = await this.projectService.list();
    return Promise.all(projects.map((project) => this.listForProject(project.id)));
  }

  async getConfig(projectId: string, configName: string): Promise<{ config: LaunchConfig; projectPath: string }> {
    const project = await this.projectService.get(projectId);
    const result = await this.reader.read(project.path);
    if ('error' in result) {
      throw new DomainError('io', `Cannot read launch configs for project '${projectId}': ${result.error}`);
    }
    const config = result.configs.find((c) => c.name === configName);
    if (!config) {
      throw new DomainError('not_found', `Launch config '${configName}' not found for project '${projectId}'`);
    }
    return { config, projectPath: project.path };
  }
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run tests/main/application/services/launch-config-service.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/main/application/services/launch-config-service.ts tests/main/application/services/launch-config-service.test.ts
git commit -m "feat: add LaunchConfigService"
```

---

### Task 5: LaunchProcessService

**Files:**
- Create: `src/main/application/services/launch-process-service.ts`
- Test: `tests/main/application/services/launch-process-service.test.ts`

**Interfaces:**
- Consumes: `LaunchProcessPort` (Task 3), `FakeLaunchProcessPort` (Task 3), `LaunchConfigService.getConfig` (Task 4), `resolveLaunchCommand` (Task 1).
- Produces: `LaunchProcessService` with `run(projectId, configName)`, `kill(processId)`, `status(processId)`, `list()`, `killAll()`, `onOutput(listener)`, `onExit(listener)` — consumed by Task 6's IPC handlers, Task 7's composition root.

- [ ] **Step 1: Write the failing test**

Create `tests/main/application/services/launch-process-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { LaunchProcessService } from '../../../../src/main/application/services/launch-process-service.js';
import { FakeLaunchProcessPort } from '../../../../src/main/application/services/__fixtures__/fake-launch-process-port.js';
import type { LaunchConfigService } from '../../../../src/main/application/services/launch-config-service.js';
import type { LaunchConfig } from '../../../../src/shared/launch-config.js';

const nodeConfig: LaunchConfig = { name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true };

const setup = (options?: { maxBufferChars?: number }) => {
  const port = new FakeLaunchProcessPort();
  const launchConfigService = {
    getConfig: vi.fn().mockResolvedValue({ config: nodeConfig, projectPath: '/repos/acme' }),
  } as unknown as LaunchConfigService;
  const service = new LaunchProcessService(launchConfigService, port, options);
  return { service, port, launchConfigService };
};

describe('LaunchProcessService', () => {
  it('run resolves the command and spawns it via the port, returning a running snapshot', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    expect(snapshot).toMatchObject({ projectId: 'p1', configName: 'Run', status: 'running', exitCode: null });
    expect(port.spawnCalls).toEqual([{ processId: snapshot.processId, opts: { command: 'node', args: ['index.js'], cwd: '/repos/acme' } }]);
  });

  it('run throws a typed io error when the port fails to spawn, and forgets the process', async () => {
    const { service, port } = setup();
    port.failNextSpawn(new Error('ENOENT'));
    await expect(service.run('p1', 'Run')).rejects.toMatchObject({ kind: 'io' });
    expect(service.list()).toEqual([]);
  });

  it('run throws UnsupportedLaunchTypeError for an unsupported config, never calling the port', async () => {
    const { service, port, launchConfigService } = setup();
    (launchConfigService.getConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      config: { ...nodeConfig, type: 'chrome', supported: false },
      projectPath: '/repos/acme',
    });
    await expect(service.run('p1', 'Run')).rejects.toThrow();
    expect(port.spawnCalls).toEqual([]);
  });

  it('appends streamed output to a capped scrollback buffer, replayed via status', async () => {
    const { service, port } = setup({ maxBufferChars: 10 });
    const snapshot = await service.run('p1', 'Run');
    port.simulateOutput(snapshot.processId, 'stdout', '0123456789');
    port.simulateOutput(snapshot.processId, 'stdout', 'abcde');
    expect(service.status(snapshot.processId)?.outputBuffer).toBe('56789abcde');
  });

  it('fans output out to every onOutput listener, tagged with stream', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    const events: unknown[] = [];
    service.onOutput((event) => events.push(event));
    port.simulateOutput(snapshot.processId, 'stderr', 'oops');
    expect(events).toEqual([{ processId: snapshot.processId, stream: 'stderr', chunk: 'oops' }]);
  });

  it('marks a process exited and fans the exit out once the port reports it', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    const exits: unknown[] = [];
    service.onExit((event) => exits.push(event));
    port.simulateExit(snapshot.processId, 0, null);
    expect(service.status(snapshot.processId)).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(exits).toEqual([{ processId: snapshot.processId, exitCode: 0, signal: null }]);
  });

  it('kill stops a running process immediately and is a no-op for an unknown or already-exited one', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    service.kill(snapshot.processId);
    expect(port.killed).toEqual([{ processId: snapshot.processId }]);
    expect(service.status(snapshot.processId)?.status).toBe('exited');
    service.kill(snapshot.processId);
    service.kill('unknown-id');
    expect(port.killed).toEqual([{ processId: snapshot.processId }]);
  });

  it('killAll stops every still-running process and leaves exited ones alone', async () => {
    const { service, port } = setup();
    const a = await service.run('p1', 'Run');
    const b = await service.run('p1', 'Run');
    port.simulateExit(b.processId, 0, null);
    service.killAll();
    expect(port.killed).toEqual([{ processId: a.processId }]);
  });

  it('list returns every process, running and exited alike', async () => {
    const { service } = setup();
    const a = await service.run('p1', 'Run');
    expect(service.list().map((p) => p.processId)).toEqual([a.processId]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/main/application/services/launch-process-service.test.ts`
Expected: FAIL — `launch-process-service.js` does not exist yet.

- [ ] **Step 3: Write `src/main/application/services/launch-process-service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type {
  LaunchProcessExitEvent,
  LaunchProcessOutputEvent,
  LaunchProcessSnapshot,
  LaunchProcessSnapshotWithOutput,
} from '../../../shared/launch-config.js';
import type { LaunchProcessPort } from '../ports/launch-process-port.js';
import type { LaunchConfigService } from './launch-config-service.js';
import { resolveLaunchCommand } from '../../domain/launch-config-command.js';
import { ioError } from '../../domain/errors.js';

const DEFAULT_MAX_BUFFER_CHARS = 200_000;

export type LaunchProcessOutputListener = (event: LaunchProcessOutputEvent) => void;
export type LaunchProcessExitListener = (event: LaunchProcessExitEvent) => void;

/** Run lifecycle for launched configs — shaped like `SessionService` minus anchor resolution: every `run` mints a fresh `processId`, no dedup, no resume. */
export class LaunchProcessService {
  private readonly processes = new Map<string, LaunchProcessSnapshot>();
  private readonly outputBuffers = new Map<string, string[]>();
  private readonly outputListeners: LaunchProcessOutputListener[] = [];
  private readonly exitListeners: LaunchProcessExitListener[] = [];
  private readonly maxBufferChars: number;

  constructor(
    private readonly launchConfigService: Pick<LaunchConfigService, 'getConfig'>,
    private readonly port: LaunchProcessPort,
    options?: { maxBufferChars?: number },
  ) {
    this.maxBufferChars = options?.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
    this.port.onOutput((processId, stream, chunk) => {
      this.appendToBuffer(processId, chunk);
      for (const listener of this.outputListeners) listener({ processId, stream, chunk });
    });
    this.port.onExit((processId, exitCode, signal) => {
      const process = this.processes.get(processId);
      if (process) {
        process.status = 'exited';
        process.exitCode = exitCode;
      }
      for (const listener of this.exitListeners) listener({ processId, exitCode, signal });
    });
  }

  private appendToBuffer(processId: string, chunk: string): void {
    const buf = this.outputBuffers.get(processId) ?? [];
    buf.push(chunk);
    let total = buf.reduce((n, c) => n + c.length, 0);
    while (total > this.maxBufferChars) {
      const head = buf[0]!;
      const excess = total - this.maxBufferChars;
      if (head.length <= excess) {
        buf.shift();
        total -= head.length;
      } else {
        buf[0] = head.slice(excess);
        total -= excess;
      }
    }
    this.outputBuffers.set(processId, buf);
  }

  private withOutput(process: LaunchProcessSnapshot): LaunchProcessSnapshotWithOutput {
    return { ...process, outputBuffer: (this.outputBuffers.get(process.processId) ?? []).join('') };
  }

  async run(projectId: string, configName: string): Promise<LaunchProcessSnapshot> {
    const { config, projectPath } = await this.launchConfigService.getConfig(projectId, configName);
    const resolved = resolveLaunchCommand(config, projectPath);
    const processId = randomUUID();
    const snapshot: LaunchProcessSnapshot = { processId, projectId, configName, status: 'running', exitCode: null };
    this.processes.set(processId, snapshot);
    try {
      await this.port.spawn(processId, resolved);
    } catch (err) {
      this.processes.delete(processId);
      throw ioError({
        message: `Failed to start launch config '${configName}': ${(err as Error).message}`,
        details: { reason: 'launch_process_spawn_failed' },
      });
    }
    return snapshot;
  }

  kill(processId: string): void {
    const process = this.processes.get(processId);
    if (!process || process.status !== 'running') return;
    this.port.kill(processId);
    process.status = 'exited';
  }

  status(processId: string): LaunchProcessSnapshotWithOutput | undefined {
    const process = this.processes.get(processId);
    return process ? this.withOutput(process) : undefined;
  }

  list(): LaunchProcessSnapshot[] {
    return Array.from(this.processes.values());
  }

  killAll(): void {
    for (const [processId, process] of this.processes) {
      if (process.status === 'running') {
        this.port.kill(processId);
        process.status = 'exited';
      }
    }
  }

  onOutput(listener: LaunchProcessOutputListener): void {
    this.outputListeners.push(listener);
  }

  onExit(listener: LaunchProcessExitListener): void {
    this.exitListeners.push(listener);
  }
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run tests/main/application/services/launch-process-service.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/main/application/services/launch-process-service.ts tests/main/application/services/launch-process-service.test.ts
git commit -m "feat: add LaunchProcessService"
```

---

### Task 6: IPC handlers + registry wiring + ipc-contract.md

**Files:**
- Create: `src/main/ipc/launch-config-handlers.ts`
- Test: `tests/main/ipc/launch-config-handlers.test.ts`
- Modify: `src/main/ipc/registry.ts`
- Modify: `tests/main/ipc/registry.test.ts`
- Modify: `docs/reference/ipc-contract.md`

**Interfaces:**
- Consumes: `LaunchConfigService` (Task 4), `LaunchProcessService` (Task 5).
- Produces: `buildLaunchConfigHandlers(configService, processService)` — consumed by `registry.ts`'s `buildHandlers`, which Task 7's `index.ts` calls.

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc/launch-config-handlers.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildLaunchConfigHandlers } from '../../../src/main/ipc/launch-config-handlers.js';
import type { LaunchConfigService } from '../../../src/main/application/services/launch-config-service.js';
import type { LaunchProcessService } from '../../../src/main/application/services/launch-process-service.js';

const setup = () => {
  const configService = { listAll: vi.fn().mockResolvedValue([]) } as unknown as LaunchConfigService;
  const processService = {
    run: vi.fn().mockResolvedValue({ processId: 'x', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }),
    kill: vi.fn(),
    status: vi.fn().mockReturnValue(undefined),
  } as unknown as LaunchProcessService;
  return { configService, processService, handlers: buildLaunchConfigHandlers(configService, processService) };
};

describe('launch-config-handlers', () => {
  it('launchConfig.list delegates to LaunchConfigService.listAll', async () => {
    const { handlers, configService } = setup();
    await handlers['launchConfig.list']!({});
    expect(configService.listAll).toHaveBeenCalled();
  });

  it('launchConfig.run validates params and delegates to LaunchProcessService.run', async () => {
    const { handlers, processService } = setup();
    await handlers['launchConfig.run']!({ projectId: 'p1', configName: 'Run' });
    expect(processService.run).toHaveBeenCalledWith('p1', 'Run');
  });

  it('launchConfig.run rejects missing params', async () => {
    const { handlers } = setup();
    await expect(handlers['launchConfig.run']!({})).rejects.toMatchObject({ kind: 'validation' });
    await expect(handlers['launchConfig.run']!({ projectId: 'p1' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('launchConfig.kill validates params and delegates to LaunchProcessService.kill', async () => {
    const { handlers, processService } = setup();
    await handlers['launchConfig.kill']!({ processId: 'x' });
    expect(processService.kill).toHaveBeenCalledWith('x');
  });

  it('launchConfig.status returns null for an unknown processId', async () => {
    const { handlers } = setup();
    const result = await handlers['launchConfig.status']!({ processId: 'nope' });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/main/ipc/launch-config-handlers.test.ts`
Expected: FAIL — `launch-config-handlers.js` does not exist yet.

- [ ] **Step 3: Write `src/main/ipc/launch-config-handlers.ts`**

```ts
import type { IpcHandlers } from './dispatcher.js';
import type { LaunchConfigService } from '../application/services/launch-config-service.js';
import type { LaunchProcessService } from '../application/services/launch-process-service.js';
import { asObject, asString } from './_validators.js';

export function buildLaunchConfigHandlers(
  configService: LaunchConfigService,
  processService: LaunchProcessService,
): IpcHandlers {
  return {
    'launchConfig.list': async () => configService.listAll(),
    'launchConfig.run': async (params) => {
      const raw = asObject(params, 'launchConfig.run');
      return processService.run(asString(raw['projectId'], 'projectId'), asString(raw['configName'], 'configName'));
    },
    'launchConfig.kill': async (params) => {
      const raw = asObject(params, 'launchConfig.kill');
      processService.kill(asString(raw['processId'], 'processId'));
    },
    'launchConfig.status': async (params) => {
      const raw = asObject(params, 'launchConfig.status');
      return processService.status(asString(raw['processId'], 'processId')) ?? null;
    },
  };
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run tests/main/ipc/launch-config-handlers.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Wire the new namespace into `src/main/ipc/registry.ts`**

Add imports near the top (alongside the other `build*Handlers`/service type imports):

```ts
import { buildLaunchConfigHandlers } from './launch-config-handlers.js';
import type { LaunchConfigService } from '../application/services/launch-config-service.js';
import type { LaunchProcessService } from '../application/services/launch-process-service.js';
```

Add to `IpcDeps`:

```ts
  launchConfigService: LaunchConfigService;
  launchProcessService: LaunchProcessService;
```

Destructure both in `buildHandlers`'s parameter list, and add to the returned object, alongside the other spreads:

```ts
    ...buildLaunchConfigHandlers(launchConfigService, launchProcessService),
```

- [ ] **Step 6: Update `tests/main/ipc/registry.test.ts` for the new required deps**

Add imports:

```ts
import type { LaunchConfigService } from '../../../src/main/application/services/launch-config-service.js';
import type { LaunchProcessService } from '../../../src/main/application/services/launch-process-service.js';
```

Add to the local `Deps` interface:

```ts
  launchConfigService: LaunchConfigService;
  launchProcessService: LaunchProcessService;
```

Add to `buildDeps()`, alongside the other null-stubbed services, and to its returned object:

```ts
  const launchConfigService = null as unknown as LaunchConfigService;
  const launchProcessService = null as unknown as LaunchProcessService;
```

- [ ] **Step 7: Run the whole node test project to confirm nothing broke**

Run: `npx vitest --project node run`
Expected: PASS.

- [ ] **Step 8: Document the new namespace in `docs/reference/ipc-contract.md`**

Add a `### launchConfig` section (alphabetically after `### launchConfig`'s neighbors — place it after `### instruction` and before `### session`, matching the doc's existing method-namespace ordering), modeled on `### hook`'s "not Entity-backed" framing:

```markdown
### `launchConfig`

Read-only discovery over every registered Project's `.vscode/launch.json`, plus running a `type: "node"`,
`request: "launch"` configuration as a plain child process — see
[the design spec](../superpowers/specs/2026-09-19-vscode-launch-config-launcher-design.md) for the full
rationale. Not Entity-backed (no `urn`, no `scopes`) — same precedent as `hook`/`mcp`.

| Method | Params | Result |
|---|---|---|
| `launchConfig.list` | — | `ProjectLaunchConfigs[]` (every registered Project) |
| `launchConfig.run` | `{ projectId: string; configName: string }` | `LaunchProcessSnapshot` |
| `launchConfig.kill` | `{ processId: string }` | `void` |
| `launchConfig.status` | `{ processId: string }` | `LaunchProcessSnapshot & { outputBuffer: string } \| null` |

`LaunchConfig` (`src/shared/launch-config.ts`): `{ name: string; type: string; request: string; program: string;
args: string[]; cwd?: string; env?: Record<string,string>; supported: boolean }` — `supported` is `true` only for
`type: 'node'`, `request: 'launch'`; anything else is listed but `launchConfig.run` on it throws
`kind: 'validation'` (`resolveLaunchCommand`/`UnsupportedLaunchTypeError`,
`src/main/domain/launch-config-command.ts`) even if called directly, re-deriving support from `type`/`request`
rather than trusting a client-sent flag. `ProjectLaunchConfigs`: `{ projectId: string; configs: LaunchConfig[];
error?: string }` — `error` is set (configs empty) when that Project's `launch.json` is missing, has
parse errors, or has a malformed entry; a missing `.vscode/launch.json` file itself is *not* an error, just an
empty `configs` array. `LaunchProcessSnapshot`: `{ processId: string; projectId: string; configName: string;
status: 'running' \| 'exited'; exitCode?: number \| null }` — `processId` is a fresh `crypto.randomUUID()` minted
on every `launchConfig.run` call, with no dedup (unlike a `session.spawn` entity anchor): running the same config
twice starts two independent processes. `launchConfig.run` surfaces `kind: 'io'` for a spawn failure (missing
`node` binary, bad cwd) and `kind: 'not_found'` for an unknown `projectId`/`configName`; `launchConfig.kill`
never throws for an unknown or already-exited `processId` — it silently no-ops, same as `session.kill`. Backed
by `LaunchConfigService`/`LaunchProcessService` (`src/main/application/services/`) over `LaunchConfigReaderPort`
(`FsLaunchConfigReader`) and `LaunchProcessPort` (`NodeChildProcessAdapter`, `src/main/infrastructure/`).
```

- [ ] **Step 9: Document the new push channels in the same file's "Push channels" section**

In the paragraph starting "Every method above is request/response over `ipc:call`. One exception: `session:output` and `session:exit`...", add a sentence after it:

```markdown
A third pair, `launchProcess:output`/`launchProcess:exit` (`src/shared/launch-config.ts`), streams a launched
config's stdout/stderr and reports its exit the same way, filtered by `processId` instead of `sessionId` —
`window.api.launchConfig.onOutput(processId, listener) → unsubscribe`, `.onExit(processId, listener) →
unsubscribe`, and an unfiltered `.onAnyExit(listener) → unsubscribe` mirroring `session.onAnyExit`.
```

- [ ] **Step 10: Typecheck, lint, and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add src/main/ipc/launch-config-handlers.ts src/main/ipc/registry.ts tests/main/ipc/launch-config-handlers.test.ts tests/main/ipc/registry.test.ts docs/reference/ipc-contract.md
git commit -m "feat: add launchConfig.* IPC namespace"
```

---

### Task 7: Composition root wiring

**Files:**
- Modify: `src/main/application/workspace-scoped-services.ts`
- Modify: `tests/main/application/workspace-scoped-services.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `FsLaunchConfigReader` (Task 2), `NodeChildProcessAdapter`/`FakeLaunchProcessPort` (Task 3), `LaunchConfigService` (Task 4), `LaunchProcessService` (Task 5), `LAUNCH_PROCESS_OUTPUT_CHANNEL`/`LAUNCH_PROCESS_EXIT_CHANNEL` (Task 1).
- Produces: `WorkspaceScopedServices.launchConfigService`/`.launchProcessService`, wired end-to-end into the running app — consumed by Task 8's preload bridge (via the push channels this task attaches) and by every renderer task from Task 9 onward (via the IPC methods this task's `buildDeps()` now backs).

No dedicated test for the `index.ts` half — matches this codebase's existing convention (no test file targets `index.ts`; its composition wiring is exercised indirectly by every other test that spawns the app, plus `npm run build`/`typecheck` here). `workspace-scoped-services.ts` **is** unit-tested, so that half gets its existing test file updated.

- [ ] **Step 1: Add the new shared deps + services to `workspace-scoped-services.ts`**

Add imports:

```ts
import { LaunchConfigService } from './services/launch-config-service.js';
import { LaunchProcessService } from './services/launch-process-service.js';
import type { LaunchConfigReaderPort } from './ports/launch-config-reader-port.js';
import type { LaunchProcessPort } from './ports/launch-process-port.js';
```

Add to `WorkspaceScopedSharedDeps`:

```ts
  launchConfigReaderPort: LaunchConfigReaderPort;
  launchProcessPort: LaunchProcessPort;
```

Add to `WorkspaceScopedServices`:

```ts
  launchConfigService: LaunchConfigService;
  launchProcessService: LaunchProcessService;
```

In `buildWorkspaceScopedServices`, destructure the two new shared deps alongside the existing ones, construct the services (after `projectService` is built, since `LaunchConfigService` depends on it), and add both to the returned object:

```ts
  const launchConfigService = new LaunchConfigService(projectService, launchConfigReaderPort);
  const launchProcessService = new LaunchProcessService(launchConfigService, launchProcessPort);
```

- [ ] **Step 2: Update `tests/main/application/workspace-scoped-services.test.ts`'s `buildShared()`**

Add imports:

```ts
import { FsLaunchConfigReader } from '../../../src/main/infrastructure/launch-config/fs-launch-config-reader.js';
import { FakeLaunchProcessPort } from '../../../src/main/application/services/__fixtures__/fake-launch-process-port.js';
```

Add two fields to the object `buildShared()` returns:

```ts
    launchConfigReaderPort: new FsLaunchConfigReader(),
    launchProcessPort: new FakeLaunchProcessPort(),
```

- [ ] **Step 3: Run the test to confirm it still passes with the new deps**

Run: `npx vitest run tests/main/application/workspace-scoped-services.test.ts`
Expected: PASS (both existing tests) — this task adds no new test of its own here since `LaunchConfigService`/`LaunchProcessService` hold no per-`dataDir` state to assert independence over (they only delegate to the already-independence-tested `ProjectService` and to filesystem/process ports).

- [ ] **Step 4: Wire `src/main/index.ts`**

Add imports:

```ts
import { FsLaunchConfigReader } from './infrastructure/launch-config/fs-launch-config-reader.js';
import { NodeChildProcessAdapter } from './infrastructure/launch-process/node-child-process-adapter.js';
import { LAUNCH_PROCESS_OUTPUT_CHANNEL, LAUNCH_PROCESS_EXIT_CHANNEL } from '../shared/launch-config.js';
```

Add two entries to `sharedDeps` (right beside `claudeSessionPort`/`sessionTranscriptPort`):

```ts
    launchConfigReaderPort: new FsLaunchConfigReader(),
    launchProcessPort: new NodeChildProcessAdapter(),
```

Add `attachLaunchProcessBridges`, defined and called right after `attachSessionBridges`:

```ts
  const attachLaunchProcessBridges = (services: WorkspaceScopedServices): void => {
    services.launchProcessService.onOutput((event) => {
      mainWindow?.webContents.send(LAUNCH_PROCESS_OUTPUT_CHANNEL, event);
    });
    services.launchProcessService.onExit((event) => {
      mainWindow?.webContents.send(LAUNCH_PROCESS_EXIT_CHANNEL, event);
    });
  };
  attachLaunchProcessBridges(workspaceScoped);
```

In the `before-quit` handler, add a line beside `workspaceScoped.sessionService.killAll()`:

```ts
    workspaceScoped.launchProcessService.killAll();
```

In `switchActiveWorkspace`, add the kill call right after `workspaceScoped.sessionService.killAll()` and the bridge re-attach right after `attachSessionBridges(workspaceScoped)`:

```ts
      workspaceScoped.launchProcessService.killAll();
      // ... existing lines (embeddedBrowserAdapter.destroyAll, entityWatchService.stop, switchTo, bootstrap, buildWorkspaceScopedServices) unchanged ...
      attachLaunchProcessBridges(workspaceScoped);
```

In `buildDeps()`, add the two services:

```ts
    launchConfigService: workspaceScoped.launchConfigService,
    launchProcessService: workspaceScoped.launchProcessService,
```

- [ ] **Step 5: Build and typecheck the whole app**

Run: `npm run typecheck && npm run build`
Expected: no errors — this is the verification for the untested `index.ts` half.

- [ ] **Step 6: Commit**

```bash
git add src/main/application/workspace-scoped-services.ts tests/main/application/workspace-scoped-services.test.ts src/main/index.ts
git commit -m "feat: wire launch-config services into the composition root and app lifecycle"
```

---

### Task 8: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/vite-env.d.ts`
- Modify: `tests/renderer/test-utils.tsx`

**Interfaces:**
- Consumes: `LAUNCH_PROCESS_OUTPUT_CHANNEL`/`LAUNCH_PROCESS_EXIT_CHANNEL`, `LaunchProcessOutputEvent`/`LaunchProcessExitEvent` (Task 1).
- Produces: `window.api.launchConfig.{onOutput, onExit, onAnyExit}` — consumed by Task 10's `useLaunchProcessOutput`/`useLaunchProcesses` hooks.

No dedicated test — matches this codebase's existing convention (no test file targets `src/preload/index.ts`; every consumer of `window.api.launchConfig` gets its own test via the `mockApi()` double this task updates).

- [ ] **Step 1: Add the bridge to `src/preload/index.ts`**

Add an import alongside the existing `session`/`entity` shared-type imports:

```ts
import {
  LAUNCH_PROCESS_OUTPUT_CHANNEL,
  LAUNCH_PROCESS_EXIT_CHANNEL,
  type LaunchProcessOutputEvent,
  type LaunchProcessExitEvent,
} from '../shared/launch-config.js';
```

Add a `launchConfig` key to the `api` object literal, alongside `session`/`entity`:

```ts
  launchConfig: {
    onOutput: (processId: string, listener: (stream: 'stdout' | 'stderr', chunk: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: LaunchProcessOutputEvent): void => {
        if (payload.processId === processId) listener(payload.stream, payload.chunk);
      };
      ipcRenderer.on(LAUNCH_PROCESS_OUTPUT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(LAUNCH_PROCESS_OUTPUT_CHANNEL, wrapped);
    },
    onExit: (processId: string, listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: LaunchProcessExitEvent): void => {
        if (payload.processId === processId) listener(payload.exitCode, payload.signal);
      };
      ipcRenderer.on(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
    },
    /** Unfiltered — for the renderer-side launch-process store, which doesn't know every live processId up front. */
    onAnyExit: (listener: (processId: string, exitCode: number | null, signal: NodeJS.Signals | null) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: LaunchProcessExitEvent): void => listener(payload.processId, payload.exitCode, payload.signal);
      ipcRenderer.on(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
    },
  },
```

- [ ] **Step 2: Declare the type on `window.api` in `src/renderer/vite-env.d.ts`**

Add an import:

```ts
import type { LaunchProcessOutputEvent, LaunchProcessExitEvent } from '../shared/launch-config.js';
```

Wait — `vite-env.d.ts` imports `LaunchProcessOutputEvent`/`LaunchProcessExitEvent` only for documentation purposes here; the actual declared method signatures use plain primitives (matching how `session`'s own declaration below does), so this import is unnecessary — skip it and declare the methods with plain parameter types instead, mirroring `session`'s existing style exactly:

Add to the `Window.api` interface, alongside `session`/`entity`:

```ts
      launchConfig: {
        onOutput(processId: string, listener: (stream: 'stdout' | 'stderr', chunk: string) => void): () => void;
        onExit(processId: string, listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): () => void;
        onAnyExit(listener: (processId: string, exitCode: number | null, signal: NodeJS.Signals | null) => void): () => void;
      };
```

- [ ] **Step 3: Update the `mockApi()` test double in `tests/renderer/test-utils.tsx`**

Add a `launchConfig` object to `mockApi()`'s `Object.defineProperty(window, 'api', ...)` value, alongside `session`/`entity`:

```ts
  const launchConfig = {
    onOutput: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    onAnyExit: vi.fn(() => () => {}),
  };
```

And include it in the `value` object: `{ call, session, entity, launchConfig, getPathForFile }`.

- [ ] **Step 4: Typecheck and run the renderer test project**

Run: `npm run typecheck && npx vitest --project jsdom run`
Expected: PASS — no existing test should be affected by an additive `window.api` field.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/renderer/vite-env.d.ts tests/renderer/test-utils.tsx
git commit -m "feat: add launchConfig preload bridge"
```

---

### Task 9: use-launch-configs hook

**Files:**
- Create: `src/renderer/hooks/use-launch-configs.ts`
- Test: `tests/renderer/hooks/use-launch-configs.test.tsx`

**Interfaces:**
- Consumes: `ProjectLaunchConfigs` (Task 1), `callIpc` (existing).
- Produces: `useLaunchConfigs()`, `useProjectLaunchConfigs(projectId)`, `launchConfigsQueryKey` — consumed by Task 12's `LaunchConfigsTreeGroup`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/hooks/use-launch-configs.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, makeTestQueryClient, type CallSpy } from '../test-utils.js';
import { useLaunchConfigs, useProjectLaunchConfigs } from '../../../src/renderer/hooks/use-launch-configs.js';
import type { ProjectLaunchConfigs } from '../../../src/shared/launch-config.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

describe('useLaunchConfigs', () => {
  it("lists every project's launch configs", async () => {
    const entries: ProjectLaunchConfigs[] = [{ projectId: 'p1', configs: [] }];
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok(entries) : ok(undefined)));
    const { result } = renderHook(() => useLaunchConfigs(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(entries));
  });
});

describe('useProjectLaunchConfigs', () => {
  it("returns the matching project's entry", async () => {
    const entries: ProjectLaunchConfigs[] = [
      { projectId: 'p1', configs: [] },
      { projectId: 'p2', configs: [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }] },
    ];
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok(entries) : ok(undefined)));
    const { result } = renderHook(() => useProjectLaunchConfigs('p2'), { wrapper });
    await waitFor(() => expect(result.current).toEqual(entries[1]));
  });

  it('returns undefined for a project with no entry yet', async () => {
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok([]) : ok(undefined)));
    const { result } = renderHook(() => useProjectLaunchConfigs('missing'), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.list', {}));
    expect(result.current).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/hooks/use-launch-configs.test.tsx`
Expected: FAIL — `use-launch-configs.js` does not exist yet.

- [ ] **Step 3: Write `src/renderer/hooks/use-launch-configs.ts`**

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { ProjectLaunchConfigs } from '../../shared/launch-config.js';

export const launchConfigsQueryKey = ['launchConfigs'] as const;

/** Every registered Project's launch.json configs, across the active workspace. */
export function useLaunchConfigs(): UseQueryResult<ProjectLaunchConfigs[]> {
  return useQuery<ProjectLaunchConfigs[]>({
    queryKey: launchConfigsQueryKey,
    queryFn: async () => {
      const list = await callIpc<ProjectLaunchConfigs[]>('launchConfig.list');
      return Array.isArray(list) ? list : [];
    },
  });
}

/** One Project's own launch configs, derived from the shared list query. */
export function useProjectLaunchConfigs(projectId: string): ProjectLaunchConfigs | undefined {
  const { data } = useLaunchConfigs();
  return data?.find((entry) => entry.projectId === projectId);
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run tests/renderer/hooks/use-launch-configs.test.tsx`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/renderer/hooks/use-launch-configs.ts tests/renderer/hooks/use-launch-configs.test.tsx
git commit -m "feat: add useLaunchConfigs/useProjectLaunchConfigs hooks"
```

---

### Task 10: launch-process-store + use-launch-process hooks

**Files:**
- Create: `src/renderer/lib/launch-process-store.ts`
- Test: `tests/renderer/lib/launch-process-store.test.ts`
- Create: `src/renderer/hooks/use-launch-process.ts`
- Test: `tests/renderer/hooks/use-launch-process.test.tsx`

**Interfaces:**
- Consumes: `LaunchProcessSnapshot` (Task 1), `window.api.launchConfig` (Task 8), `callIpc` (existing).
- Produces: `subscribeLaunchProcesses`, `getLaunchProcessesSnapshot`, `registerLaunchProcess`, `markLaunchProcessExited` (`launch-process-store.ts`); `useRunLaunchConfig()`, `useKillLaunchProcess()`, `useLaunchProcesses()`, `useLaunchProcessOutput(processId)` (`use-launch-process.ts`) — consumed by Task 12's `LaunchConfigsTreeGroup`, Task 13's `LaunchProcessPanel`, Task 14's `WorkspaceScreen` wiring.

There is no `launchConfig.listProcesses` IPC method (unlike sessions' `session.list`) — a launch process is a plain child process, not a first-class resource the main process enumerates for the renderer. `launch-process-store.ts` is therefore the renderer's own record of what has been run this session, mirroring `browser-tabs-store.ts`'s exact pattern (module-scoped state + `useSyncExternalStore`) for the same reason: something opened deep inside a tree row needs to be seen by a badge and a Workbench tab elsewhere, with no prop path connecting them.

- [ ] **Step 1: Write the failing test for the store**

Create `tests/renderer/lib/launch-process-store.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLaunchProcessesSnapshot,
  markLaunchProcessExited,
  registerLaunchProcess,
  resetLaunchProcessesForTests,
  subscribeLaunchProcesses,
} from '../../../src/renderer/lib/launch-process-store.js';

afterEach(() => {
  resetLaunchProcessesForTests();
});

describe('launch-process-store', () => {
  it('starts empty', () => {
    expect(getLaunchProcessesSnapshot()).toEqual({ processes: [] });
  });

  it('registerLaunchProcess records a process and notifies subscribers', () => {
    const listener = vi.fn();
    subscribeLaunchProcesses(listener);
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    expect(getLaunchProcessesSnapshot().processes).toEqual([
      { processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('registerLaunchProcess replaces an existing entry with the same processId instead of duplicating it', () => {
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    expect(getLaunchProcessesSnapshot().processes).toHaveLength(1);
  });

  it("markLaunchProcessExited updates the matching process's status and exitCode", () => {
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    markLaunchProcessExited('p1', 0);
    expect(getLaunchProcessesSnapshot().processes).toEqual([
      { processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'exited', exitCode: 0 },
    ]);
  });

  it('markLaunchProcessExited is a no-op for an unknown processId', () => {
    markLaunchProcessExited('unknown', 0);
    expect(getLaunchProcessesSnapshot().processes).toEqual([]);
  });

  it('unsubscribing stops further notifications', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLaunchProcesses(listener);
    unsubscribe();
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/lib/launch-process-store.test.ts`
Expected: FAIL — `launch-process-store.js` does not exist yet.

- [ ] **Step 3: Write `src/renderer/lib/launch-process-store.ts`**

```ts
import type { LaunchProcessSnapshot } from '../../shared/launch-config.js';

/**
 * Module-scoped, not React state — same reasoning as `browser-tabs-store.ts`:
 * a launch process is spawned from deep inside a `FolderTree`/pinnedRows row,
 * but its status badge and its own Workbench tab both need to see it too,
 * with no prop path connecting them. There is no `launchConfig.listProcesses`
 * IPC method (unlike sessions' `session.list`), so this store IS the
 * renderer's only record of what has been run this session — entries persist
 * (running or exited) for the renderer's lifetime, never refetched fresh from
 * the main process.
 */
export interface LaunchProcessesSnapshot {
  readonly processes: readonly LaunchProcessSnapshot[];
}

let processes: LaunchProcessSnapshot[] = [];
let snapshot: LaunchProcessesSnapshot = { processes };
const listeners = new Set<() => void>();

function notify(): void {
  snapshot = { processes };
  listeners.forEach((listener) => listener());
}

export function subscribeLaunchProcesses(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLaunchProcessesSnapshot(): LaunchProcessesSnapshot {
  return snapshot;
}

/** Records a freshly spawned process — called once `launchConfig.run` resolves. */
export function registerLaunchProcess(process: LaunchProcessSnapshot): void {
  processes = [...processes.filter((p) => p.processId !== process.processId), process];
  notify();
}

/** Updates a known process's status — called from the `launchProcess:exit` push-channel listener. */
export function markLaunchProcessExited(processId: string, exitCode: number | null): void {
  const idx = processes.findIndex((p) => p.processId === processId);
  if (idx === -1) return;
  processes = [...processes.slice(0, idx), { ...processes[idx]!, status: 'exited', exitCode }, ...processes.slice(idx + 1)];
  notify();
}

/** Test-only: clears the whole module-scoped singleton between test files. */
export function resetLaunchProcessesForTests(): void {
  processes = [];
  snapshot = { processes };
  listeners.clear();
}
```

- [ ] **Step 4: Run the store test again to confirm it passes**

Run: `npx vitest run tests/renderer/lib/launch-process-store.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Write the failing test for the hooks**

Create `tests/renderer/hooks/use-launch-process.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, makeTestQueryClient, type CallSpy } from '../test-utils.js';
import { resetLaunchProcessesForTests } from '../../../src/renderer/lib/launch-process-store.js';
import {
  useRunLaunchConfig,
  useKillLaunchProcess,
  useLaunchProcesses,
  useLaunchProcessOutput,
} from '../../../src/renderer/hooks/use-launch-process.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

afterEach(() => {
  resetLaunchProcessesForTests();
});

describe('useRunLaunchConfig', () => {
  it('calls launchConfig.run and records the result in the launch-process store', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.run' ? ok({ processId: 'x', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }) : ok(undefined),
    );
    const { result } = renderHook(() => useRunLaunchConfig(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'p1', configName: 'Run' });
    });
    expect(call).toHaveBeenCalledWith('launchConfig.run', { projectId: 'p1', configName: 'Run' });
  });
});

describe('useKillLaunchProcess', () => {
  it('calls launchConfig.kill with the processId', async () => {
    call.mockImplementation(async () => ok(undefined));
    const { result } = renderHook(() => useKillLaunchProcess(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('proc-1');
    });
    expect(call).toHaveBeenCalledWith('launchConfig.kill', { processId: 'proc-1' });
  });
});

describe('useLaunchProcesses', () => {
  it('reflects the store and updates when the exit push channel fires', async () => {
    const { result: runResult } = renderHook(() => useRunLaunchConfig(), { wrapper });
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.run' ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }) : ok(undefined),
    );
    await act(async () => {
      await runResult.current.mutateAsync({ projectId: 'p1', configName: 'Run' });
    });

    const { result } = renderHook(() => useLaunchProcesses(), { wrapper });
    expect(result.current).toEqual([{ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }]);

    const onAnyExitListener = vi.mocked(window.api.launchConfig.onAnyExit).mock.calls[0]![0];
    act(() => onAnyExitListener('proc-1', 0, null));
    await waitFor(() => expect(result.current[0]?.status).toBe('exited'));
  });
});

describe('useLaunchProcessOutput', () => {
  it('replays the captured buffer, then appends streamed output', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.status'
        ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null, outputBuffer: 'hello\n' })
        : ok(undefined),
    );
    const { result } = renderHook(() => useLaunchProcessOutput('proc-1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toEqual([{ stream: 'stdout', chunk: 'hello\n' }]));
    expect(result.current.status).toBe('running');

    const onOutputListener = vi.mocked(window.api.launchConfig.onOutput).mock.calls[0]![1];
    act(() => onOutputListener('stderr', 'more'));
    await waitFor(() =>
      expect(result.current.lines).toEqual([
        { stream: 'stdout', chunk: 'hello\n' },
        { stream: 'stderr', chunk: 'more' },
      ]),
    );
  });

  it('marks the process exited once its own exit push channel fires', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.status'
        ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null, outputBuffer: '' })
        : ok(undefined),
    );
    const { result } = renderHook(() => useLaunchProcessOutput('proc-1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('running'));

    const onExitListener = vi.mocked(window.api.launchConfig.onExit).mock.calls[0]![1];
    act(() => onExitListener(0, null));
    await waitFor(() => expect(result.current.status).toBe('exited'));
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/hooks/use-launch-process.test.tsx`
Expected: FAIL — `use-launch-process.js` does not exist yet.

- [ ] **Step 7: Write `src/renderer/hooks/use-launch-process.ts`**

```ts
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import {
  getLaunchProcessesSnapshot,
  markLaunchProcessExited,
  registerLaunchProcess,
  subscribeLaunchProcesses,
} from '../lib/launch-process-store.js';
import type { LaunchProcessSnapshot } from '../../shared/launch-config.js';

export function useRunLaunchConfig() {
  return useMutation({
    mutationFn: (args: { projectId: string; configName: string }) => callIpc<LaunchProcessSnapshot>('launchConfig.run', args),
    onSuccess: (snapshot) => registerLaunchProcess(snapshot),
  });
}

export function useKillLaunchProcess() {
  return useMutation({
    mutationFn: (processId: string) => callIpc<void>('launchConfig.kill', { processId }),
  });
}

/** Every launch process run this renderer session, running and exited alike — see `launch-process-store.ts` for why this isn't a `launchConfig.list`-backed query. */
export function useLaunchProcesses(): readonly LaunchProcessSnapshot[] {
  const { processes } = useSyncExternalStore(subscribeLaunchProcesses, getLaunchProcessesSnapshot);
  useEffect(() => {
    return window.api.launchConfig.onAnyExit((processId, exitCode) => {
      markLaunchProcessExited(processId, exitCode);
    });
  }, []);
  return processes;
}

interface LaunchProcessOutputLine {
  stream: 'stdout' | 'stderr';
  chunk: string;
}

/**
 * Live streamed output + terminal status for one launch process — replays
 * `launchConfig.status`'s captured buffer first, then appends whatever
 * streams in afterward over the push channel.
 */
export function useLaunchProcessOutput(processId: string): {
  lines: LaunchProcessOutputLine[];
  status: LaunchProcessSnapshot['status'] | undefined;
} {
  const [lines, setLines] = useState<LaunchProcessOutputLine[]>([]);
  const [status, setStatus] = useState<LaunchProcessSnapshot['status'] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLines([]);
    void callIpc<(LaunchProcessSnapshot & { outputBuffer: string }) | null>('launchConfig.status', { processId }).then(
      (snapshot) => {
        if (cancelled || !snapshot) return;
        setStatus(snapshot.status);
        if (snapshot.outputBuffer) setLines([{ stream: 'stdout', chunk: snapshot.outputBuffer }]);
      },
    );
    const unsubscribeOutput = window.api.launchConfig.onOutput(processId, (stream, chunk) => {
      setLines((prev) => [...prev, { stream, chunk }]);
    });
    const unsubscribeExit = window.api.launchConfig.onExit(processId, () => {
      setStatus('exited');
    });
    return () => {
      cancelled = true;
      unsubscribeOutput();
      unsubscribeExit();
    };
  }, [processId]);

  return { lines, status };
}
```

- [ ] **Step 8: Run the hook test again to confirm it passes**

Run: `npx vitest run tests/renderer/hooks/use-launch-process.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/renderer/lib/launch-process-store.ts src/renderer/hooks/use-launch-process.ts tests/renderer/lib/launch-process-store.test.ts tests/renderer/hooks/use-launch-process.test.tsx
git commit -m "feat: add launch-process-store and use-launch-process hooks"
```

---

### Task 11: LaunchProcessStatusBadge

**Files:**
- Create: `src/renderer/lib/launch-process-status-pill.ts`
- Create: `src/renderer/components/LaunchProcessStatusBadge.tsx`
- Test: `tests/renderer/components/LaunchProcessStatusBadge.test.tsx`

**Interfaces:**
- Consumes: `LaunchProcessStatus` (Task 1), `StatusPill`/`StatusPillVariant` (existing).
- Produces: `LAUNCH_PROCESS_STATUS_PILL`, `LaunchProcessStatusBadge` — consumed by Task 12's `LaunchConfigsTreeGroup`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/LaunchProcessStatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '../test-utils.js';
import { LaunchProcessStatusBadge } from '../../../src/renderer/components/LaunchProcessStatusBadge.js';

describe('LaunchProcessStatusBadge', () => {
  it('renders nothing when the process has never run', () => {
    const { container } = renderWithTheme(<LaunchProcessStatusBadge status={undefined} testId="p1-Run" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a running pill', () => {
    renderWithTheme(<LaunchProcessStatusBadge status="running" testId="p1-Run" />);
    expect(screen.getByTestId('status-pill-p1-Run')).toHaveTextContent('Rodando');
  });

  it('renders an exited pill', () => {
    renderWithTheme(<LaunchProcessStatusBadge status="exited" testId="p1-Run" />);
    expect(screen.getByTestId('status-pill-p1-Run')).toHaveTextContent('Encerrado');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/components/LaunchProcessStatusBadge.test.tsx`
Expected: FAIL — the component does not exist yet.

- [ ] **Step 3: Write `src/renderer/lib/launch-process-status-pill.ts`**

```ts
import type { LaunchProcessStatus } from '../../shared/launch-config.js';
import type { StatusPillVariant } from '../components/ds/StatusPill.js';

/** Mirrors SESSION_STATUS_PILL — launch processes share sessions' running/exited shape but are never Sessions themselves. */
export const LAUNCH_PROCESS_STATUS_PILL: Record<LaunchProcessStatus, { variant: StatusPillVariant; label: string }> = {
  running: { variant: 'running', label: 'Rodando' },
  exited: { variant: 'exited', label: 'Encerrado' },
};
```

- [ ] **Step 4: Write `src/renderer/components/LaunchProcessStatusBadge.tsx`**

```tsx
import { LAUNCH_PROCESS_STATUS_PILL } from '../lib/launch-process-status-pill.js';
import { StatusPill } from './ds/StatusPill.js';
import type { LaunchProcessStatus } from '../../shared/launch-config.js';

interface LaunchProcessStatusBadgeProps {
  status: LaunchProcessStatus | undefined;
  testId: string;
}

/** A running/exited pill for one launch config's row — renders nothing until it has been run at least once. */
export function LaunchProcessStatusBadge({ status, testId }: LaunchProcessStatusBadgeProps): React.ReactElement | null {
  if (!status) return null;
  const pill = LAUNCH_PROCESS_STATUS_PILL[status];
  return <StatusPill variant={pill.variant} label={pill.label} testId={testId} />;
}
```

- [ ] **Step 5: Run the test again to confirm it passes**

Run: `npx vitest run tests/renderer/components/LaunchProcessStatusBadge.test.tsx`
Expected: PASS (all 3 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/renderer/lib/launch-process-status-pill.ts src/renderer/components/LaunchProcessStatusBadge.tsx tests/renderer/components/LaunchProcessStatusBadge.test.tsx
git commit -m "feat: add LaunchProcessStatusBadge"
```

---

### Task 12: TreeGroup depth/disabled + LaunchConfigsTreeGroup

**Files:**
- Modify: `src/renderer/components/ds/TreeRow.tsx`
- Modify: `src/renderer/components/workspace/TreeGroup.tsx`
- Create: `src/renderer/components/workspace/LaunchConfigsTreeGroup.tsx`
- Test: `tests/renderer/components/workspace/LaunchConfigsTreeGroup.test.tsx`

**Interfaces:**
- Consumes: `useProjectLaunchConfigs` (Task 9), `useRunLaunchConfig`/`useKillLaunchProcess`/`useLaunchProcesses` (Task 10), `LaunchProcessStatusBadge` (Task 11), `useRevealPath` (existing), `TreeGroup`/`TreeGroupRow` (this task's own extension), `RowContextMenu`/`useRowContextMenu` (existing).
- Produces: `LaunchConfigsTreeGroup` — consumed by Task 14's `WorkspaceScreen` wiring (both nested, via `renderProjectLaunchConfigsRow`, and pinned once for the root Project).

`TreeGroup`/`TreeGroupRow` gain two purely-additive, backward-compatible props (`depth?: number`, and `disabled?: boolean` on `TreeGroupRow`/`TreeRow`) — every existing caller (`EntityTreeGroup`, `McpTreeGroup`, `HooksTreeGroup`, `PluginsTreeGroup`) omits both and keeps its exact current `pl`/enabled behavior, since both default to their current hardcoded values. There is no dedicated `TreeGroup.test.tsx` today (it's exercised only through its consumers) — this task's own `LaunchConfigsTreeGroup.test.tsx` is what exercises the new props.

- [ ] **Step 1: Add `disabled` to `TreeRow`**

In `src/renderer/components/ds/TreeRow.tsx`, add to `TreeRowProps`:

```ts
  disabled?: boolean;
```

Destructure it in `TreeRow`'s parameters and pass it to `ListItemButton`:

```tsx
export function TreeRow({
  testId, pl, chevron, glyph, primary, badge, accentColor, onClick, onContextMenu, actions, actionsVisibility = 'hover', muted, disabled,
}: TreeRowProps): React.ReactElement {
  return (
    <ListItemButton
      dense
      disabled={disabled}
      {...(testId ? { 'data-testid': testId } : {})}
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={{ pl, opacity: muted ? 0.65 : 1, position: 'relative', '&:hover .tree-row-actions, &:focus-within .tree-row-actions': { opacity: 1 } }}
    >
```

- [ ] **Step 2: Add `depth` (to both `TreeGroup` and `TreeGroupRow`) and `disabled` (to `TreeGroupRow`) in `src/renderer/components/workspace/TreeGroup.tsx`**

In `TreeGroupProps`, add:

```ts
  /** Tree nesting level, matching FolderTree's `TreeNode` indent formula (`pl: 1.5 + depth * 2`) — for a group pinned inside a folder node rather than at the tree's own top level. Defaults to `0` (today's `pl: 1.5`). */
  depth?: number;
```

In `TreeGroup`'s body, compute `const pl = 1.5 + depth * 2;` (with `depth = 0` destructured as a default) and use `pl` everywhere the function currently hardcodes `1.5` (the `TreeRow`'s own `pl` prop, and the empty-state `Typography`'s `pl: 1.5 + 14 / 8 + 2` becomes `pl: pl + 14 / 8 + 2`).

In `TreeGroupRowProps`, add:

```ts
  disabled?: boolean;
  /** See `TreeGroup`'s own `depth`. Defaults to `0`. */
  depth?: number;
```

In `TreeGroupRow`'s body, destructure both with `depth = 0` defaulted, change its `TreeRow`'s `pl` from the hardcoded `1.5 + 2.5` to `1.5 + 2.5 + depth * 2`, and thread `disabled` through:

```tsx
export function TreeGroupRow({ testId, glyph, primary, badge, onClick, onContextMenu, actions, muted, accentColor, disabled, depth = 0 }: TreeGroupRowProps): React.ReactElement {
  return (
    <TreeRow
      testId={testId}
      pl={1.5 + 2.5 + depth * 2}
      glyph={glyph}
      primary={primary}
      badge={badge}
      actions={actions}
      {...(accentColor !== undefined ? { accentColor } : {})}
      {...(onClick ? { onClick } : {})}
      {...(onContextMenu ? { onContextMenu } : {})}
      {...(muted !== undefined ? { muted } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  );
}
```

- [ ] **Step 3: Run the existing consumer tests to confirm the additive change is backward-compatible**

Run: `npx vitest run tests/renderer/components/workspace/EntityTreeGroup.test.tsx tests/renderer/components/workspace/SessionsTreeGroup.test.tsx tests/renderer/components/workspace/McpTreeGroup.test.tsx tests/renderer/components/workspace/HooksTreeGroup.test.tsx tests/renderer/components/workspace/PluginsTreeGroup.test.tsx`
Expected: PASS, unchanged — confirms `depth`/`disabled` defaulting preserves every existing caller's layout exactly.

- [ ] **Step 4: Write the failing test for `LaunchConfigsTreeGroup`**

Create `tests/renderer/components/workspace/LaunchConfigsTreeGroup.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LaunchConfigsTreeGroup } from '../../../../src/renderer/components/workspace/LaunchConfigsTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { resetLaunchProcessesForTests } from '../../../../src/renderer/lib/launch-process-store.js';
import type { Project } from '../../../../src/shared/project.js';

const project: Project = { id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '' };

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  resetLaunchProcessesForTests();
});

describe('LaunchConfigsTreeGroup', () => {
  it('renders nothing for a project with no launch.json and no error', async () => {
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok([{ projectId: 'p1', configs: [] }]) : ok(undefined)));
    const { container } = renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={vi.fn()} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.list', {}));
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a supported config as a clickable row and an unsupported one as disabled', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.list'
        ? ok([{
            projectId: 'p1',
            configs: [
              { name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true },
              { name: 'Debug in Chrome', type: 'chrome', request: 'launch', program: 'index.html', args: [], supported: false },
            ],
          }])
        : ok(undefined),
    );
    const user = userEvent.setup();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    expect(await screen.findByTestId('tree-launch-config-acme-Run server')).not.toHaveAttribute('aria-disabled', 'true');
    const unsupportedRow = await screen.findByTestId('tree-launch-config-acme-Debug in Chrome');
    expect(unsupportedRow.closest('.MuiButtonBase-root')).toHaveAttribute('aria-disabled', 'true');
  });

  it('running a supported config calls launchConfig.run and opens it via onOpenProcess', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'launchConfig.list') {
        return ok([{ projectId: 'p1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] }]);
      }
      if (method === 'launchConfig.run') {
        return ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run server', status: 'running', exitCode: null });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    const onOpenProcess = vi.fn();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={onOpenProcess} onEditLaunchJson={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    await user.click(await screen.findByTestId('tree-launch-config-acme-Run server'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.run', { projectId: 'p1', configName: 'Run server' }));
    await waitFor(() => expect(onOpenProcess).toHaveBeenCalledWith(expect.objectContaining({ processId: 'proc-1' })));
  });

  it('shows the reader error instead of an empty-state message when launch.json is malformed', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.list' ? ok([{ projectId: 'p1', configs: [], error: 'malformed launch.json' }]) : ok(undefined),
    );
    const user = userEvent.setup();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    expect(await screen.findByTestId('launch-configs-error-acme')).toHaveTextContent('malformed launch.json');
  });

  it('right-clicking a row opens "Edit launch.json" / "Reveal in Finder" for the project', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.list'
        ? ok([{ projectId: 'p1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] }])
        : ok(undefined),
    );
    const user = userEvent.setup();
    const onEditLaunchJson = vi.fn();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={onEditLaunchJson} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    const row = await screen.findByTestId('tree-launch-config-acme-Run server');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await user.click(await screen.findByTestId('row-context-menu-edit-launch-json'));
    expect(onEditLaunchJson).toHaveBeenCalledWith(project);
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/components/workspace/LaunchConfigsTreeGroup.test.tsx`
Expected: FAIL — the component does not exist yet.

- [ ] **Step 6: Write `src/renderer/components/workspace/LaunchConfigsTreeGroup.tsx`**

```tsx
import { useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { FolderSearch, NotebookPen, Play, Square } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { TreeGroup, TreeGroupRow } from './TreeGroup.js';
import { RowContextMenu, useRowContextMenu, type RowContextMenuAction } from './RowContextMenu.js';
import { LaunchProcessStatusBadge } from '../LaunchProcessStatusBadge.js';
import { useProjectLaunchConfigs } from '../../hooks/use-launch-configs.js';
import { useRunLaunchConfig, useKillLaunchProcess, useLaunchProcesses } from '../../hooks/use-launch-process.js';
import { useRevealPath } from '../../hooks/use-open-with.js';
import { IpcCallError } from '../../lib/ipc.js';
import type { LaunchProcessSnapshot } from '../../../shared/launch-config.js';
import type { Project } from '../../../shared/project.js';

const LAUNCH_JSON_REL_PATH = '.vscode/launch.json';

interface LaunchConfigsTreeGroupProps {
  project: Project;
  /** See `TreeGroup`'s own `depth` — omitted (0) for the workspace-root's pinned copy, `depth+1` when nested under a matched child Project's own folder. */
  depth?: number;
  onOpenProcess: (process: LaunchProcessSnapshot) => void;
  onEditLaunchJson: (project: Project) => void;
}

/**
 * One Project's own "Launch Configurations" group — used both nested under
 * its matched folder in `FolderTree` (via `renderProjectLaunchConfigsRow`)
 * and, for the workspace-root Project, pinned once at the top via
 * `FolderTree`'s `pinnedRows` slot (see the design spec's §3.9 for why the
 * root case can't reuse the nested call site without duplicating).
 */
export function LaunchConfigsTreeGroup({ project, depth = 0, onOpenProcess, onEditLaunchJson }: LaunchConfigsTreeGroupProps): React.ReactElement | null {
  const entry = useProjectLaunchConfigs(project.id);
  const processes = useLaunchProcesses();
  const runConfig = useRunLaunchConfig();
  const killProcess = useKillLaunchProcess();
  const revealPath = useRevealPath();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const rowMenu = useRowContextMenu<Project>();

  if (!entry || (entry.configs.length === 0 && entry.error === undefined)) return null;

  const rowMenuActions: RowContextMenuAction[] = rowMenu.state
    ? [
        { key: 'edit-launch-json', label: 'Edit launch.json', glyph: NotebookPen, onSelect: () => onEditLaunchJson(project) },
        {
          key: 'reveal',
          label: 'Reveal in Finder',
          glyph: FolderSearch,
          onSelect: () => {
            revealPath
              .mutateAsync({ relPath: LAUNCH_JSON_REL_PATH, kind: 'file', projectId: project.id })
              .catch((err: unknown) => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) }));
          },
        },
      ]
    : [];

  const latestProcessFor = (configName: string): LaunchProcessSnapshot | undefined => {
    const matches = processes.filter((p) => p.projectId === project.id && p.configName === configName);
    return matches[matches.length - 1];
  };

  return (
    <>
      <TreeGroup
        testId={`launch-configs-${project.name}`}
        glyph={Play}
        label="Launch Configurations"
        depth={depth}
        {...(entry.error === undefined ? { count: entry.configs.length } : {})}
      >
        {entry.error ? (
          <Box sx={{ px: 1.5, py: 0.75, fontSize: '0.75rem', opacity: 0.75 }} data-testid={`launch-configs-error-${project.name}`}>
            {entry.error}
          </Box>
        ) : (
          entry.configs.map((config) => {
            const process = latestProcessFor(config.name);
            const running = process?.status === 'running';
            const row = (
              <TreeGroupRow
                key={config.name}
                testId={`tree-launch-config-${project.name}-${config.name}`}
                glyph={Play}
                primary={config.name}
                muted={!config.supported}
                depth={depth}
                onContextMenu={(e) => rowMenu.openMenu(e, project)}
                {...(config.supported
                  ? {
                      onClick: () => {
                        if (running && process) {
                          onOpenProcess(process);
                        } else {
                          runConfig.mutate({ projectId: project.id, configName: config.name }, { onSuccess: onOpenProcess });
                        }
                      },
                    }
                  : { disabled: true })}
                badge={<LaunchProcessStatusBadge status={process?.status} testId={`${project.name}-${config.name}`} />}
                actions={
                  running && process ? (
                    <Tooltip title="Parar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Parar ${config.name}`}
                        data-testid={`tree-launch-config-stop-${project.name}-${config.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          killProcess.mutate(process.processId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          killProcess.mutate(process.processId);
                        }}
                        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                      >
                        <Icon glyph={Square} size={13} />
                      </Box>
                    </Tooltip>
                  ) : undefined
                }
              />
            );
            return config.supported ? (
              row
            ) : (
              <Tooltip key={config.name} title={`Tipo '${config.type}'/request '${config.request}' não suportado — só node/launch pode ser executado`}>
                <span>{row}</span>
              </Tooltip>
            );
          })
        )}
      </TreeGroup>
      <RowContextMenu state={rowMenu.state} onClose={rowMenu.closeMenu} actions={rowMenuActions} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
```

- [ ] **Step 7: Run the test again to confirm it passes**

Run: `npx vitest run tests/renderer/components/workspace/LaunchConfigsTreeGroup.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 8: Typecheck, lint, and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add src/renderer/components/ds/TreeRow.tsx src/renderer/components/workspace/TreeGroup.tsx src/renderer/components/workspace/LaunchConfigsTreeGroup.tsx tests/renderer/components/workspace/LaunchConfigsTreeGroup.test.tsx
git commit -m "feat: add LaunchConfigsTreeGroup and depth/disabled support to TreeGroup"
```

---

### Task 13: LaunchProcessPanel (read-only terminal)

**Files:**
- Create: `src/renderer/components/workspace/LaunchProcessPanel.tsx`
- Test: `tests/renderer/components/workspace/LaunchProcessPanel.test.tsx`

**Interfaces:**
- Consumes: `useLaunchProcessOutput` (Task 10).
- Produces: `LaunchProcessPanel` — consumed by Task 14's `WorkspaceScreen` `canvasTabs` 'launch-process' case.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/workspace/LaunchProcessPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../../test-utils.js';
import { LaunchProcessPanel } from '../../../../src/renderer/components/workspace/LaunchProcessPanel.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) =>
    method === 'launchConfig.status'
      ? ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null, outputBuffer: 'hello\n' })
      : ok(undefined),
  );
});

describe('LaunchProcessPanel', () => {
  it('mounts a terminal container for the given processId and replays its output buffer', async () => {
    renderWithQuery(<LaunchProcessPanel processId="proc-1" />);
    expect(await screen.findByTestId('launch-process-panel-proc-1')).toBeInTheDocument();
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.status', { processId: 'proc-1' }));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/components/workspace/LaunchProcessPanel.test.tsx`
Expected: FAIL — the component does not exist yet.

- [ ] **Step 3: Write `src/renderer/components/workspace/LaunchProcessPanel.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useLaunchProcessOutput } from '../../hooks/use-launch-process.js';

const TERMINAL_XTERM_THEME = { background: '#fdf6e3', foreground: '#586e75' };

interface LaunchProcessPanelProps {
  processId: string;
  /** Skips resize/fit while the tab is hidden — mirrors SessionPanel's own `visible` handling. */
  visible?: boolean;
}

/** One-directional (process → panel) read-only terminal view for a launched config's stdout/stderr — no write/resize-to-process plumbing, unlike SessionPanel's PTY. */
export function LaunchProcessPanel({ processId, visible = true }: LaunchProcessPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenLineCount = useRef(0);
  const { lines } = useLaunchProcessOutput(processId);

  useEffect(() => {
    const terminal = new Terminal({ convertEol: true, fontSize: 13, theme: TERMINAL_XTERM_THEME, disableStdin: true });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    if (containerRef.current) terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    return () => {
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    for (const line of lines.slice(writtenLineCount.current)) {
      terminalRef.current?.write(line.chunk);
    }
    writtenLineCount.current = lines.length;
  }, [lines]);

  useEffect(() => {
    const syncSize = (): void => {
      if (!visible) return;
      fitAddonRef.current?.fit();
    };
    syncSize();
    window.addEventListener('resize', syncSize);
    const resizeObserver = new ResizeObserver(syncSize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', syncSize);
      resizeObserver.disconnect();
    };
  }, [visible]);

  return <Box ref={containerRef} data-testid={`launch-process-panel-${processId}`} sx={{ height: '100%', width: '100%' }} />;
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run tests/renderer/components/workspace/LaunchProcessPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/renderer/components/workspace/LaunchProcessPanel.tsx tests/renderer/components/workspace/LaunchProcessPanel.test.tsx
git commit -m "feat: add read-only LaunchProcessPanel"
```

---

### Task 14: FolderTree — renderProjectLaunchConfigsRow

**Files:**
- Modify: `src/renderer/components/workspace/FolderTree.tsx`
- Modify: `tests/renderer/components/workspace/FolderTree.test.tsx`

**Interfaces:**
- Produces: `FolderTreeProps.renderProjectLaunchConfigsRow?: (project: Project, depth: number) => React.ReactNode` — consumed by Task 15's `WorkspaceScreen`/`ExplorerPanelContent` wiring.

- [ ] **Step 1: Write the failing tests**

In `tests/renderer/components/workspace/FolderTree.test.tsx`, add `renderProjectLaunchConfigsRow?: (project: Project, depth: number) => React.ReactNode;` to `RenderTreeOptions` and thread it through `renderTree`'s `<FolderTree>` call exactly like `renderProjectInstructionRow`:

```tsx
          {...(opts.renderProjectLaunchConfigsRow !== undefined ? { renderProjectLaunchConfigsRow: opts.renderProjectLaunchConfigsRow } : {})}
```

Add two tests, right after the existing `renderProjectInstructionRow` tests (around line 366):

```tsx
  it("renders renderProjectLaunchConfigsRow pinned above a Project folder's own children, right after renderProjectInstructionRow", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const renderProjectInstructionRow = vi.fn((project: Project) => {
      calls.push('instructions');
      return <div data-testid={`instructions-${project.name}`} />;
    });
    const renderProjectLaunchConfigsRow = vi.fn((project: Project) => {
      calls.push('launch-configs');
      return <div data-testid={`launch-configs-${project.name}`} />;
    });
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'apps', kind: 'dir' }];
      }
      return [];
    });
    renderTree({
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      renderProjectInstructionRow,
      renderProjectLaunchConfigsRow,
    });
    await user.click(await screen.findByText('apps'));
    expect(await screen.findByTestId('launch-configs-apps')).toBeInTheDocument();
    expect(calls).toEqual(['instructions', 'launch-configs']);
    expect(renderProjectLaunchConfigsRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'apps' }), 1);
  });

  it('does not call renderProjectLaunchConfigsRow for a root-level folder that is not a registered Project', async () => {
    const renderProjectLaunchConfigsRow = vi.fn(() => <div data-testid="never-rendered" />);
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path?: string } | undefined)?.path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'plain', kind: 'dir' }];
      return [];
    });
    renderTree({ renderProjectLaunchConfigsRow });
    expect(screen.queryByTestId('never-rendered')).not.toBeInTheDocument();
    expect(renderProjectLaunchConfigsRow).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/components/workspace/FolderTree.test.tsx`
Expected: FAIL on the two new tests — the prop doesn't exist yet.

- [ ] **Step 3: Add the prop to `src/renderer/components/workspace/FolderTree.tsx`**

Add to `FolderTreeProps`, right after `renderProjectInstructionRow`:

```ts
  /**
   * Renders a Project's own LAUNCH CONFIGURATIONS group pinned above its
   * children once its folder node is expanded in place — gated on
   * `matchedProject` only, never the workspace-root's own `rootProject`
   * fallback (unlike this file's `effectiveProjectId`), since `rootProject`
   * is recomputed identically for every depth-0 entry and would render this
   * group once per expanded top-level folder instead of once. The
   * workspace-root case is handled separately, via `pinnedRows`. `depth`
   * matches `renderProjectInstructionRow`'s own formula.
   */
  renderProjectLaunchConfigsRow?: (project: Project, depth: number) => React.ReactNode;
```

Add the same field to `TreeNodeProps`, and destructure it in `TreeNode`'s parameters.

In `TreeNode`'s render, right after the existing `renderProjectInstructionRow` block, add:

```tsx
              {matchedProject && renderProjectLaunchConfigsRow
                ? renderProjectLaunchConfigsRow(matchedProject, depth + 1)
                : null}
```

Thread `renderProjectLaunchConfigsRow` through the recursive `<TreeNode>`'s conditional spread, exactly like `renderProjectInstructionRow`:

```tsx
                  {...(renderProjectLaunchConfigsRow !== undefined ? { renderProjectLaunchConfigsRow } : {})}
```

Finally, add the prop to `FolderTree`'s own parameter destructuring and to its top-level `<TreeNode>` mapping's conditional spread, mirroring `renderProjectInstructionRow` in both places.

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run tests/renderer/components/workspace/FolderTree.test.tsx`
Expected: PASS (every test in the file, including the two new ones).

- [ ] **Step 5: Typecheck, lint, and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add src/renderer/components/workspace/FolderTree.tsx tests/renderer/components/workspace/FolderTree.test.tsx
git commit -m "feat: add renderProjectLaunchConfigsRow extension point to FolderTree"
```

---

### Task 15: WorkspaceScreen + ExplorerPanelContent integration

**Files:**
- Modify: `src/renderer/components/workspace/ExplorerPanelContent.tsx`
- Modify: `src/renderer/screens/workspace/WorkspaceScreen.tsx`
- Modify: `tests/renderer/screens/workspace/WorkspaceScreen.test.tsx`

**Interfaces:**
- Consumes: `LaunchConfigsTreeGroup` (Task 12), `LaunchProcessPanel` (Task 13), `renderProjectLaunchConfigsRow`/`pinnedRows` (Task 14 / existing `FolderTree`), `useLaunchProcesses` (Task 10).
- Produces: the finished, user-reachable feature — every earlier task's contract terminates here.

This is the end-to-end integration: a new `OpenTab` kind, the `canvasTabs` render case for it, `renderProjectLaunchConfigsRow`'s real implementation, and the workspace-root Project's own group pinned once via `pinnedRows` (fixing the duplication risk found during spec validation — see the spec's §3.9).

- [ ] **Step 1: Thread `pinnedRows` through `ExplorerPanelContent`**

In `src/renderer/components/workspace/ExplorerPanelContent.tsx`, add to `ExplorerPanelContentProps`:

```ts
  /** Content pinned below `instructionRow` and above the folders/files for the active (non-Default) workspace — e.g. the workspace-root Project's own Launch Configurations group. */
  pinnedRows?: React.ReactNode;
```

Destructure it and pass it to the `<FolderTree>` call:

```tsx
          <FolderTree
            onSelectFile={onSelectFile}
            onUseAsProject={onUseAsProject}
            onPreviewFile={onPreviewFile}
            onNewAction={onNewAction}
            projects={projects}
            instructionRow={instructionRow}
            {...(pinnedRows !== undefined ? { pinnedRows } : {})}
            renderProjectInstructionRow={renderProjectInstructionRow}
            {...(renderProjectLaunchConfigsRow !== undefined ? { renderProjectLaunchConfigsRow } : {})}
            {...(workspaceRootPath ? { workspaceRootPath } : {})}
          />
```

(Add `renderProjectLaunchConfigsRow?: (project: Project, depth: number) => React.ReactNode;` to `ExplorerPanelContentProps` too, and destructure it, mirroring `renderProjectInstructionRow` exactly.)

- [ ] **Step 2: Write the failing tests in `WorkspaceScreen.test.tsx`**

Add a new `describe` block, after the `'folder tree — workspace root registered as its own Project'` block:

```tsx
  describe('Launch Configurations', () => {
    it("shows the root Project's own Launch Configurations group pinned once; running a config opens a Workbench tab", async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'launchConfig.list') {
          return [{ projectId: 'p1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] }];
        }
        if (method === 'launchConfig.run') {
          return { processId: 'proc-1', projectId: 'p1', configName: 'Run server', status: 'running', exitCode: null };
        }
        if (method === 'launchConfig.status') {
          return { processId: 'proc-1', projectId: 'p1', configName: 'Run server', status: 'running', exitCode: null, outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
      await user.click(await screen.findByTestId('tree-launch-config-acme-Run server'));
      expect(await screen.findByTestId('workbench-tab-launch-process:proc-1')).toBeInTheDocument();
      expect(ipc.callIpc).toHaveBeenCalledWith('launchConfig.run', { projectId: 'p1', configName: 'Run server' });
    });

    it("does not duplicate the root Project's Launch Configurations group across several expanded top-level folders", async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }, { name: 'libs', kind: 'dir' }];
        }
        if (method === 'launchConfig.list') {
          return [{ projectId: 'p1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] }];
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByText('apps'));
      await user.click(await screen.findByText('libs'));
      expect(screen.getAllByTestId('tree-group-launch-configs-acme')).toHaveLength(1);
    });

    it("closing a launch-process tab removes it from the Workbench", async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'launchConfig.list') {
          return [{ projectId: 'p1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] }];
        }
        if (method === 'launchConfig.run') {
          return { processId: 'proc-1', projectId: 'p1', configName: 'Run server', status: 'running', exitCode: null };
        }
        if (method === 'launchConfig.status') {
          return { processId: 'proc-1', projectId: 'p1', configName: 'Run server', status: 'exited', exitCode: 0, outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
      await user.click(await screen.findByTestId('tree-launch-config-acme-Run server'));
      expect(await screen.findByTestId('workbench-tab-launch-process:proc-1')).toBeInTheDocument();
      await user.click(screen.getByTestId('workbench-tab-close-launch-process:proc-1'));
      expect(screen.queryByTestId('workbench-tab-launch-process:proc-1')).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run tests/renderer/screens/workspace/WorkspaceScreen.test.tsx`
Expected: FAIL on the three new tests — nothing wires `launchConfig.list` into the tree yet.

- [ ] **Step 4: Wire `src/renderer/screens/workspace/WorkspaceScreen.tsx`**

Add imports:

```ts
import { Play } from 'lucide-react'; // add to the existing lucide-react import line
import { LaunchConfigsTreeGroup } from '../../components/workspace/LaunchConfigsTreeGroup.js';
import { LaunchProcessPanel } from '../../components/workspace/LaunchProcessPanel.js';
import { useLaunchProcesses } from '../../hooks/use-launch-process.js';
import type { LaunchProcessSnapshot } from '../../../shared/launch-config.js';
```

Add `'launch-process'` to the `OpenTab` union:

```ts
  | { id: string; kind: 'launch-process'; processId: string; label: string }
```

Add `const { data: launchProcesses } = ...` — actually `useLaunchProcesses()` returns the array directly (not a query result), so:

```ts
  const launchProcesses = useLaunchProcesses();
```

right beside the existing `const { data: sessions } = useSessions();`.

Add `openLaunchProcessTab`, beside `openSessionTab`:

```ts
  const openLaunchProcessTab = (process: LaunchProcessSnapshot): void => {
    const id = `launch-process:${process.processId}`;
    setOpenTabs((prev) =>
      prev.some((t) => t.id === id) ? prev : [...prev, { id, kind: 'launch-process', processId: process.processId, label: process.configName }],
    );
    setActiveTabId(id);
  };
```

Add `onEditLaunchJson`, beside the other `open*Tab` helpers:

```ts
  const onEditLaunchJson = (project: Project): void => openFileTab('.vscode/launch.json', project.id);
```

In `canvasTabs`'s `.map`, add a case for `'launch-process'` (placed anywhere among the other `if (tab.kind === ...)` branches, e.g. right after the `'session'` case):

```tsx
    if (tab.kind === 'launch-process') {
      const running = launchProcesses.some((p) => p.processId === tab.processId && p.status === 'running');
      return {
        id: tab.id,
        glyph: Play,
        label: tab.label,
        closeLabel: running ? 'Minimizar' : 'Fechar',
        dense: true,
        onClose: () => closeTab(tab.id),
        render: (hidden) => <LaunchProcessPanel processId={tab.processId} visible={!hidden} />,
      };
    }
```

Add `renderProjectLaunchConfigsRow`, right after `renderProjectInstructionRow`'s own definition:

```tsx
  const renderProjectLaunchConfigsRow = (project: Project, depth: number): React.ReactNode => (
    <LaunchConfigsTreeGroup project={project} depth={depth} onOpenProcess={openLaunchProcessTab} onEditLaunchJson={onEditLaunchJson} />
  );
```

Compute the workspace-root Project's own pinned row, right before the final `return (...)`:

```tsx
  const rootProject = activeWorkspace ? projects.find((p) => p.path === activeWorkspace.rootPath) : undefined;
  const pinnedRows = rootProject ? (
    <LaunchConfigsTreeGroup project={rootProject} onOpenProcess={openLaunchProcessTab} onEditLaunchJson={onEditLaunchJson} />
  ) : undefined;
```

Pass both new props into the `<ExplorerPanelContent>` call:

```tsx
              renderProjectInstructionRow={renderProjectInstructionRow}
              renderProjectLaunchConfigsRow={renderProjectLaunchConfigsRow}
              {...(pinnedRows !== undefined ? { pinnedRows } : {})}
```

- [ ] **Step 5: Run the new tests to confirm they pass**

Run: `npx vitest run tests/renderer/screens/workspace/WorkspaceScreen.test.tsx -t "Launch Configurations"`
Expected: PASS (all 3 new tests).

- [ ] **Step 6: Run the whole `WorkspaceScreen.test.tsx` file to catch incidental breakage**

Run: `npx vitest run tests/renderer/screens/workspace/WorkspaceScreen.test.tsx`
Expected: PASS, unchanged, for every pre-existing test. The default `beforeEach` mock returns `undefined` for `launchConfig.list`, which `useLaunchConfigs` already coerces to `[]` — no other test should need a new mock branch. If any pre-existing test asserts an exact `callIpc` call count or a fully-enumerated call list, add `if (method === 'launchConfig.list') return [];` to that specific test's own mock (do not touch the shared top-level `beforeEach` default beyond what's already there).

- [ ] **Step 7: Run the full test suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green — this is the release gate (CLAUDE.md: "green lint + typecheck + tests are a release gate").

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`, open (or create) a workspace whose root has a `.vscode/launch.json` with a `type: "node"`, `request: "launch"` entry, confirm the "Launch Configurations" group appears, running it opens a tab with live output, and stopping it updates the badge.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/workspace/ExplorerPanelContent.tsx src/renderer/screens/workspace/WorkspaceScreen.tsx tests/renderer/screens/workspace/WorkspaceScreen.test.tsx
git commit -m "feat: integrate Launch Configurations into WorkspaceScreen"
```

---

## Self-review notes

- **Spec coverage:** §3.1 shared types → Task 1. §3.2 domain → Task 1. §3.3 ports → Tasks 2/3. §3.4 infrastructure → Tasks 2/3. §3.5 services → Tasks 4/5. §3.6 IPC → Task 6. §3.7 composition root → Task 7. §3.8 preload → Task 8. §3.9 renderer (FolderTree prop, WorkspaceScreen wiring, OpenTab kind, testids, the two validation-time fixes) → Tasks 9–15. §4 testing → each task's own Test file. §5 out-of-scope (`tasks.json`, non-`node` types, extra variables, compounds) → deliberately not built anywhere above.
- **Type consistency:** `LaunchConfig`/`ProjectLaunchConfigs`/`LaunchProcessSnapshot`/`LaunchProcessSnapshotWithOutput` (Task 1) are the same shapes used verbatim through the reader (Task 2), the services (Tasks 4–5), the IPC handlers (Task 6), the preload bridge (Task 8), and every renderer hook/component (Tasks 9–15) — no renaming drift between layers.
- **Review Focus:** all five items each have an owning task's test, as listed in that section above.
