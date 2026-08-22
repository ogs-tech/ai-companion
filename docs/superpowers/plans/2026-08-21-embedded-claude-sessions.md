# Embedded Claude Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the author launch and interact with a real, interactive `claude` CLI session — anchored to a specific Skill, Agent, or Instruction entity — from inside AI Companion's own editor screens, instead of alt-tabbing to a terminal.

**Architecture:** A new `session` bounded context, hexagonally layered exactly like the existing `entity` context: a `ClaudeSessionPort` (spawn/write/resize/kill a PTY) implemented by a `node-pty`-backed adapter; a `SessionService` that owns the one-live-session-per-entity invariant and resolves each session's working directory from the entity itself; a `session.*` IPC namespace over the existing request/response envelope; and a new main→renderer push channel (`session:output` / `session:exit`) for streamed terminal output, since request/response can't carry a continuous PTY stream. The renderer gets a `SessionPanel` component (`@xterm/xterm` + `@xterm/addon-fit`) embedded inside `CustomizationEditor`.

**Tech Stack:** Electron 41 (main/preload/renderer via `electron-vite`), TypeScript (strict), `node-pty` (new native dependency — first one in this codebase), `@xterm/xterm` + `@xterm/addon-fit` (renderer terminal, pure JS), Vitest 4 (node + jsdom projects), React 19 + MUI.

**Spec:** [`docs/superpowers/specs/2026-08-21-embedded-claude-sessions-design.md`](../specs/2026-08-21-embedded-claude-sessions-design.md)

## Global Constraints

- The embedded PTY only ever runs `claude` (interactively) — never a general shell. No git/npm/arbitrary command support (spec §2.1).
- A session is anchored to a single customization entity (Skill, Agent, or Instruction — all kinds, uniformly) keyed by its `urn`, not to a "project" registry (spec §2.2).
- Working directory: `ProjectInstruction` → its own `repoPath`; every other entity (`Skill`, `Agent`, `PersonalInstruction`) → the app's workspace root (spec §2.3).
- No background daemon. All live sessions are SIGTERM'd on `before-quit` (spec §2.4).
- One live session per entity — reopening an entity that already has a live session reconnects to it instead of spawning a second PTY (spec §2.5).
- Output delivery is a main→renderer push channel (`session:output` / `session:exit`), never polling over `ipc:call` (spec §2.6).
- `Session` is ephemeral process state, not a fourth `Entity` kind — it does not go through `EntityService`/`EntityRepository` (spec §2.7).
- Imports use `.js` extensions on relative paths (ESM + `verbatimModuleSyntax`). Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are on.
- Services depend on ports only, never on `node-pty`/`electron` directly — concrete I/O lives in `infrastructure/`.

## Note on the current working tree

At the time this plan was written, the working tree already has substantial **unrelated, uncommitted** work in progress (an instruction-draft-generation feature — `ClaudeCliPort`, `NodeClaudeCliAdapter`, `instruction-generation-prompt.ts`, etc.). Several files this plan edits are already dirty from that work: `docs/reference/architecture.md`, `docs/reference/ipc-contract.md`, `src/main/index.ts`, `src/main/ipc/registry.ts`, `src/preload/index.ts`, `src/renderer/vite-env.d.ts`, `src/renderer/components/CustomizationEditor.tsx`, `tests/renderer/components/customization-editor.test.tsx`, `tests/renderer/test-utils.tsx` (touched by Tasks 3, 4, 5, 6, and 7). Every task below reads/edits these files' **current** on-disk content correctly, but a `git commit` on any of them necessarily commits the whole file, not just this plan's hunks — so Tasks 3, 4, 5, 6, and 7's commits will also fold in whatever of that pre-existing instruction-generation work still sits uncommitted in those specific files at that point. Before starting execution, either commit/stash that unrelated work first (recommended, keeps history clean), or accept that those four commits will be mixed.

---

## File structure

```
src/main/application/ports/claude-session-port.ts          # NEW — ClaudeSessionPort interface
src/main/infrastructure/claude-cli/
  node-pty-session-adapter.ts                               # NEW — node-pty implementation
src/main/application/services/session-service.ts            # NEW — one-session-per-entity use case
src/main/application/services/__fixtures__/
  fake-claude-session-port.ts                                # NEW — test double
src/main/ipc/session-handlers.ts                             # NEW — session.* IPC handlers
src/main/ipc/registry.ts                                     # MODIFY — wire sessionService into IpcDeps
src/main/index.ts                                             # MODIFY — instantiate adapter/service, before-quit
src/preload/index.ts                                          # MODIFY — window.api.session.onOutput/onExit bridge
src/renderer/vite-env.d.ts                                    # MODIFY — window.api typings
src/renderer/components/SessionPanel.tsx                      # NEW — xterm.js terminal pane
src/renderer/components/CustomizationEditor.tsx               # MODIFY — embed SessionPanel
src/shared/session.ts                                         # NEW — SessionSnapshot + push-channel types
docs/reference/architecture.md                                # MODIFY — session bounded context section
docs/reference/ipc-contract.md                                # MODIFY — session namespace + push channel
package.json                                                  # MODIFY — node-pty, @xterm/*, @electron/rebuild
tests/main/infrastructure/claude-cli/
  node-pty-session-adapter.test.ts                            # NEW
  __fixtures__/stub-interactive.sh                            # NEW
tests/main/application/services/session-service.test.ts       # NEW
tests/main/ipc/session-handlers.test.ts                       # NEW
tests/renderer/components/session-panel.test.tsx              # NEW
tests/renderer/components/customization-editor.test.tsx       # MODIFY — session panel wiring
tests/renderer/test-utils.tsx                                 # MODIFY — mockApi() gains a session.onOutput/onExit mock
```

---

### Task 1: Dependencies + `ClaudeSessionPort` + `NodePtySessionAdapter`

**Files:**
- Modify: `package.json`
- Create: `src/main/application/ports/claude-session-port.ts`
- Create: `src/main/infrastructure/claude-cli/node-pty-session-adapter.ts`
- Test: `tests/main/infrastructure/claude-cli/node-pty-session-adapter.test.ts`
- Create: `tests/main/infrastructure/claude-cli/__fixtures__/stub-interactive.sh`

**Interfaces:**
- Produces: `ClaudeSessionPort` (`spawn(sessionId, cwd, opts): Promise<void>`, `write(sessionId, data): void`, `resize(sessionId, cols, rows): void`, `kill(sessionId): void`, `onData(listener): void`, `onExit(listener): void`), `ClaudeSessionSpawnOptions { cols: number; rows: number }`, `ClaudeSessionDataListener = (sessionId: string, chunk: string) => void`, `ClaudeSessionExitListener = (sessionId: string, exitCode: number) => void`. `NodePtySessionAdapter implements ClaudeSessionPort`, constructor `(bin = 'claude')`.

**Note on native module ABI:** `node-pty` must be rebuilt against **Electron's** Node ABI to run inside the packaged app, but that rebuilt binary can't be `require()`'d from plain-Node `vitest`. This task deliberately does **not** add a `postinstall` rebuild hook — that would silently break `npm test`. Instead the rebuild is wired into `predev`/`prebuild` only (added in Step 1), so `npm install` / `npm test` always see the binary built against the **host** Node ABI vitest itself runs on, and the adapter's own integration test (Step 6) spawns a real PTY safely under that ABI. Running `npm run dev` or `npm run build` after this leaves `node-pty` rebuilt for Electron's ABI; running `npm test` again after that will fail to load the native binding until `npm install` (or `npm rebuild node-pty`) restores the host build. This trade-off is called out in Task 7's docs update.

- [ ] **Step 1: Add dependencies and the rebuild scripts**

```bash
npm install node-pty @xterm/xterm @xterm/addon-fit
npm install --save-dev @electron/rebuild
```

(`node-pty` requires Xcode Command Line Tools to compile via `node-gyp` on macOS — already a prerequisite for this machine's toolchain. `node-pty` ships its own TypeScript types; no separate `@types/node-pty` package is needed.)

Edit `package.json`'s `scripts` block to add:

```json
    "rebuild:native": "electron-rebuild -f -w node-pty",
    "predev": "npm run rebuild:native",
    "prebuild": "npm run rebuild:native",
```

npm automatically runs `pre<script>` before `<script>`, so `npm run dev` and `npm run build` always rebuild `node-pty` for Electron's ABI first; `npm install` and `npm test` never touch it.

- [ ] **Step 2: Write the port interface**

Create `src/main/application/ports/claude-session-port.ts`:

```ts
export interface ClaudeSessionSpawnOptions {
  cols: number;
  rows: number;
}

export type ClaudeSessionDataListener = (sessionId: string, chunk: string) => void;
export type ClaudeSessionExitListener = (sessionId: string, exitCode: number) => void;

/**
 * Spawns and controls a single interactive `claude` CLI process per session,
 * running in a real PTY so the CLI's TUI renders correctly. `sessionId` is
 * caller-assigned (SessionService uses the entity's urn) — the port itself
 * doesn't know about entities.
 */
export interface ClaudeSessionPort {
  spawn(sessionId: string, cwd: string, opts: ClaudeSessionSpawnOptions): Promise<void>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;
  onData(listener: ClaudeSessionDataListener): void;
  onExit(listener: ClaudeSessionExitListener): void;
}
```

- [ ] **Step 3: Write the fixture stub script the adapter test will spawn**

Create `tests/main/infrastructure/claude-cli/__fixtures__/stub-interactive.sh`:

```sh
#!/bin/sh
echo "READY"
read line
echo "ECHO:$line"
exit 7
```

Make it executable:

```bash
chmod +x tests/main/infrastructure/claude-cli/__fixtures__/stub-interactive.sh
```

- [ ] **Step 4: Write the failing adapter test**

Create `tests/main/infrastructure/claude-cli/node-pty-session-adapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NodePtySessionAdapter } from '../../../../src/main/infrastructure/claude-cli/node-pty-session-adapter.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const stub = (name: string): string => path.join(fixturesDir, name);

describe('NodePtySessionAdapter', () => {
  it('spawns a real PTY, relays written input back through onData, and reports the exit code on close', async () => {
    const adapter = new NodePtySessionAdapter(stub('stub-interactive.sh'));
    const chunks: string[] = [];
    const exits: Array<[string, number]> = [];
    adapter.onData((sessionId, chunk) => chunks.push(chunk));
    adapter.onExit((sessionId, exitCode) => exits.push([sessionId, exitCode]));

    await adapter.spawn('sess-1', process.cwd(), { cols: 80, rows: 24 });
    adapter.write('sess-1', 'hello\r');

    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('ECHO:hello');
    });
    await vi.waitFor(() => {
      expect(exits).toEqual([['sess-1', 7]]);
    });
  });

  it('write/resize/kill on an unknown sessionId are no-ops', () => {
    const adapter = new NodePtySessionAdapter(stub('stub-interactive.sh'));
    expect(() => adapter.write('nope', 'x')).not.toThrow();
    expect(() => adapter.resize('nope', 10, 10)).not.toThrow();
    expect(() => adapter.kill('nope')).not.toThrow();
  });

  it('spawn rejects when the binary does not exist', async () => {
    const adapter = new NodePtySessionAdapter('/definitely/not/a/real/binary-xyz');
    await expect(
      adapter.spawn('sess-2', process.cwd(), { cols: 80, rows: 24 }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/main/infrastructure/claude-cli/node-pty-session-adapter.test.ts`
Expected: FAIL with "Cannot find module '../../../../src/main/infrastructure/claude-cli/node-pty-session-adapter.js'".

- [ ] **Step 6: Implement the adapter**

Create `src/main/infrastructure/claude-cli/node-pty-session-adapter.ts`:

```ts
import { spawn as ptySpawn, type IPty } from 'node-pty';
import type {
  ClaudeSessionDataListener,
  ClaudeSessionExitListener,
  ClaudeSessionPort,
  ClaudeSessionSpawnOptions,
} from '../../application/ports/claude-session-port.js';

const CLAUDE_ARGS = ['--continue'];

/**
 * Spawns the user's locally installed `claude` CLI inside a real PTY via
 * `node-pty` so its interactive TUI renders correctly (cursor movement,
 * spinners, raw keyboard input all depend on `process.stdout.isTTY`).
 * Always passes `--continue`: `claude` falls back to starting a fresh
 * conversation when no prior transcript exists for the cwd, so this covers
 * both "first ever open" and "resume" without the adapter needing to detect
 * which case it is.
 */
export class NodePtySessionAdapter implements ClaudeSessionPort {
  private readonly ptys = new Map<string, IPty>();
  private dataListener: ClaudeSessionDataListener | null = null;
  private exitListener: ClaudeSessionExitListener | null = null;

  // `bin` is overridable so tests can point at a stub script and exercise the
  // real ENOENT/exit-code branches without depending on `claude` being
  // installed — mirrors NodeClaudeCliAdapter's testability pattern.
  constructor(private readonly bin = 'claude') {}

  onData(listener: ClaudeSessionDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: ClaudeSessionExitListener): void {
    this.exitListener = listener;
  }

  spawn(sessionId: string, cwd: string, opts: ClaudeSessionSpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: IPty;
      try {
        child = ptySpawn(this.bin, CLAUDE_ARGS, {
          name: 'xterm-color',
          cols: opts.cols,
          rows: opts.rows,
          cwd,
          env: process.env as Record<string, string>,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.ptys.set(sessionId, child);
      child.onData((chunk) => this.dataListener?.(sessionId, chunk));
      child.onExit(({ exitCode }) => {
        this.ptys.delete(sessionId);
        this.exitListener?.(sessionId, exitCode);
      });
      resolve();
    });
  }

  write(sessionId: string, data: string): void {
    this.ptys.get(sessionId)?.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.ptys.get(sessionId)?.resize(cols, rows);
  }

  kill(sessionId: string): void {
    this.ptys.get(sessionId)?.kill();
    this.ptys.delete(sessionId);
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/main/infrastructure/claude-cli/node-pty-session-adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/main/application/ports/claude-session-port.ts src/main/infrastructure/claude-cli/node-pty-session-adapter.ts tests/main/infrastructure/claude-cli/node-pty-session-adapter.test.ts tests/main/infrastructure/claude-cli/__fixtures__/stub-interactive.sh
git commit -m "feat: add node-pty ClaudeSessionPort and adapter"
```

---

### Task 2: `SessionService` (application layer)

**Files:**
- Create: `src/shared/session.ts`
- Create: `src/main/application/services/__fixtures__/fake-claude-session-port.ts`
- Create: `src/main/application/services/session-service.ts`
- Test: `tests/main/application/services/session-service.test.ts`

**Interfaces:**
- Consumes: `ClaudeSessionPort` (Task 1), `EntityService` (`get(urn: string): Promise<Entity>` — existing, `src/main/application/services/entity-service.ts`), `Entity`/`Instruction`/`isProjectInstruction` (existing, `src/shared/entity.ts`), `ioError` (existing, `src/main/domain/errors.ts`).
- Produces: `SessionStatus = 'running' | 'exited'`, `SessionSnapshot { entityUrn: string; cwd: string; status: SessionStatus }` (`src/shared/session.ts`); `SessionService` with `spawn(entityUrn): Promise<SessionSnapshot>`, `write(sessionId, data): void`, `resize(sessionId, cols, rows): void`, `kill(sessionId): void`, `status(sessionId): SessionSnapshot | undefined`, `killAll(): void`, `onOutput(listener: (sessionId: string, chunk: string) => void): void`, `onExit(listener: (sessionId: string, status: SessionStatus, exitCode: number) => void): void`. `FakeClaudeSessionPort` test double (`spawnCalls`, `writes`, `resizes`, `killed` arrays; `failNextSpawn(error)`, `simulateData(sessionId, chunk)`, `simulateExit(sessionId, exitCode)`).

- [ ] **Step 1: Write the shared session types**

Create `src/shared/session.ts`:

```ts
export type SessionStatus = 'running' | 'exited';

export interface SessionSnapshot {
  entityUrn: string;
  cwd: string;
  status: SessionStatus;
}
```

- [ ] **Step 2: Write the fake port fixture**

Create `src/main/application/services/__fixtures__/fake-claude-session-port.ts`:

```ts
import type {
  ClaudeSessionDataListener,
  ClaudeSessionExitListener,
  ClaudeSessionPort,
  ClaudeSessionSpawnOptions,
} from '../../ports/claude-session-port.js';

export class FakeClaudeSessionPort implements ClaudeSessionPort {
  spawnCalls: Array<{ sessionId: string; cwd: string; opts: ClaudeSessionSpawnOptions }> = [];
  writes: Array<[string, string]> = [];
  resizes: Array<[string, number, number]> = [];
  killed: string[] = [];

  private nextSpawnFailure: Error | null = null;
  private dataListener: ClaudeSessionDataListener | null = null;
  private exitListener: ClaudeSessionExitListener | null = null;

  onData(listener: ClaudeSessionDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: ClaudeSessionExitListener): void {
    this.exitListener = listener;
  }

  failNextSpawn(error: Error): void {
    this.nextSpawnFailure = error;
  }

  async spawn(sessionId: string, cwd: string, opts: ClaudeSessionSpawnOptions): Promise<void> {
    if (this.nextSpawnFailure) {
      const err = this.nextSpawnFailure;
      this.nextSpawnFailure = null;
      throw err;
    }
    this.spawnCalls.push({ sessionId, cwd, opts });
  }

  write(sessionId: string, data: string): void {
    this.writes.push([sessionId, data]);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.resizes.push([sessionId, cols, rows]);
  }

  kill(sessionId: string): void {
    this.killed.push(sessionId);
  }

  simulateData(sessionId: string, chunk: string): void {
    this.dataListener?.(sessionId, chunk);
  }

  simulateExit(sessionId: string, exitCode: number): void {
    this.exitListener?.(sessionId, exitCode);
  }
}
```

- [ ] **Step 3: Write the failing service test**

Create `tests/main/application/services/session-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SessionService } from '../../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { WORKSPACE_SOURCE, entityUrn, type Skill, type ProjectInstruction } from '../../../../src/shared/entity.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const WORKSPACE = '/home/user/.ai-companion';

const skill = (name = 'foo'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const projectInstruction = (name = 'acme', repoPath = '/repos/acme'): ProjectInstruction => ({
  urn: entityUrn('instruction', name), kind: 'instruction', name, description: '',
  scopes: ['project'], metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: '# notes\n', repoPath,
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeSession = new FakeClaudeSessionPort();
  const service = new SessionService(base, claudeSession, WORKSPACE);
  return { service, base, claudeSession };
};

describe('SessionService', () => {
  it('spawn resolves cwd to the workspace root for a skill', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityUrn('skill', 'foo'));
    expect(session.cwd).toBe(WORKSPACE);
    expect(session.status).toBe('running');
  });

  it('spawn resolves cwd to repoPath for a project instruction', async () => {
    const { service, base } = setup();
    await base.save({ entity: projectInstruction('acme', '/repos/acme'), isCreate: true });
    const session = await service.spawn(entityUrn('instruction', 'acme'));
    expect(session.cwd).toBe('/repos/acme');
  });

  it('spawn reuses the existing live session for the same entityUrn (idempotent open)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = await service.spawn(entityUrn('skill', 'foo'));
    const second = await service.spawn(entityUrn('skill', 'foo'));
    expect(second).toEqual(first);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });

  it('spawn starts a new PTY when the previous session for the entity has exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 0);
    await service.spawn(entityUrn('skill', 'foo'));
    expect(claudeSession.spawnCalls).toHaveLength(2);
  });

  it('spawn rejects with not_found for an entity that does not exist', async () => {
    const { service } = setup();
    const err = await service.spawn('urn:skill:missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('not_found');
  });

  it('spawn wraps a port failure as an io DomainError', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    claudeSession.failNextSpawn(new Error('claude CLI not found in PATH'));
    const err = await service.spawn(entityUrn('skill', 'foo')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('io');
  });

  it('write forwards data to the port for a running session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    service.write(entityUrn('skill', 'foo'), 'hello\n');
    expect(claudeSession.writes).toEqual([[entityUrn('skill', 'foo'), 'hello\n']]);
  });

  it('write is a no-op once the session has exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 0);
    service.write(entityUrn('skill', 'foo'), 'hello\n');
    expect(claudeSession.writes).toEqual([]);
  });

  it('kill marks the session exited and calls the port; a second kill is a no-op', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    service.kill(entityUrn('skill', 'foo'));
    service.kill(entityUrn('skill', 'foo'));
    expect(claudeSession.killed).toEqual([entityUrn('skill', 'foo')]);
    expect(service.status(entityUrn('skill', 'foo'))?.status).toBe('exited');
  });

  it('the running → exited transition happens when the port reports the PTY exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 1);
    expect(service.status(entityUrn('skill', 'foo'))?.status).toBe('exited');
  });

  it('killAll kills every running session and leaves exited ones alone', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await base.save({ entity: skill('bar'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    await service.spawn(entityUrn('skill', 'bar'));
    claudeSession.simulateExit(entityUrn('skill', 'bar'), 0);
    service.killAll();
    expect(claudeSession.killed).toEqual([entityUrn('skill', 'foo')]);
  });

  it('onOutput relays chunks emitted by the port for any session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    const received: Array<[string, string]> = [];
    service.onOutput((sessionId, chunk) => received.push([sessionId, chunk]));
    claudeSession.simulateData(entityUrn('skill', 'foo'), 'hello');
    expect(received).toEqual([[entityUrn('skill', 'foo'), 'hello']]);
  });

  it('onExit relays the exit code alongside the exited status', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityUrn('skill', 'foo'));
    const received: Array<[string, string, number]> = [];
    service.onExit((sessionId, status, exitCode) => received.push([sessionId, status, exitCode]));
    claudeSession.simulateExit(entityUrn('skill', 'foo'), 7);
    expect(received).toEqual([[entityUrn('skill', 'foo'), 'exited', 7]]);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/main/application/services/session-service.test.ts`
Expected: FAIL with "Cannot find module '../../../../src/main/application/services/session-service.js'".

- [ ] **Step 5: Implement `SessionService`**

Create `src/main/application/services/session-service.ts`:

```ts
import type { Entity, Instruction } from '../../../shared/entity.js';
import { isProjectInstruction } from '../../../shared/entity.js';
import type { SessionSnapshot, SessionStatus } from '../../../shared/session.js';
import type { EntityService } from './entity-service.js';
import type { ClaudeSessionPort } from '../ports/claude-session-port.js';
import { ioError } from '../../domain/errors.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export type SessionOutputListener = (sessionId: string, chunk: string) => void;
export type SessionStatusListener = (sessionId: string, status: SessionStatus, exitCode: number) => void;

/**
 * Owns the one-live-session-per-entity invariant. `sessionId` is always the
 * entity's own urn — since only one session can be live per entity, there's
 * no need for a separate generated id.
 */
export class SessionService {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly outputListeners: SessionOutputListener[] = [];
  private readonly exitListeners: SessionStatusListener[] = [];

  constructor(
    private readonly entityService: EntityService,
    private readonly claudeSession: ClaudeSessionPort,
    private readonly workspacePath: string,
  ) {
    this.claudeSession.onData((sessionId, chunk) => {
      for (const listener of this.outputListeners) listener(sessionId, chunk);
    });
    this.claudeSession.onExit((sessionId, exitCode) => {
      const session = this.sessions.get(sessionId);
      if (session) session.status = 'exited';
      for (const listener of this.exitListeners) listener(sessionId, 'exited', exitCode);
    });
  }

  async spawn(entityUrn: string): Promise<SessionSnapshot> {
    const existing = this.sessions.get(entityUrn);
    if (existing && existing.status === 'running') return existing;

    const entity = await this.entityService.get(entityUrn);
    const cwd = this.resolveCwd(entity);

    try {
      await this.claudeSession.spawn(entityUrn, cwd, { cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    } catch (err) {
      throw ioError({
        message: `Failed to start a claude session: ${(err as Error).message}`,
        details: { reason: 'claude_session_spawn_failed' },
      });
    }

    const session: SessionSnapshot = { entityUrn, cwd, status: 'running' };
    this.sessions.set(entityUrn, session);
    return session;
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    this.claudeSession.write(sessionId, data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    this.claudeSession.resize(sessionId, cols, rows);
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    this.claudeSession.kill(sessionId);
    session.status = 'exited';
  }

  status(sessionId: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionId);
  }

  killAll(): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'running') {
        this.claudeSession.kill(sessionId);
        session.status = 'exited';
      }
    }
  }

  onOutput(listener: SessionOutputListener): void {
    this.outputListeners.push(listener);
  }

  onExit(listener: SessionStatusListener): void {
    this.exitListeners.push(listener);
  }

  private resolveCwd(entity: Entity): string {
    if (entity.kind === 'instruction') {
      const instruction = entity as Instruction;
      if (isProjectInstruction(instruction)) return instruction.repoPath;
    }
    return this.workspacePath;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/main/application/services/session-service.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/session.ts src/main/application/services/session-service.ts src/main/application/services/__fixtures__/fake-claude-session-port.ts tests/main/application/services/session-service.test.ts
git commit -m "feat: add SessionService with one-session-per-entity invariant"
```

---

### Task 3: `session.*` IPC handlers + composition root wiring

**Files:**
- Create: `src/main/ipc/session-handlers.ts`
- Test: `tests/main/ipc/session-handlers.test.ts`
- Modify: `src/main/ipc/registry.ts`
- Modify: `src/shared/session.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `SessionService` (Task 2), `SessionSnapshot` (Task 2), `asObject`/`asString` (existing, `src/main/ipc/_validators.ts`), `DomainError` (existing).
- Produces: `buildSessionHandlers(service: SessionService): IpcHandlers` registering `session.spawn`, `session.write`, `session.resize`, `session.kill`, `session.status`; `IpcDeps.sessionService: SessionService` (added to `registry.ts`); `SessionOutputEvent { sessionId: string; chunk: string }`, `SessionExitEvent { sessionId: string; exitCode: number }`, `SESSION_OUTPUT_CHANNEL = 'session:output'`, `SESSION_EXIT_CHANNEL = 'session:exit'` (added to `src/shared/session.ts`, consumed by Task 4's preload bridge).

This task keeps handlers, registry wiring, and composition-root instantiation together in one task because splitting them would leave `registry.ts`'s `IpcDeps.sessionService` field required without any caller supplying it — the repo wouldn't typecheck in between.

- [ ] **Step 1: Write the failing handler test**

Create `tests/main/ipc/session-handlers.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildSessionHandlers } from '../../../src/main/ipc/session-handlers.js';
import { SessionService } from '../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { WORKSPACE_SOURCE, entityUrn, type Skill } from '../../../src/shared/entity.js';

const skill = (name = 'foo'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeSession = new FakeClaudeSessionPort();
  const service = new SessionService(base, claudeSession, '/workspace');
  return { service, base, claudeSession };
};

describe('session-handlers', () => {
  it('session.spawn validates entityUrn and calls service.spawn', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    expect(spy).toHaveBeenCalledWith(entityUrn('skill', 'foo'));
  });

  it('session.spawn rejects a missing entityUrn', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({})).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.write validates and forwards sessionId + data', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    const spy = vi.spyOn(service, 'write');
    await h['session.write']!({ sessionId: entityUrn('skill', 'foo'), data: 'ls\n' });
    expect(spy).toHaveBeenCalledWith(entityUrn('skill', 'foo'), 'ls\n');
  });

  it('session.write accepts an empty data string', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    await expect(
      h['session.write']!({ sessionId: entityUrn('skill', 'foo'), data: '' }),
    ).resolves.toBeUndefined();
  });

  it('session.resize validates numeric cols/rows', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(
      h['session.resize']!({ sessionId: 'x', cols: 'wide', rows: 24 }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.kill forwards sessionId', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    const spy = vi.spyOn(service, 'kill');
    await h['session.kill']!({ sessionId: entityUrn('skill', 'foo') });
    expect(spy).toHaveBeenCalledWith(entityUrn('skill', 'foo'));
  });

  it('session.status returns null for an unknown session', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    const result = await h['session.status']!({ sessionId: 'urn:skill:none' });
    expect(result).toBeNull();
  });

  it('session.status returns the snapshot for a live session', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ entityUrn: entityUrn('skill', 'foo') });
    const result = await h['session.status']!({ sessionId: entityUrn('skill', 'foo') });
    expect(result).toMatchObject({ entityUrn: entityUrn('skill', 'foo'), status: 'running' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/ipc/session-handlers.test.ts`
Expected: FAIL with "Cannot find module '../../../src/main/ipc/session-handlers.js'".

- [ ] **Step 3: Implement the handlers**

Create `src/main/ipc/session-handlers.ts`:

```ts
import type { IpcHandlers } from './dispatcher.js';
import type { SessionService } from '../application/services/session-service.js';
import { asObject, asString } from './_validators.js';
import { DomainError } from '../domain/errors.js';

function asRawString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

export function buildSessionHandlers(service: SessionService): IpcHandlers {
  return {
    'session.spawn': async (params) => {
      const raw = asObject(params, 'session.spawn');
      return service.spawn(asString(raw['entityUrn'], 'entityUrn'));
    },
    'session.write': async (params) => {
      const raw = asObject(params, 'session.write');
      service.write(asString(raw['sessionId'], 'sessionId'), asRawString(raw['data'], 'data'));
    },
    'session.resize': async (params) => {
      const raw = asObject(params, 'session.resize');
      service.resize(
        asString(raw['sessionId'], 'sessionId'),
        asNumber(raw['cols'], 'cols'),
        asNumber(raw['rows'], 'rows'),
      );
    },
    'session.kill': async (params) => {
      const raw = asObject(params, 'session.kill');
      service.kill(asString(raw['sessionId'], 'sessionId'));
    },
    'session.status': async (params) => {
      const raw = asObject(params, 'session.status');
      return service.status(asString(raw['sessionId'], 'sessionId')) ?? null;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/ipc/session-handlers.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Extend the shared session types with the push-channel shapes**

Edit `src/shared/session.ts`, append:

```ts

export interface SessionOutputEvent {
  sessionId: string;
  chunk: string;
}

export interface SessionExitEvent {
  sessionId: string;
  exitCode: number;
}

/** Push channel main→renderer for live PTY output (see docs/reference/ipc-contract.md#push-channels-exception-to-requestresponse). */
export const SESSION_OUTPUT_CHANNEL = 'session:output' as const;
/** Push channel main→renderer fired once when a session's `claude` process exits. */
export const SESSION_EXIT_CHANNEL = 'session:exit' as const;
```

- [ ] **Step 6: Wire `sessionService` into `IpcDeps` and `buildHandlers`**

Edit `src/main/ipc/registry.ts`:

Add the import near the other service imports (after the `InstructionService` import):

```ts
import type { SessionService } from '../application/services/session-service.js';
import { buildSessionHandlers } from './session-handlers.js';
```

Add to the `IpcDeps` interface (after `instructionService: InstructionService;`):

```ts
  sessionService: SessionService;
```

Add `sessionService` to the destructure inside `buildHandlers` (after `instructionService,`):

```ts
    sessionService,
```

Add to the returned handler map, alongside the other `...buildXxxHandlers(...)` spreads (after `...buildInstructionHandlers(instructionService, emitInstructionGenerateProgress),`):

```ts
    ...buildSessionHandlers(sessionService),
```

- [ ] **Step 7: Wire the adapter, service, push-channel emitters, and `before-quit` into the composition root**

Edit `src/main/index.ts`.

Add imports (after the `NodeClaudeCliAdapter` import):

```ts
import { NodePtySessionAdapter } from './infrastructure/claude-cli/node-pty-session-adapter.js';
import { SessionService } from './application/services/session-service.js';
import { SESSION_OUTPUT_CHANNEL, SESSION_EXIT_CHANNEL } from '../shared/session.js';
```

Inside `wireIpc()`, after the `instructionService`/`emitInstructionGenerateProgress` block, add:

```ts
  const claudeSessionPort = new NodePtySessionAdapter();
  const sessionService = new SessionService(entityService, claudeSessionPort, workspacePath);
  sessionService.onOutput((sessionId, chunk) => {
    mainWindow?.webContents.send(SESSION_OUTPUT_CHANNEL, { sessionId, chunk });
  });
  sessionService.onExit((sessionId, _status, exitCode) => {
    mainWindow?.webContents.send(SESSION_EXIT_CHANNEL, { sessionId, exitCode });
  });
```

Add `sessionService` to the `buildHandlers({ ... })` call (after `instructionService,`):

```ts
    sessionService,
```

In the `else` block that registers `app.on('second-instance', ...)` / `app.on('will-quit', ...)` / `app.on('window-all-closed', ...)`, add a new listener (order doesn't matter relative to the others):

```ts
  app.on('before-quit', () => {
    sessionService.killAll();
  });
```

- [ ] **Step 8: Run the full node test project, typecheck, and build**

```bash
npx vitest --project node run
npm run typecheck
npm run build
```

Expected: all node-project tests pass, no typecheck errors, build succeeds.

- [ ] **Step 9: Manual smoke test**

```bash
npm run dev
```

In the running app: open any Skill's editor, confirm the app launches without console errors (this proves `node-pty` rebuilt correctly for Electron's ABI via `predev`). A visible "Open session" affordance won't exist until Task 5/6 — this step is only verifying the composition root wires up without crashing. Quit the app and confirm no orphaned `claude`/PTY child process remains (`ps aux | grep claude` should show nothing new).

- [ ] **Step 10: Commit**

```bash
git add src/main/ipc/session-handlers.ts src/main/ipc/registry.ts src/main/index.ts src/shared/session.ts tests/main/ipc/session-handlers.test.ts
git commit -m "feat: wire session.* IPC namespace and before-quit session cleanup"
```

---

### Task 4: Preload bridge (`window.api.session.onOutput` / `onExit`)

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/vite-env.d.ts`

**Interfaces:**
- Consumes: `SESSION_OUTPUT_CHANNEL`, `SESSION_EXIT_CHANNEL`, `SessionOutputEvent`, `SessionExitEvent` (Task 3, `src/shared/session.ts`).
- Produces: `window.api.session.onOutput(sessionId: string, listener: (chunk: string) => void): () => void`, `window.api.session.onExit(sessionId: string, listener: (exitCode: number) => void): () => void`. Per the design spec's §3 architecture bullet, these are nested under `window.api.session` (not flat top-level methods) and take the target `sessionId` directly — the preload layer filters the raw push-channel event by `sessionId` itself and hands the renderer only the payload (`chunk` / `exitCode`), since multiple sessions can be live concurrently.

There is no existing test file for `src/preload/index.ts` (contextBridge code isn't unit-testable outside Electron in this codebase — renderer tests mock `window.api` wholesale instead). This task's correctness is verified by typecheck/build plus the manual smoke test in Task 6.

- [ ] **Step 1: Add the bridge methods**

Edit `src/preload/index.ts`. Add to the imports:

```ts
import {
  SESSION_OUTPUT_CHANNEL,
  SESSION_EXIT_CHANNEL,
  type SessionOutputEvent,
  type SessionExitEvent,
} from '../shared/session.js';
```

Add a nested `session` property to the `api` object, after `onInstructionGenerateProgress`:

```ts
  session: {
    onOutput: (sessionId: string, listener: (chunk: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: SessionOutputEvent): void => {
        if (payload.sessionId === sessionId) listener(payload.chunk);
      };
      ipcRenderer.on(SESSION_OUTPUT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(SESSION_OUTPUT_CHANNEL, wrapped);
    },
    onExit: (sessionId: string, listener: (exitCode: number) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: SessionExitEvent): void => {
        if (payload.sessionId === sessionId) listener(payload.exitCode);
      };
      ipcRenderer.on(SESSION_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(SESSION_EXIT_CHANNEL, wrapped);
    },
  },
```

- [ ] **Step 2: Update the renderer's `window.api` type declaration**

Edit `src/renderer/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

import type { IpcResult } from '../shared/ipc-contract.js';
import type { GenerateDraftProgressEvent } from '../shared/instruction-generation.js';

declare global {
  interface Window {
    api: {
      call<T>(method: string, params: unknown): Promise<IpcResult<T>>;
      isDev: boolean;
      onInstructionGenerateProgress(listener: (event: GenerateDraftProgressEvent) => void): () => void;
      session: {
        onOutput(sessionId: string, listener: (chunk: string) => void): () => void;
        onExit(sessionId: string, listener: (exitCode: number) => void): () => void;
      };
    };
  }
}

export {};
```

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/vite-env.d.ts
git commit -m "feat: bridge session output/exit push channels through preload"
```

---

### Task 5: `SessionPanel` renderer component

**Files:**
- Modify: `tests/renderer/test-utils.tsx`
- Create: `src/renderer/components/SessionPanel.tsx`
- Test: `tests/renderer/components/session-panel.test.tsx`

**Interfaces:**
- Consumes: `callIpc`/`IpcCallError` (existing, `src/renderer/lib/ipc.ts`), `SessionSnapshot` (Task 2/3, `src/shared/session.ts`), `window.api.session.onOutput`/`onExit` (Task 4).
- Produces: `SessionPanel({ entityUrn: string }): React.ReactElement`, rendering `data-testid="session-panel"` / `"session-open"` / `"session-resume"` / `"session-error"` / `"session-terminal"`.

jsdom can't render a real `@xterm/xterm` `Terminal` (it needs a real canvas/DOM rendering context), so this task's test mocks `@xterm/xterm` and `@xterm/addon-fit` entirely and asserts only the write/output wiring — consistent with the design spec's testing guidance.

- [ ] **Step 1: Extend the shared `mockApi()` test helper**

Edit `tests/renderer/test-utils.tsx`, update `mockApi`:

```ts
export function mockApi(): CallSpy {
  const call = vi.fn();
  const onInstructionGenerateProgress = vi.fn(() => () => {});
  const session = {
    onOutput: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
  };
  Object.defineProperty(window, 'api', {
    value: { call, onInstructionGenerateProgress, session },
    writable: true,
    configurable: true,
  });
  return call;
}
```

- [ ] **Step 2: Write the failing component test**

Create `tests/renderer/components/session-panel.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionPanel } from '../../../src/renderer/components/SessionPanel.js';
import { mockApi, ok, fail, renderWithTheme, type CallSpy } from '../test-utils.js';

interface MockTerminal {
  write: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  _onDataCb: ((data: string) => void) | undefined;
}

const mockTerminalInstances: MockTerminal[] = [];

vi.mock('@xterm/xterm', () => {
  class Terminal implements MockTerminal {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    _onDataCb: ((data: string) => void) | undefined;
    onData = vi.fn((cb: (data: string) => void) => {
      this._onDataCb = cb;
      return { dispose: vi.fn() };
    });
    constructor() {
      mockTerminalInstances.push(this);
    }
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  }
  return { FitAddon };
});

let call: CallSpy;
let onOutput: ReturnType<typeof vi.fn>;
let onExit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockTerminalInstances.length = 0;
  call = mockApi();
  onOutput = vi.mocked(window.api.session.onOutput);
  onExit = vi.mocked(window.api.session.onExit);
});

describe('<SessionPanel>', () => {
  it('mounts the terminal and shows an "Abrir sessão" button before any session is started', () => {
    renderWithTheme(<SessionPanel entityUrn="urn:skill:foo" />);
    expect(screen.getByTestId('session-open')).toBeInTheDocument();
    expect(mockTerminalInstances).toHaveLength(1);
    expect(mockTerminalInstances[0]!.open).toHaveBeenCalled();
  });

  it('spawns a session and switches out of the idle state on click', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(ok({ entityUrn: 'urn:skill:foo', cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel entityUrn="urn:skill:foo" />);
    await user.click(screen.getByTestId('session-open'));

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.spawn', { entityUrn: 'urn:skill:foo' }),
    );
    await waitFor(() => expect(screen.queryByTestId('session-open')).toBeNull());
  });

  it('subscribes to output/exit for the spawned sessionId and writes chunks into the terminal', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(ok({ entityUrn: 'urn:skill:foo', cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel entityUrn="urn:skill:foo" />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() =>
      expect(onOutput).toHaveBeenCalledWith('urn:skill:foo', expect.any(Function)),
    );

    const chunkListener = onOutput.mock.calls[0]?.[1] as (chunk: string) => void;
    chunkListener('hello');

    const terminal = mockTerminalInstances[0]!;
    expect(terminal.write).toHaveBeenCalledWith('hello');
  });

  it('forwards keystrokes typed into the terminal as session.write calls', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(ok({ entityUrn: 'urn:skill:foo', cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel entityUrn="urn:skill:foo" />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('session.spawn', { entityUrn: 'urn:skill:foo' }));

    const terminal = mockTerminalInstances[0]!;
    terminal._onDataCb?.('ls\r');

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('session.write', { sessionId: 'urn:skill:foo', data: 'ls\r' }),
    );
  });

  it('shows the ended state and a resume action when the session exits', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(ok({ entityUrn: 'urn:skill:foo', cwd: '/workspace', status: 'running' }));

    renderWithTheme(<SessionPanel entityUrn="urn:skill:foo" />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() =>
      expect(onExit).toHaveBeenCalledWith('urn:skill:foo', expect.any(Function)),
    );

    const exitListener = onExit.mock.calls[0]?.[1] as (exitCode: number) => void;
    exitListener(0);

    expect(await screen.findByTestId('session-resume')).toBeInTheDocument();
  });

  it('shows an inline error when session.spawn fails', async () => {
    const user = userEvent.setup();
    call.mockResolvedValue(fail('io', 'claude CLI not found in PATH'));

    renderWithTheme(<SessionPanel entityUrn="urn:skill:foo" />);
    await user.click(screen.getByTestId('session-open'));

    expect(await screen.findByTestId('session-error')).toHaveTextContent('claude CLI not found in PATH');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/session-panel.test.tsx`
Expected: FAIL with "Cannot find module '../../../src/renderer/components/SessionPanel.js'".

- [ ] **Step 4: Implement `SessionPanel`**

Create `src/renderer/components/SessionPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { callIpc, IpcCallError } from '../lib/ipc.js';
import type { SessionSnapshot } from '../../shared/session.js';

type PanelStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

interface SessionPanelProps {
  entityUrn: string;
}

export function SessionPanel({ entityUrn }: SessionPanelProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const terminal = new Terminal({ convertEol: true, fontSize: 13 });
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
    if (!sessionId) return;
    const dataDisposable = terminalRef.current?.onData((data) => {
      void callIpc('session.write', { sessionId, data });
    });
    const unsubOutput = window.api.session.onOutput(sessionId, (chunk) => {
      terminalRef.current?.write(chunk);
    });
    const unsubExit = window.api.session.onExit(sessionId, () => {
      setStatus('exited');
    });
    return () => {
      dataDisposable?.dispose();
      unsubOutput();
      unsubExit();
    };
  }, [sessionId]);

  useEffect(() => {
    const syncSize = (): void => {
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims && sessionId) {
        void callIpc('session.resize', { sessionId, cols: dims.cols, rows: dims.rows });
      }
    };
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, [sessionId]);

  const handleOpen = async (): Promise<void> => {
    setStatus('starting');
    setError(null);
    try {
      const session = await callIpc<SessionSnapshot>('session.spawn', { entityUrn });
      setSessionId(session.entityUrn);
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) {
        void callIpc('session.resize', { sessionId: session.entityUrn, cols: dims.cols, rows: dims.rows });
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };

  return (
    <Box data-testid="session-panel">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        {status === 'idle' && (
          <Button variant="outlined" size="small" onClick={() => void handleOpen()} data-testid="session-open">
            Abrir sessão
          </Button>
        )}
        {status === 'starting' && <Typography variant="body2">Iniciando sessão…</Typography>}
        {status === 'running' && <Typography variant="body2" color="success.main">Sessão ativa</Typography>}
        {status === 'exited' && (
          <>
            <Typography variant="body2" color="text.secondary">Sessão encerrada</Typography>
            <Button size="small" onClick={() => void handleOpen()} data-testid="session-resume">Retomar</Button>
          </>
        )}
      </Stack>
      {error && (
        <Typography color="error" data-testid="session-error" sx={{ mb: 1 }}>
          {error}
        </Typography>
      )}
      <Box ref={containerRef} data-testid="session-terminal" sx={{ height: 360 }} />
    </Box>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/session-panel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tests/renderer/test-utils.tsx src/renderer/components/SessionPanel.tsx tests/renderer/components/session-panel.test.tsx
git commit -m "feat: add SessionPanel terminal component"
```

---

### Task 6: Wire `SessionPanel` into `CustomizationEditor`

**Files:**
- Modify: `src/renderer/components/CustomizationEditor.tsx`
- Modify: `tests/renderer/components/customization-editor.test.tsx`

**Interfaces:**
- Consumes: `SessionPanel` (Task 5).

A session only makes sense against an entity that's already been saved (it needs a resolvable `urn` for `SessionService.spawn`/`EntityService.get`), so the panel is shown only when `!isCreate`.

- [ ] **Step 1: Write the failing tests**

Edit `tests/renderer/components/customization-editor.test.tsx`. Add near the top, after the existing imports, the same lightweight xterm mocks used in Task 5 (this file doesn't need instance tracking — it only checks whether the session panel renders):

```tsx
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));
```

Add a new `describe` block at the end of the file, inside the outer `describe('<CustomizationEditor>', ...)`:

```tsx
  describe('session panel', () => {
    it('is not shown while creating a new entity', () => {
      renderWithTheme(
        <CustomizationEditor initial={baseCustomization()} isCreate={true} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.queryByTestId('session-open')).toBeNull();
    });

    it('is shown for an existing entity', () => {
      renderWithTheme(
        <CustomizationEditor initial={baseCustomization()} isCreate={false} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.getByTestId('session-open')).toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/customization-editor.test.tsx`
Expected: The two new "session panel" tests FAIL (no `session-open` testid rendered yet); all pre-existing tests in the file still PASS.

- [ ] **Step 3: Embed `SessionPanel`**

Edit `src/renderer/components/CustomizationEditor.tsx`.

Add the import (after the `SyncReportModal` import):

```ts
import { SessionPanel } from './SessionPanel.js';
```

Insert a new panel after the Body `<Paper>` closes (right after the Body panel's closing `</Paper>` at line 351, before `<Toast ...>`):

```tsx
      {!isCreate && initial.urn && (
        <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
          <Box sx={{ mb: 2 }}><Kicker>Sessão</Kicker></Box>
          <SessionPanel entityUrn={initial.urn} />
        </Paper>
      )}

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/customization-editor.test.tsx`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Run the full jsdom project and typecheck**

```bash
npx vitest --project jsdom run
npm run typecheck
```

Expected: all jsdom-project tests pass, no typecheck errors.

- [ ] **Step 6: Manual HMR-safety check**

```bash
npm run dev
```

In the running app: open an existing Skill's editor, click "Abrir sessão", wait for the session to become active, and send some input (e.g. type a short message and press Enter). While the session is running, save any renderer file (e.g. add/remove a blank line in `SessionPanel.tsx`) to trigger a Vite HMR reload of the renderer. Confirm the terminal pane keeps showing the live session's output/state (or at minimum reconnects to it) rather than the session dying — the PTY lives in the main process, independent of the renderer, so an HMR reload must not kill it. Quit the app afterward and confirm no orphaned `claude` process remains (`ps aux | grep claude`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/CustomizationEditor.tsx tests/renderer/components/customization-editor.test.tsx
git commit -m "feat: embed session panel in the customization editor"
```

---

### Task 7: Update reference docs

**Files:**
- Modify: `docs/reference/architecture.md`
- Modify: `docs/reference/ipc-contract.md`

No code changes in this task — its "test" is a manual proofread against the finished implementation plus the existing docs' own conventions.

- [ ] **Step 1: Add the session bounded context to `architecture.md`**

Edit `docs/reference/architecture.md`. Add a new section after "### Tool adapters" and before "## Renderer structure":

```markdown
## Session bounded context

`src/main/application/ports/claude-session-port.ts` (`ClaudeSessionPort`) + `src/main/infrastructure/claude-cli/node-pty-session-adapter.ts` (`NodePtySessionAdapter`, backed by `node-pty` — the first native module in this codebase) spawn a real interactive `claude` CLI process per session inside a PTY, so the CLI's TUI renders correctly. `SessionService` (`src/main/application/services/session-service.ts`) owns the one-live-session-per-entity invariant, keyed by the entity's own `urn` (no separate generated session id), and resolves each session's working directory from the entity itself: a `ProjectInstruction` uses its own `repoPath`; every other entity kind (`Skill`, `Agent`, `PersonalInstruction`) uses the app's workspace root. `Session` is **not** a fourth `Entity` kind — it's ephemeral process state and never goes through `EntityRepository`; `SessionService` only reads entities (via `EntityService.get`) to resolve cwd.

The `session.*` IPC namespace (`src/main/ipc/session-handlers.ts`) exposes `spawn`/`write`/`resize`/`kill`/`status` over the normal request/response `ipc:call` envelope. Streamed terminal output can't fit that request/response shape, so it travels over a second main→renderer push channel (`session:output` / `session:exit`, `src/shared/session.ts`) — see [ipc-contract.md](ipc-contract.md#push-channels-exception-to-requestresponse). Every live session is SIGTERM'd on `app.on('before-quit', ...)` in `src/main/index.ts` (`SessionService.killAll()`) — there is no background daemon; sessions do not survive the app closing.

On the renderer side, `SessionPanel` (`src/renderer/components/SessionPanel.tsx`, wrapping `@xterm/xterm` + `@xterm/addon-fit`) is embedded directly in `CustomizationEditor` — the entry point is an "Abrir sessão" button inside each entity's own editor, not a separate top-level "Sessions" screen.

**Native module caveat:** `node-pty` must be rebuilt against Electron's own Node ABI to run inside the app (wired into `predev`/`prebuild` via `@electron/rebuild`, not `postinstall` — see `package.json`). That rebuilt binary can't be loaded from plain-Node `vitest`, so `npm install` and `npm test` always see the binary built against the host Node ABI instead. Running `npm run dev` or `npm run build` leaves the binary rebuilt for Electron's ABI; run `npm install` (or `npm rebuild node-pty`) to restore the host build before running `npm test` again.
```

- [ ] **Step 2: Add the `session` namespace and push channel note to `ipc-contract.md`**

Edit `docs/reference/ipc-contract.md`. Extend the "Push channels" section (after the existing `instruction:generateDraft:progress` paragraph):

```markdown

A second pair of push channels exists for the same reason: `session:output` and `session:exit` (defined in [`src/shared/session.ts`](../../src/shared/session.ts)) stream live PTY output and report a session's exit code while a `claude` process spawned via `session.spawn` is running. Unlike the single in-flight instruction draft, **multiple sessions can be live at once** (one per entity with an open session), so preload itself filters by `sessionId` (the entity's own `urn`) before invoking the renderer's listener — there's no single "the" session to assume. Preload exposes these as `window.api.session.onOutput(sessionId, listener) → unsubscribe` and `window.api.session.onExit(sessionId, listener) → unsubscribe`, each listener receiving only the payload (`chunk` / `exitCode`) for that session.
```

Add a new `### session` section in "## Methods", after the `### instruction` section and before `### command *(removed)*`:

```markdown
### session

| Method | Params | Result |
|---|---|---|
| `session.spawn` | `{ entityUrn: string }` | `SessionSnapshot` |
| `session.write` | `{ sessionId: string; data: string }` | `void` |
| `session.resize` | `{ sessionId: string; cols: number; rows: number }` | `void` |
| `session.kill` | `{ sessionId: string }` | `void` |
| `session.status` | `{ sessionId: string }` | `SessionSnapshot \| null` |

`SessionSnapshot` (`src/shared/session.ts`): `{ entityUrn: string; cwd: string; status: 'running' \| 'exited' }`. A session is anchored to a single Skill, Agent, or Instruction entity by its `urn` — there's no separate "project" registry. `session.spawn` is idempotent: calling it again for an `entityUrn` that already has a live session returns the existing `SessionSnapshot` instead of spawning a second PTY. Working directory is derived from the entity, never asked for: a `ProjectInstruction` uses its own `repoPath`; every other kind uses the app's workspace root. Backed by `SessionService` (`src/main/application/services/session-service.ts`) over `ClaudeSessionPort` (`NodePtySessionAdapter`, `src/main/infrastructure/claude-cli/`) — see [Session bounded context](architecture.md#session-bounded-context). Spawn failures (binary missing, PTY spawn error) surface as `kind: 'io'`; an unknown `entityUrn` surfaces as `kind: 'not_found'`. Live PTY output streams separately over the `session:output` / `session:exit` push channels (see above) — `session.spawn`'s response only confirms the process started, it doesn't carry any output itself.
```

- [ ] **Step 3: Proofread**

Read both edited sections back against the finished code from Tasks 1-6 (method names, file paths, error kinds) and fix any drift before committing.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/architecture.md docs/reference/ipc-contract.md
git commit -m "docs: document the embedded Claude sessions bounded context"
```
