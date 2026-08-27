# Workspace File Browser and Session Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the active workspace a read-only file/folder browser (tree + preview pane), let the author register a `Project` by picking a folder in that tree, generalize `session.spawn` to anchor a `claude` session on a workspace or project (not just an entity), and ship the full Workspace screen that ties all three plans together — the first real, navigable slice of "replace the code editor."

**Architecture:** `FileBrowserPort` (`listDir`/`readFile`/`realpath`, implemented by `NodeFileBrowserAdapter` via `node:fs/promises`) is wrapped by `FileBrowserService`, which resolves a caller-supplied relative path against the active workspace's `rootPath` and rejects anything escaping it (`..`, absolute paths, or a symlink resolving outside the root) before delegating to the port — this is the security boundary. `SessionAnchor` (`{kind:'entity';urn} | {kind:'workspace';workspaceId} | {kind:'project';projectId}`) replaces `SessionService.spawn`'s bare `entityUrn` string; sessions are now keyed by `sessionAnchorKey(anchor)` instead of by urn alone, reusing the `resolveScopePath`/`workspaceService`/`projectService` deps plan 2 already wired into `SessionService`. The renderer gets a new top-level "Workspace" nav area: active-workspace header with "Open session", a `Project` list (each row: "Open session", delete), a lazily-expanding folder tree (`workspace.listDir`), a file preview pane (`workspace.readFile`, with a not-previewable placeholder), and a "Use as Project" action per folder node.

**Tech Stack:** TypeScript (strict), Electron main process, Vitest (`node`/`jsdom` projects), `node:fs/promises`, React + `@tanstack/react-query`, MUI (`Dialog`, `Collapse`, `List`) + `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-08-22-workspace-project-scope-design.md` — this is **plan 3 of 3**. It implements §2.10–2.12, the `FileBrowserPort`/`FileBrowserService`/`SessionAnchor` parts of §3, the renderer Workspace-screen bullet, and data flows §4.4, §4.5, and §4.7. It builds on **plan 1** (`docs/superpowers/plans/2026-08-22-workspace-project-domain.md` — `WorkspaceService`, `ProjectService`, `buildWorkspaceScopedServices`, the `WorkspaceSwitcher`) and **plan 2** (`docs/superpowers/plans/2026-08-22-entity-generic-scoping.md` — `resolveScopePath`, `SessionService`'s `scopeDeps`, `use-projects.ts`). Both must already be implemented.

## Global Constraints

- Imports use `.js` extensions (ESM + `verbatimModuleSyntax`).
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are on.
- Services depend on **ports**, never directly on `node:fs`/`electron`. `FileBrowserService`'s symlink-containment check goes through `FileBrowserPort.realpath`, not a direct `node:fs/promises` import, to keep this rule intact.
- No new dependencies.
- `npm test`, `npm run lint`, `npm run typecheck` must be green after the final task.
- Explicitly out of scope for this plan (per the spec's §7 and this plan's own boundary): writing/renaming/deleting/moving files, a code-editing surface, file search, binary/media preview, and a Skill/Agent scope-picker UI. The folder tree and preview pane are navigation and visibility only.

---

## File structure

New files:
- `src/main/application/ports/file-browser-port.ts` — `FileBrowserPort`, `FileBrowserEntry`, `FilePreview`.
- `src/main/infrastructure/filesystem/node-file-browser-adapter.ts` — `NodeFileBrowserAdapter`.
- `src/main/application/services/file-browser-service.ts` — `FileBrowserService`.
- `src/renderer/hooks/use-file-browser.ts` — `useDirListing`, `useFilePreview`, `useResolveAbsolutePath`.
- `src/renderer/components/workspace/FolderTree.tsx` — `FolderTree`, `TreeNode`.
- `src/renderer/components/workspace/FilePreviewPane.tsx`.
- `src/renderer/components/workspace/SessionDialog.tsx`.
- `src/renderer/screens/workspace/WorkspaceScreen.tsx`.

Modified files:
- `src/shared/session.ts` — `SessionAnchor`, `sessionAnchorKey`, reshaped `SessionSnapshot`.
- `src/main/application/services/session-service.ts` + its test — `spawn(anchor)`, anchor-keyed sessions.
- `src/main/ipc/session-handlers.ts` + its test — `session.spawn` takes `{ anchor }`.
- `src/renderer/components/SessionPanel.tsx` — `anchor` prop instead of `entityUrn`.
- `src/renderer/components/CustomizationEditor.tsx` — one-line call-site update.
- `src/main/ipc/workspace-handlers.ts` (plan 1's file) — add `workspace.listDir`, `workspace.readFile`, `workspace.resolvePath`.
- `src/main/index.ts` — construct `fileBrowserService`, rebuild it on `workspace.switchTo`.
- `src/renderer/hooks/use-projects.ts` (plan 2's file) — add `useDeleteProject`.
- `src/renderer/components/shell/nav.ts`, `src/renderer/screens/Main.tsx` — new `'workspace'` nav area.
- `docs/reference/architecture.md`, `docs/reference/ipc-contract.md`, `docs/superpowers/plans/2026-08-21-embedded-claude-sessions.md`.

---

## Task 1: `SessionAnchor` shared type

**Files:**
- Modify: `src/shared/session.ts`
- Test: `tests/shared/session.test.ts` (new)

**Interfaces:**
- Produces: `SessionAnchor = { kind: 'entity'; urn: string } | { kind: 'workspace'; workspaceId: string } | { kind: 'project'; projectId: string }`; `sessionAnchorKey(anchor: SessionAnchor): string` (`entity:<urn>` / `workspace:<id>` / `project:<id>`); `SessionSnapshot` becomes `{ sessionId: string; anchor: SessionAnchor; cwd: string; status: SessionStatus }` (was `{ entityUrn; cwd; status }`). Consumed by every later task in this plan.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sessionAnchorKey, type SessionAnchor } from '../../src/shared/session.js';

describe('sessionAnchorKey', () => {
  it('derives entity:<urn> for an entity anchor', () => {
    const anchor: SessionAnchor = { kind: 'entity', urn: 'urn:skill:demo' };
    expect(sessionAnchorKey(anchor)).toBe('entity:urn:skill:demo');
  });

  it('derives workspace:<id> for a workspace anchor', () => {
    const anchor: SessionAnchor = { kind: 'workspace', workspaceId: 'w1' };
    expect(sessionAnchorKey(anchor)).toBe('workspace:w1');
  });

  it('derives project:<id> for a project anchor', () => {
    const anchor: SessionAnchor = { kind: 'project', projectId: 'p1' };
    expect(sessionAnchorKey(anchor)).toBe('project:p1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shared/session.test.ts`
Expected: FAIL — `sessionAnchorKey`/`SessionAnchor` don't exist yet.

- [ ] **Step 3: Update `src/shared/session.ts`**

Replace the file in full:

```ts
export type SessionStatus = 'running' | 'exited';

export type SessionAnchor =
  | { kind: 'entity'; urn: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'project'; projectId: string };

export function sessionAnchorKey(anchor: SessionAnchor): string {
  if (anchor.kind === 'entity') return `entity:${anchor.urn}`;
  if (anchor.kind === 'workspace') return `workspace:${anchor.workspaceId}`;
  return `project:${anchor.projectId}`;
}

export interface SessionSnapshot {
  sessionId: string;
  anchor: SessionAnchor;
  cwd: string;
  status: SessionStatus;
}

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shared/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/session.ts tests/shared/session.test.ts
git commit -m "feat: add SessionAnchor, replacing bare entityUrn session keying"
```

---

## Task 2: `SessionService.spawn(anchor)`

**Files:**
- Modify: `src/main/application/services/session-service.ts`
- Test: `tests/main/application/services/session-service.test.ts`

**Interfaces:**
- Consumes: `SessionAnchor`/`sessionAnchorKey` (Task 1), `resolveScopePath`/`scopeDeps` (plan 2, already wired).
- Produces: `spawn(anchor: SessionAnchor): Promise<SessionSnapshot>` (was `spawn(entityUrn: string)`); `write`/`resize`/`kill`/`status` are unchanged (already keyed by an opaque `sessionId: string`); `resolveCwd` becomes `private async resolveCwd(anchor: SessionAnchor): Promise<string>` and branches on `anchor.kind` before falling back to the existing entity-branch logic.

- [ ] **Step 1: Replace the test file in full**

Replace `tests/main/application/services/session-service.test.ts` in full:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SessionService } from '../../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { WORKSPACE_SOURCE, entityUrn, type Skill, type Instruction } from '../../../../src/shared/entity.js';
import type { SessionAnchor } from '../../../../src/shared/session.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const WORKSPACE = '/home/user/.ai-companion';

const skill = (name = 'foo'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const projectInstruction = (name = 'acme', scopeId = 'proj-1'): Instruction => ({
  urn: entityUrn('instruction', name), kind: 'instruction', name, description: '',
  scopes: ['project'], scopeId, metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: '# notes\n',
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeSession = new FakeClaudeSessionPort();
  const scopeDeps = {
    workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
    projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
  };
  const service = new SessionService(base, claudeSession, WORKSPACE, scopeDeps);
  return { service, base, claudeSession };
};

const entityAnchor = (urn: string): SessionAnchor => ({ kind: 'entity', urn });

describe('SessionService', () => {
  it('spawn resolves cwd to the workspace root for a skill entity anchor', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(session.cwd).toBe(WORKSPACE);
    expect(session.sessionId).toBe('entity:urn:skill:foo');
    expect(session.anchor).toEqual(entityAnchor(entityUrn('skill', 'foo')));
    expect(session.status).toBe('running');
  });

  it('spawn resolves cwd via resolveScopePath for a project instruction entity anchor', async () => {
    const { service, base } = setup();
    await base.save({ entity: projectInstruction('acme', 'proj-1'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('instruction', 'acme')));
    expect(session.cwd).toBe('/repos/acme');
  });

  it('spawn resolves cwd directly for a workspace anchor (no entity lookup)', async () => {
    const { service } = setup();
    const session = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    expect(session.cwd).toBe('/repos/ws');
    expect(session.sessionId).toBe('workspace:w1');
  });

  it('spawn resolves cwd directly for a project anchor (no entity lookup)', async () => {
    const { service } = setup();
    const session = await service.spawn({ kind: 'project', projectId: 'p1' });
    expect(session.cwd).toBe('/repos/acme');
    expect(session.sessionId).toBe('project:p1');
  });

  it('spawn reuses the existing live session for the same anchor (idempotent open)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const first = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    const second = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(second).toEqual(first);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });

  it('spawn starts a new PTY when the previous session for the anchor has exited', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    claudeSession.simulateExit('entity:urn:skill:foo', 0);
    await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    expect(claudeSession.spawnCalls).toHaveLength(2);
  });

  it('spawn rejects with not_found for an entity anchor that does not exist', async () => {
    const { service } = setup();
    const err = await service.spawn(entityAnchor('urn:skill:missing')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('not_found');
  });

  it('spawn wraps a port failure as an io DomainError', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    claudeSession.failNextSpawn(new Error('claude CLI not found in PATH'));
    const err = await service.spawn(entityAnchor(entityUrn('skill', 'foo'))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('io');
  });

  it('write forwards data to the port for a running session', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    service.write(session.sessionId, 'hello\n');
    expect(claudeSession.writes).toEqual([[session.sessionId, 'hello\n']]);
  });

  it('kill marks the session exited and calls the port; a second kill is a no-op', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const session = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    service.kill(session.sessionId);
    service.kill(session.sessionId);
    expect(claudeSession.killed).toEqual([session.sessionId]);
    expect(service.status(session.sessionId)?.status).toBe('exited');
  });

  it('killAll kills every running session across anchor kinds, leaving exited ones alone', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const entitySession = await service.spawn(entityAnchor(entityUrn('skill', 'foo')));
    const wsSession = await service.spawn({ kind: 'workspace', workspaceId: 'w1' });
    claudeSession.simulateExit(entitySession.sessionId, 0);
    service.killAll();
    expect(claudeSession.killed).toEqual([wsSession.sessionId]);
  });

  it('onOutput/onExit relay by sessionId regardless of anchor kind', async () => {
    const { service, claudeSession } = setup();
    const session = await service.spawn({ kind: 'project', projectId: 'p1' });
    const received: Array<[string, string]> = [];
    service.onOutput((sessionId, chunk) => received.push([sessionId, chunk]));
    claudeSession.simulateData(session.sessionId, 'hello');
    expect(received).toEqual([[session.sessionId, 'hello']]);
  });

  it('spawn deduplicates concurrent calls for the same anchor (single-flight)', async () => {
    const { service, base, claudeSession } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const anchor = entityAnchor(entityUrn('skill', 'foo'));
    const first = service.spawn(anchor);
    const second = service.spawn(anchor);
    const [result1, result2] = await Promise.all([first, second]);
    expect(result1).toEqual(result2);
    expect(claudeSession.spawnCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/services/session-service.test.ts`
Expected: FAIL — `spawn` still takes a bare string.

- [ ] **Step 3: Update `SessionService`**

Read the current file first (plan 2's Task 8 already changed the constructor to take `scopeDeps` and made `resolveCwd` async over an `Entity`) — this task changes `spawn`'s parameter and `resolveCwd`'s parameter from an entity/urn to a `SessionAnchor`. Update the imports:

```ts
import type { Entity, Instruction } from '../../../shared/entity.js';
import type { SessionAnchor, SessionSnapshot, SessionStatus } from '../../../shared/session.js';
import { sessionAnchorKey } from '../../../shared/session.js';
import type { EntityService } from './entity-service.js';
import type { ClaudeSessionPort } from '../ports/claude-session-port.js';
import type { WorkspaceService } from './workspace-service.js';
import type { ProjectService } from './project-service.js';
import { resolveScopePath } from '../resolve-scope-path.js';
import { ioError } from '../../domain/errors.js';
```

Replace `spawn`:

```ts
  async spawn(anchor: SessionAnchor): Promise<SessionSnapshot> {
    const sessionId = sessionAnchorKey(anchor);
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status === 'running') return existing;

    const pendingSpawn = this.pending.get(sessionId);
    if (pendingSpawn) return pendingSpawn;

    const spawnPromise = (async () => {
      const cwd = await this.resolveCwd(anchor);

      try {
        await this.claudeSession.spawn(sessionId, cwd, { cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      } catch (err) {
        throw ioError({
          message: `Failed to start a claude session: ${(err as Error).message}`,
          details: { reason: 'claude_session_spawn_failed' },
        });
      }

      const session: SessionSnapshot = { sessionId, anchor, cwd, status: 'running' };
      this.sessions.set(sessionId, session);
      return session;
    })().finally(() => {
      this.pending.delete(sessionId);
    });

    this.pending.set(sessionId, spawnPromise);
    return spawnPromise;
  }
```

Replace `resolveCwd`:

```ts
  private async resolveCwd(anchor: SessionAnchor): Promise<string> {
    if (anchor.kind === 'workspace') {
      return (await this.scopeDeps.workspaceService.get(anchor.workspaceId)).rootPath;
    }
    if (anchor.kind === 'project') {
      return (await this.scopeDeps.projectService.get(anchor.projectId)).path;
    }
    const entity = await this.entityService.get(anchor.urn);
    if (entity.kind === 'instruction') {
      const instruction = entity as Instruction;
      if (instruction.scopes[0] !== 'personal') {
        return resolveScopePath(instruction, this.scopeDeps);
      }
    }
    return this.workspacePath;
  }
```

`write`/`resize`/`kill`/`status`/`killAll`/`onOutput`/`onExit`/the constructor are unchanged from plan 2's version.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/services/session-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/application/services/session-service.ts tests/main/application/services/session-service.test.ts
git commit -m "feat: SessionService.spawn takes a SessionAnchor instead of a bare entityUrn"
```

---

## Task 3: `session.spawn` IPC handler takes `{ anchor }`

**Files:**
- Modify: `src/main/ipc/session-handlers.ts`
- Test: `tests/main/ipc/session-handlers.test.ts`

**Interfaces:**
- Consumes: `SessionAnchor` (Task 1), `SessionService.spawn(anchor)` (Task 2).
- Produces: `session.spawn`'s param becomes `{ anchor: SessionAnchor }`. `session.write`/`resize`/`kill`/`status` are unchanged (`sessionId` stays a plain string param).

- [ ] **Step 1: Replace the test file in full**

Replace `tests/main/ipc/session-handlers.test.ts` in full:

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
  const scopeDeps = {
    workspaceService: { get: async () => { throw new Error('not stubbed'); } },
    projectService: { get: async () => { throw new Error('not stubbed'); } },
  };
  const service = new SessionService(base, claudeSession, '/workspace', scopeDeps);
  return { service, base, claudeSession };
};

describe('session-handlers', () => {
  it('session.spawn validates the anchor and calls service.spawn', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    expect(spy).toHaveBeenCalledWith({ kind: 'entity', urn: entityUrn('skill', 'foo') });
  });

  it('session.spawn accepts a workspace anchor', async () => {
    const { service } = setup();
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'workspace', workspaceId: 'w1' } });
    expect(spy).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'w1' });
  });

  it('session.spawn accepts a project anchor', async () => {
    const { service } = setup();
    const spy = vi.spyOn(service, 'spawn');
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'project', projectId: 'p1' } });
    expect(spy).toHaveBeenCalledWith({ kind: 'project', projectId: 'p1' });
  });

  it('session.spawn rejects a missing anchor', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({})).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.spawn rejects an anchor with an unknown kind', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({ anchor: { kind: 'bogus' } })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.spawn rejects an entity anchor with an empty urn', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    await expect(h['session.spawn']!({ anchor: { kind: 'entity', urn: '' } })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('session.write validates and forwards sessionId + data', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const spy = vi.spyOn(service, 'write');
    await h['session.write']!({ sessionId: 'entity:urn:skill:foo', data: 'ls\n' });
    expect(spy).toHaveBeenCalledWith('entity:urn:skill:foo', 'ls\n');
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
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const spy = vi.spyOn(service, 'kill');
    await h['session.kill']!({ sessionId: 'entity:urn:skill:foo' });
    expect(spy).toHaveBeenCalledWith('entity:urn:skill:foo');
  });

  it('session.status returns null for an unknown session', async () => {
    const { service } = setup();
    const h = buildSessionHandlers(service);
    const result = await h['session.status']!({ sessionId: 'entity:urn:skill:none' });
    expect(result).toBeNull();
  });

  it('session.status returns the snapshot for a live session', async () => {
    const { service, base } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const h = buildSessionHandlers(service);
    await h['session.spawn']!({ anchor: { kind: 'entity', urn: entityUrn('skill', 'foo') } });
    const result = await h['session.status']!({ sessionId: 'entity:urn:skill:foo' });
    expect(result).toMatchObject({ sessionId: 'entity:urn:skill:foo', status: 'running' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/ipc/session-handlers.test.ts`
Expected: FAIL — `session.spawn` still expects `entityUrn`.

- [ ] **Step 3: Update `session-handlers.ts`**

Replace the file in full:

```ts
import type { IpcHandlers } from './dispatcher.js';
import type { SessionService } from '../application/services/session-service.js';
import type { SessionAnchor } from '../../shared/session.js';
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

function asSessionAnchor(value: unknown, field: string): SessionAnchor {
  const obj = asObject(value, field);
  if (obj['kind'] === 'entity') return { kind: 'entity', urn: asString(obj['urn'], `${field}.urn`) };
  if (obj['kind'] === 'workspace') {
    return { kind: 'workspace', workspaceId: asString(obj['workspaceId'], `${field}.workspaceId`) };
  }
  if (obj['kind'] === 'project') {
    return { kind: 'project', projectId: asString(obj['projectId'], `${field}.projectId`) };
  }
  throw new DomainError(
    'validation',
    `Invalid '${field}': expected {kind:'entity',urn} | {kind:'workspace',workspaceId} | {kind:'project',projectId}`,
  );
}

export function buildSessionHandlers(service: SessionService): IpcHandlers {
  return {
    'session.spawn': async (params) => {
      const raw = asObject(params, 'session.spawn');
      return service.spawn(asSessionAnchor(raw['anchor'], 'anchor'));
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/session-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/session-handlers.ts tests/main/ipc/session-handlers.test.ts
git commit -m "feat: session.spawn IPC handler validates a SessionAnchor"
```

---

## Task 4: Renderer — `SessionPanel` takes an `anchor` prop

**Files:**
- Modify: `src/renderer/components/SessionPanel.tsx`
- Modify: `src/renderer/components/CustomizationEditor.tsx`
- Test: `tests/renderer/components/SessionPanel.test.tsx` (new)

**Interfaces:**
- Consumes: `SessionAnchor` (Task 1).
- Produces: `SessionPanel({ anchor: SessionAnchor })` (was `{ entityUrn: string }`). `SessionPanelLocked` is unchanged (still shown pre-save, before any anchor exists). Consumed by Task 11 (`SessionDialog`, for workspace/project anchors).

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/SessionPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as ipc from '../../../src/renderer/lib/ipc.js';
import { SessionPanel } from '../../../src/renderer/components/SessionPanel.js';

beforeEach(() => {
  vi.restoreAllMocks();
  (window as unknown as { api: unknown }).api = {
    session: { onOutput: () => () => undefined, onExit: () => () => undefined },
  };
});

describe('SessionPanel', () => {
  it('calls session.spawn with the given anchor when opened', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue({
      sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/ws', status: 'running',
    });
    render(<SessionPanel anchor={{ kind: 'workspace', workspaceId: 'w1' }} />);
    await user.click(screen.getByTestId('session-open'));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'workspace', workspaceId: 'w1' } }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/SessionPanel.test.tsx`
Expected: FAIL — `SessionPanel` doesn't accept an `anchor` prop yet.

- [ ] **Step 3: Update `SessionPanel.tsx`**

Change the import and props interface:

```ts
import type { SessionAnchor, SessionSnapshot } from '../../shared/session.js';
```

```ts
interface SessionPanelProps {
  anchor: SessionAnchor;
}
```

Update the component signature and body:

```ts
export function SessionPanel({ anchor }: SessionPanelProps): React.ReactElement {
```

In `handleOpen`, replace:

```ts
  const handleOpen = async (): Promise<void> => {
    setStatus('starting');
    setError(null);
    try {
      const session = await callIpc<SessionSnapshot>('session.spawn', { anchor });
      setSessionId(session.sessionId);
      setStatus(session.status === 'exited' ? 'exited' : 'running');
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      if (dims) {
        void callIpc('session.resize', { sessionId: session.sessionId, cols: dims.cols, rows: dims.rows });
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof IpcCallError ? err.message : String(err));
    }
  };
```

Everything else (the two `useEffect`s wiring `terminal.onData`/`window.api.session.onOutput`/`onExit`, the resize listener, `SessionHeader`/`SessionPanelLocked`, JSX) is unchanged — they only ever reference the local `sessionId` state, which stays a plain string.

- [ ] **Step 4: Update `CustomizationEditor.tsx`'s call site**

Change:

```tsx
        {!isCreate && initial.urn ? <SessionPanel entityUrn={initial.urn} /> : <SessionPanelLocked />}
```

to:

```tsx
        {!isCreate && initial.urn ? <SessionPanel anchor={{ kind: 'entity', urn: initial.urn }} /> : <SessionPanelLocked />}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/SessionPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full jsdom suite to confirm no regression**

Run: `npx vitest --project jsdom run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/SessionPanel.tsx src/renderer/components/CustomizationEditor.tsx \
  tests/renderer/components/SessionPanel.test.tsx
git commit -m "feat: SessionPanel opens sessions by SessionAnchor instead of bare entityUrn"
```

---

## Task 5: `FileBrowserPort` + `NodeFileBrowserAdapter`

**Files:**
- Create: `src/main/application/ports/file-browser-port.ts`
- Create: `src/main/infrastructure/filesystem/node-file-browser-adapter.ts`
- Test: `tests/main/infrastructure/filesystem/node-file-browser-adapter.test.ts`

**Interfaces:**
- Produces: `FileBrowserEntry { name: string; kind: 'file' | 'dir'; size?: number }`; `FilePreview = { previewable: true; content: string; truncated: boolean } | { previewable: false; reason: string }`; `FileBrowserPort { listDir(absPath): Promise<FileBrowserEntry[]>; readFile(absPath): Promise<FilePreview>; realpath(absPath): Promise<string> }`; `NodeFileBrowserAdapter implements FileBrowserPort`. `listDir` sorts directories before files, both alphabetically, and skips dotfiles. `readFile` rejects (as `not_found`) a missing path, treats a file over 5 MB as not-previewable without reading it, and treats a file containing a NUL byte in its first 8000 bytes as binary (not-previewable); a previewable file over 256 KB is truncated to that cap with `truncated: true`. Consumed by Task 6 (`FileBrowserService`).

- [ ] **Step 1: Write the failing tests**

Create `tests/main/infrastructure/filesystem/node-file-browser-adapter.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';

let dir: string;
const adapter = new NodeFileBrowserAdapter();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'file-browser-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('NodeFileBrowserAdapter.listDir', () => {
  it('lists directories before files, both alphabetically, skipping dotfiles', async () => {
    await mkdir(join(dir, 'zeta'));
    await mkdir(join(dir, 'alpha'));
    await writeFile(join(dir, 'b.txt'), 'b');
    await writeFile(join(dir, 'a.txt'), 'a');
    await writeFile(join(dir, '.hidden'), 'x');
    const entries = await adapter.listDir(dir);
    expect(entries.map((e) => e.name)).toEqual(['alpha', 'zeta', 'a.txt', 'b.txt']);
    expect(entries.find((e) => e.name === 'a.txt')?.kind).toBe('file');
    expect(entries.find((e) => e.name === 'alpha')?.kind).toBe('dir');
  });

  it('includes size for files', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const entries = await adapter.listDir(dir);
    expect(entries[0]).toMatchObject({ name: 'a.txt', kind: 'file', size: 5 });
  });

  it('throws not_found for a missing directory', async () => {
    await expect(adapter.listDir(join(dir, 'nope'))).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('NodeFileBrowserAdapter.readFile', () => {
  it('returns previewable content for a small text file', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello world');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({ previewable: true, content: 'hello world', truncated: false });
  });

  it('throws not_found for a missing file', async () => {
    await expect(adapter.readFile(join(dir, 'nope.txt'))).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('treats a file containing a NUL byte as not previewable', async () => {
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    const preview = await adapter.readFile(join(dir, 'bin.dat'));
    expect(preview.previewable).toBe(false);
  });

  it('treats a file over 5MB as not previewable without reading its content', async () => {
    await writeFile(join(dir, 'big.txt'), Buffer.alloc(6 * 1024 * 1024, 'a'));
    const preview = await adapter.readFile(join(dir, 'big.txt'));
    expect(preview).toEqual({ previewable: false, reason: expect.stringContaining('large') });
  });

  it('truncates a previewable file larger than 256KB, marking truncated:true', async () => {
    const content = 'x'.repeat(300 * 1024);
    await writeFile(join(dir, 'medium.txt'), content);
    const preview = await adapter.readFile(join(dir, 'medium.txt'));
    if (!preview.previewable) throw new Error('expected previewable');
    expect(preview.truncated).toBe(true);
    expect(preview.content.length).toBe(256 * 1024);
  });
});

describe('NodeFileBrowserAdapter.realpath', () => {
  it('resolves a symlink to its real target', async () => {
    await mkdir(join(dir, 'real'));
    await symlink(join(dir, 'real'), join(dir, 'link'));
    const resolved = await adapter.realpath(join(dir, 'link'));
    expect(resolved).toBe(await adapter.realpath(join(dir, 'real')));
  });

  it('throws not_found for a path that does not exist', async () => {
    await expect(adapter.realpath(join(dir, 'nope'))).rejects.toMatchObject({ kind: 'not_found' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/infrastructure/filesystem/node-file-browser-adapter.test.ts`
Expected: FAIL — `Cannot find module '.../node-file-browser-adapter.js'`

- [ ] **Step 3: Write the port**

Create `src/main/application/ports/file-browser-port.ts`:

```ts
export interface FileBrowserEntry {
  name: string;
  kind: 'file' | 'dir';
  size?: number;
}

export type FilePreview =
  | { previewable: true; content: string; truncated: boolean }
  | { previewable: false; reason: string };

export interface FileBrowserPort {
  listDir(absPath: string): Promise<FileBrowserEntry[]>;
  readFile(absPath: string): Promise<FilePreview>;
  realpath(absPath: string): Promise<string>;
}
```

- [ ] **Step 4: Implement `NodeFileBrowserAdapter`**

Create `src/main/infrastructure/filesystem/node-file-browser-adapter.ts`:

```ts
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FileBrowserEntry, FileBrowserPort, FilePreview } from '../../application/ports/file-browser-port.js';
import { DomainError } from '../../domain/errors.js';

const MAX_READABLE_BYTES = 5 * 1024 * 1024; // 5MB — above this, never even read the file.
const PREVIEW_CONTENT_CAP = 256 * 1024; // 256KB — previewable content is truncated to this.
const BINARY_SNIFF_BYTES = 8000;

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

export class NodeFileBrowserAdapter implements FileBrowserPort {
  async listDir(absPath: string): Promise<FileBrowserEntry[]> {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(absPath, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Directory not found: ${absPath}`);
      throw err;
    }

    const entries: FileBrowserEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue;
      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, kind: 'dir' });
        continue;
      }
      if (dirent.isFile()) {
        const stat = await fs.stat(join(absPath, dirent.name)).catch(() => null);
        entries.push({ name: dirent.name, kind: 'file', ...(stat ? { size: stat.size } : {}) });
      }
    }

    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(absPath: string): Promise<FilePreview> {
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(absPath);
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `File not found: ${absPath}`);
      throw err;
    }
    if (!stat.isFile()) {
      throw new DomainError('validation', `Not a file: ${absPath}`);
    }
    if (stat.size > MAX_READABLE_BYTES) {
      return { previewable: false, reason: `File is too large to preview (over ${MAX_READABLE_BYTES / (1024 * 1024)}MB)` };
    }

    const buffer = await fs.readFile(absPath);
    const sniffLength = Math.min(buffer.length, BINARY_SNIFF_BYTES);
    if (buffer.subarray(0, sniffLength).includes(0)) {
      return { previewable: false, reason: 'File appears to be binary' };
    }

    const truncated = buffer.length > PREVIEW_CONTENT_CAP;
    const content = buffer.subarray(0, PREVIEW_CONTENT_CAP).toString('utf8');
    return { previewable: true, content, truncated };
  }

  async realpath(absPath: string): Promise<string> {
    try {
      return await fs.realpath(absPath);
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Path not found: ${absPath}`);
      throw err;
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/infrastructure/filesystem/node-file-browser-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/application/ports/file-browser-port.ts src/main/infrastructure/filesystem/node-file-browser-adapter.ts \
  tests/main/infrastructure/filesystem/node-file-browser-adapter.test.ts
git commit -m "feat: add FileBrowserPort and its node:fs adapter"
```

---

## Task 6: `FileBrowserService` — containment guard

**Files:**
- Create: `src/main/application/services/file-browser-service.ts`
- Test: `tests/main/application/services/file-browser-service.test.ts`

**Interfaces:**
- Consumes: `FileBrowserPort` (Task 5).
- Produces: `FileBrowserService { listDir(relPath: string): Promise<FileBrowserEntry[]>; readFile(relPath: string): Promise<FilePreview>; resolveAbsolutePath(relPath: string): Promise<string> }`. Rejects (`DomainError('validation', ...)`) any `relPath` that is absolute, contains a `..` segment, or whose real path (after symlink resolution) falls outside the root's real path — before ever calling the port. Consumed by Task 7 (IPC), Task 12 (renderer, via `resolveAbsolutePath` for "Use as Project").

- [ ] **Step 1: Write the failing tests**

Create `tests/main/application/services/file-browser-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { FileBrowserService } from '../../../../src/main/application/services/file-browser-service.js';
import type { FileBrowserPort } from '../../../../src/main/application/ports/file-browser-port.js';

const ROOT = '/repos/acme';

function fakePort(overrides: Partial<FileBrowserPort> = {}): FileBrowserPort {
  return {
    listDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue({ previewable: true, content: 'x', truncated: false }),
    realpath: vi.fn(async (p: string) => p),
    ...overrides,
  };
}

describe('FileBrowserService', () => {
  it('listDir("") resolves to the root and delegates to the port', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('');
    expect(port.listDir).toHaveBeenCalledWith(ROOT);
  });

  it('listDir("sub/dir") joins onto the root', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('sub/dir');
    expect(port.listDir).toHaveBeenCalledWith('/repos/acme/sub/dir');
  });

  it('readFile delegates the resolved absolute path', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    await service.readFile('a.txt');
    expect(port.readFile).toHaveBeenCalledWith('/repos/acme/a.txt');
  });

  it('rejects an absolute path', async () => {
    const service = new FileBrowserService(fakePort(), ROOT);
    await expect(service.listDir('/etc/passwd')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('rejects a path with a .. segment', async () => {
    const service = new FileBrowserService(fakePort(), ROOT);
    await expect(service.listDir('../secrets')).rejects.toMatchObject({ kind: 'validation' });
    await expect(service.listDir('sub/../../secrets')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('rejects a path whose realpath escapes the root (symlink escape)', async () => {
    const port = fakePort({
      realpath: vi.fn(async (p: string) => (p === ROOT ? ROOT : '/etc/escaped')),
    });
    const service = new FileBrowserService(port, ROOT);
    await expect(service.listDir('link-out')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('does not fail the request when the target does not exist yet (lets listDir/readFile 404 naturally)', async () => {
    const port = fakePort({
      realpath: vi.fn(async (p: string) => {
        if (p === ROOT) return ROOT;
        const err = Object.assign(new Error('not found'), { kind: 'not_found' });
        throw err;
      }),
    });
    const service = new FileBrowserService(port, ROOT);
    await service.listDir('does-not-exist-yet');
    expect(port.listDir).toHaveBeenCalledWith('/repos/acme/does-not-exist-yet');
  });

  it('resolveAbsolutePath returns the same guarded path without calling listDir/readFile', async () => {
    const port = fakePort();
    const service = new FileBrowserService(port, ROOT);
    expect(await service.resolveAbsolutePath('sub')).toBe('/repos/acme/sub');
    expect(port.listDir).not.toHaveBeenCalled();
    expect(port.readFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/services/file-browser-service.test.ts`
Expected: FAIL — `Cannot find module '.../file-browser-service.js'`

- [ ] **Step 3: Implement `FileBrowserService`**

Create `src/main/application/services/file-browser-service.ts`:

```ts
import { isAbsolute, join, sep } from 'node:path';
import type { FileBrowserEntry, FileBrowserPort, FilePreview } from '../ports/file-browser-port.js';
import { DomainError } from '../../domain/errors.js';

function withSep(p: string): string {
  return p.endsWith(sep) ? p : `${p}${sep}`;
}

export class FileBrowserService {
  constructor(
    private readonly port: FileBrowserPort,
    private readonly rootPath: string,
  ) {}

  async listDir(relPath: string): Promise<FileBrowserEntry[]> {
    return this.port.listDir(await this.resolveSafe(relPath));
  }

  async readFile(relPath: string): Promise<FilePreview> {
    return this.port.readFile(await this.resolveSafe(relPath));
  }

  async resolveAbsolutePath(relPath: string): Promise<string> {
    return this.resolveSafe(relPath);
  }

  private async resolveSafe(relPath: string): Promise<string> {
    if (isAbsolute(relPath) || relPath.split(/[/\\]/).includes('..')) {
      throw new DomainError('validation', `Path escapes the workspace root: ${relPath}`);
    }
    const candidate = join(this.rootPath, relPath);
    if (candidate !== this.rootPath && !candidate.startsWith(withSep(this.rootPath))) {
      throw new DomainError('validation', `Path escapes the workspace root: ${relPath}`);
    }

    let real: string;
    try {
      real = await this.port.realpath(candidate);
    } catch (err) {
      if (err instanceof DomainError && err.kind === 'not_found') return candidate;
      throw err;
    }
    const realRoot = await this.port.realpath(this.rootPath).catch(() => this.rootPath);
    if (real !== realRoot && !real.startsWith(withSep(realRoot))) {
      throw new DomainError('validation', `Path escapes the workspace root (symlink): ${relPath}`);
    }
    return candidate;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/services/file-browser-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/application/services/file-browser-service.ts tests/main/application/services/file-browser-service.test.ts
git commit -m "feat: add FileBrowserService with root-containment guard"
```

---

## Task 7: `workspace.listDir`/`workspace.readFile`/`workspace.resolvePath` IPC + composition root wiring

**Files:**
- Modify: `src/main/ipc/workspace-handlers.ts` (plan 1's file)
- Modify: `src/main/ipc/registry.ts` (plan 1's file)
- Modify: `src/main/index.ts`
- Test: `tests/main/ipc/typed-handlers.test.ts`

**Interfaces:**
- Consumes: `FileBrowserService` (Task 6).
- Produces: `buildWorkspaceHandlers` gains a 3rd param `fileBrowserService: FileBrowserService` and three methods: `workspace.listDir({path})`, `workspace.readFile({path})`, `workspace.resolvePath({path}) → {absolutePath}`. `IpcDeps` gains `fileBrowserService: FileBrowserService`. `src/main/index.ts` constructs `fileBrowserService` rooted at the active workspace's `rootPath` (not its `.ai-companion` data dir) and rebuilds it inside `switchActiveWorkspace` alongside `workspaceScoped`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/ipc/typed-handlers.test.ts`:

```ts
import { buildWorkspaceHandlers } from '../../../src/main/ipc/workspace-handlers.js';
import { FileBrowserService } from '../../../src/main/application/services/file-browser-service.js';
```

(These two imports may already be present from plan 1's Task 5 — add only what's missing.) Extend the existing `describe('workspace-handlers', ...)` block's setup to pass a `FileBrowserService` (a fresh `new FileBrowserService({ listDir: vi.fn().mockResolvedValue([]), readFile: vi.fn().mockResolvedValue({previewable:true,content:'x',truncated:false}), realpath: vi.fn(async (p) => p) }, '/repos/acme')`) as the 3rd arg to every `buildWorkspaceHandlers(svc, ...)` call in that block, then add:

```ts
  it('workspace.listDir delegates to fileBrowserService.listDir', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn().mockResolvedValue([{ name: 'a.txt', kind: 'file' }]), readFile: vi.fn(), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    const result = await h['workspace.listDir']!({ path: 'sub' });
    expect(result).toEqual([{ name: 'a.txt', kind: 'file' }]);
  });

  it('workspace.readFile delegates to fileBrowserService.readFile', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn().mockResolvedValue({ previewable: true, content: 'hi', truncated: false }), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    const result = await h['workspace.readFile']!({ path: 'a.txt' });
    expect(result).toEqual({ previewable: true, content: 'hi', truncated: false });
  });

  it('workspace.resolvePath returns the resolved absolute path', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn(), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    const result = await h['workspace.resolvePath']!({ path: 'sub' });
    expect(result).toEqual({ absolutePath: '/repos/acme/sub' });
  });

  it('workspace.listDir rejects a path escaping the root', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn(), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    await expect(h['workspace.listDir']!({ path: '../etc' })).rejects.toMatchObject({ kind: 'validation' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: FAIL — `buildWorkspaceHandlers` doesn't accept a 3rd argument yet.

- [ ] **Step 3: Update `buildWorkspaceHandlers`**

In `src/main/ipc/workspace-handlers.ts`, add the import and parameter:

```ts
import type { FileBrowserService } from '../application/services/file-browser-service.js';
```

```ts
export function buildWorkspaceHandlers(
  service: WorkspaceService,
  switchActiveWorkspace: (id: string) => Promise<Workspace>,
  fileBrowserService: FileBrowserService,
): IpcHandlers {
  return {
    'workspace.list': async () => service.list(),
    'workspace.getActive': async () => service.getActive(),
    'workspace.create': async (params) => {
      const raw = asObject(params, 'workspace.create');
      return service.create({
        name: asString(raw['name'], 'name'),
        rootPath: asString(raw['rootPath'], 'rootPath'),
      });
    },
    'workspace.switchTo': async (params) => {
      const raw = asObject(params, 'workspace.switchTo');
      return switchActiveWorkspace(asString(raw['id'], 'id'));
    },
    'workspace.delete': async (params) => {
      const raw = asObject(params, 'workspace.delete');
      return service.delete(asString(raw['id'], 'id'));
    },
    'workspace.listDir': async (params) => {
      const raw = asObject(params, 'workspace.listDir');
      return fileBrowserService.listDir(typeof raw['path'] === 'string' ? raw['path'] : '');
    },
    'workspace.readFile': async (params) => {
      const raw = asObject(params, 'workspace.readFile');
      return fileBrowserService.readFile(asString(raw['path'], 'path'));
    },
    'workspace.resolvePath': async (params) => {
      const raw = asObject(params, 'workspace.resolvePath');
      const absolutePath = await fileBrowserService.resolveAbsolutePath(asString(raw['path'], 'path'));
      return { absolutePath };
    },
  };
}
```

(`workspace.listDir`'s `path` defaults to `''` — the root — since the tree's initial render lists the root before any node has been expanded, matching `FileBrowserService.listDir('')` from Task 6's own test.)

- [ ] **Step 4: Wire `IpcDeps`**

In `src/main/ipc/registry.ts`, add the import and field:

```ts
import type { FileBrowserService } from '../application/services/file-browser-service.js';
```

```ts
  fileBrowserService: FileBrowserService;
```

Destructure it in `buildHandlers` and pass it as the 3rd arg:

```ts
    ...buildWorkspaceHandlers(workspaceService, switchActiveWorkspace, fileBrowserService),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: PASS

- [ ] **Step 6: Wire the composition root**

In `src/main/index.ts`, add the imports:

```ts
import { NodeFileBrowserAdapter } from './infrastructure/filesystem/node-file-browser-adapter.js';
import { FileBrowserService } from './application/services/file-browser-service.js';
```

Right after `let workspaceScoped: WorkspaceScopedServices = buildWorkspaceScopedServices(activeDataDir, sharedDeps);`, add:

```ts
  const fileBrowserPort = new NodeFileBrowserAdapter();
  let fileBrowserService = new FileBrowserService(fileBrowserPort, activeWorkspace.rootPath);
```

In `buildDeps()`, add `fileBrowserService,` to the returned object. In `switchActiveWorkspace`, right after `workspaceScoped = buildWorkspaceScopedServices(dataDir, sharedDeps);`, add:

```ts
    fileBrowserService = new FileBrowserService(fileBrowserPort, target.rootPath);
```

(`fileBrowserPort` itself is stateless and never needs rebuilding — only `fileBrowserService`'s root does.)

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck`.

```bash
git add src/main/ipc/workspace-handlers.ts src/main/ipc/registry.ts src/main/index.ts tests/main/ipc/typed-handlers.test.ts
git commit -m "feat: wire workspace.listDir/readFile/resolvePath IPC and FileBrowserService into the composition root"
```

---

## Task 8: Renderer — `use-file-browser` hooks

**Files:**
- Create: `src/renderer/hooks/use-file-browser.ts`
- Test: `tests/renderer/hooks/use-file-browser.test.tsx`

**Interfaces:**
- Consumes: `callIpc`.
- Produces: `useDirListing(path: string)` (query `['workspace', 'listDir', path]`), `useFilePreview(path: string | null)` (query `['workspace', 'readFile', path]`, `enabled: path !== null`), `useResolveAbsolutePath()` (mutation calling `workspace.resolvePath`). Consumed by Task 9 (`FolderTree`), Task 10 (`FilePreviewPane`), Task 12 (`WorkspaceScreen`'s "Use as Project").

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/hooks/use-file-browser.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../src/renderer/lib/ipc.js';
import { useDirListing, useFilePreview, useResolveAbsolutePath } from '../../../src/renderer/hooks/use-file-browser.js';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('use-file-browser', () => {
  it('useDirListing fetches via workspace.listDir with the given path', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([{ name: 'a.txt', kind: 'file' }]);
    const { result } = renderHook(() => useDirListing('sub'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ name: 'a.txt', kind: 'file' }]));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.listDir', { path: 'sub' });
  });

  it('useDirListing does not fetch when enabled:false', () => {
    const spy = vi.spyOn(ipc, 'callIpc');
    const { result } = renderHook(() => useDirListing('sub', { enabled: false }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });

  it('useFilePreview is disabled when path is null', () => {
    const spy = vi.spyOn(ipc, 'callIpc');
    const { result } = renderHook(() => useFilePreview(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
  });

  it('useFilePreview fetches via workspace.readFile when path is set', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: true, content: 'hi', truncated: false });
    const { result } = renderHook(() => useFilePreview('a.txt'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ previewable: true, content: 'hi', truncated: false }));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.readFile', { path: 'a.txt' });
  });

  it('useResolveAbsolutePath calls workspace.resolvePath', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue({ absolutePath: '/repos/acme/sub' });
    const { result } = renderHook(() => useResolveAbsolutePath(), { wrapper });
    const res = await result.current.mutateAsync('sub');
    expect(spy).toHaveBeenCalledWith('workspace.resolvePath', { path: 'sub' });
    expect(res).toBe('/repos/acme/sub');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/hooks/use-file-browser.test.tsx`
Expected: FAIL — `Cannot find module '.../use-file-browser.js'`

- [ ] **Step 3: Implement the hooks**

Create `src/renderer/hooks/use-file-browser.ts`:

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type { FileBrowserEntry, FilePreview } from '../../shared/file-browser.js';

export function useDirListing(path: string, options: { enabled?: boolean } = {}) {
  return useQuery<FileBrowserEntry[]>({
    queryKey: ['workspace', 'listDir', path] as const,
    queryFn: () => callIpc<FileBrowserEntry[]>('workspace.listDir', { path }),
    enabled: options.enabled ?? true,
  });
}

export function useFilePreview(path: string | null) {
  return useQuery<FilePreview>({
    queryKey: ['workspace', 'readFile', path] as const,
    queryFn: () => callIpc<FilePreview>('workspace.readFile', { path }),
    enabled: path !== null,
  });
}

export function useResolveAbsolutePath() {
  return useMutation({
    mutationFn: async (path: string): Promise<string> => {
      const { absolutePath } = await callIpc<{ absolutePath: string }>('workspace.resolvePath', { path });
      return absolutePath;
    },
  });
}
```

This task also needs a tiny shared type file the main process doesn't own a renderer-facing copy of yet — create `src/shared/file-browser.ts`:

```ts
export interface FileBrowserEntry {
  name: string;
  kind: 'file' | 'dir';
  size?: number;
}

export type FilePreview =
  | { previewable: true; content: string; truncated: boolean }
  | { previewable: false; reason: string };
```

And re-point `src/main/application/ports/file-browser-port.ts` (Task 5) to import `FileBrowserEntry`/`FilePreview` from `../../../shared/file-browser.js` instead of declaring its own copies, so main and renderer share one definition:

```ts
import type { FileBrowserEntry, FilePreview } from '../../../shared/file-browser.js';

export type { FileBrowserEntry, FilePreview };

export interface FileBrowserPort {
  listDir(absPath: string): Promise<FileBrowserEntry[]>;
  readFile(absPath: string): Promise<FilePreview>;
  realpath(absPath: string): Promise<string>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/hooks/use-file-browser.test.tsx`
Expected: PASS

- [ ] **Step 5: Verify Task 5/6's tests still pass after the type re-point**

Run: `npx vitest run tests/main/infrastructure/filesystem/node-file-browser-adapter.test.ts tests/main/application/services/file-browser-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/use-file-browser.ts src/shared/file-browser.ts src/main/application/ports/file-browser-port.ts \
  tests/renderer/hooks/use-file-browser.test.tsx
git commit -m "feat: add react-query hooks for the workspace file browser"
```

---

## Task 9: Renderer — extend `use-projects` with `useDeleteProject`

**Files:**
- Modify: `src/renderer/hooks/use-projects.ts` (plan 2's file)
- Test: `tests/renderer/hooks/use-projects.test.tsx` (plan 2's file)

**Interfaces:**
- Produces: `useDeleteProject()` mutation calling `project.delete`, invalidating `['project', 'list']`. Consumed by Task 12 (`WorkspaceScreen`'s Project list row).

- [ ] **Step 1: Write the failing test**

Add to `tests/renderer/hooks/use-projects.test.tsx`:

```ts
import { useDeleteProject } from '../../../src/renderer/hooks/use-projects.js';
```

```ts
  it('useDeleteProject calls project.delete and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteProject(), { wrapper });
    await result.current.mutateAsync('p1');
    expect(spy).toHaveBeenCalledWith('project.delete', { id: 'p1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['project', 'list'] });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/hooks/use-projects.test.tsx`
Expected: FAIL — `useDeleteProject` doesn't exist yet.

- [ ] **Step 3: Add the hook**

In `src/renderer/hooks/use-projects.ts`, add:

```ts
export function useDeleteProject() {
  return useMutation({
    mutationFn: (id: string) => callIpc<void>('project.delete', { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/hooks/use-projects.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/use-projects.ts tests/renderer/hooks/use-projects.test.tsx
git commit -m "feat: add useDeleteProject hook"
```

---

## Task 10: Renderer — `FolderTree` and `FilePreviewPane`

**Files:**
- Create: `src/renderer/components/workspace/FolderTree.tsx`
- Create: `src/renderer/components/workspace/FilePreviewPane.tsx`
- Test: `tests/renderer/components/workspace/FolderTree.test.tsx`
- Test: `tests/renderer/components/workspace/FilePreviewPane.test.tsx`

**Interfaces:**
- Consumes: `useDirListing`, `useResolveAbsolutePath` (Task 8), `FileBrowserEntry` (`src/shared/file-browser.ts`).
- Produces: `FolderTree({ onSelectFile: (relPath: string) => void; onUseAsProject: (absPath: string) => void })` — a root-rooted, on-demand expanding tree. `FilePreviewPane({ path: string | null })` — renders the preview or a not-previewable placeholder. Consumed by Task 12 (`WorkspaceScreen`).

- [ ] **Step 1: Write the failing `FolderTree` test**

Create `tests/renderer/components/workspace/FolderTree.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { FolderTree } from '../../../../src/renderer/components/workspace/FolderTree.js';

const renderTree = (onSelectFile = vi.fn(), onUseAsProject = vi.fn()) =>
  render(
    <QueryClientProvider client={queryClient}>
      <FolderTree onSelectFile={onSelectFile} onUseAsProject={onUseAsProject} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('FolderTree', () => {
  it('lists the root on mount', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }];
      }
      return [];
    });
    renderTree();
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(await screen.findByText('README.md')).toBeInTheDocument();
  });

  it('expands a folder node on click, fetching its children', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'src', kind: 'dir' }];
      if (method === 'workspace.listDir' && path === 'src') return [{ name: 'index.ts', kind: 'file' }];
      return [];
    });
    renderTree();
    await user.click(await screen.findByText('src'));
    expect(await screen.findByText('index.ts')).toBeInTheDocument();
  });

  it('calls onSelectFile with the file\'s relative path when clicked', async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([{ name: 'README.md', kind: 'file' }]);
    renderTree(onSelectFile);
    await user.click(await screen.findByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith('README.md');
  });

  it('"Use as Project" on a folder node calls onUseAsProject with the resolved absolute path', async () => {
    const user = userEvent.setup();
    const onUseAsProject = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.listDir') return [{ name: 'apps', kind: 'dir' }];
      if (method === 'workspace.resolvePath') return { absolutePath: '/repos/monorepo/apps' };
      return [];
    });
    renderTree(vi.fn(), onUseAsProject);
    await user.click(await screen.findByTestId('tree-node-use-as-project-apps'));
    await waitFor(() => expect(onUseAsProject).toHaveBeenCalledWith('/repos/monorepo/apps'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/workspace/FolderTree.test.tsx`
Expected: FAIL — `Cannot find module '.../FolderTree.js'`

- [ ] **Step 3: Implement `FolderTree`**

Create `src/renderer/components/workspace/FolderTree.tsx`:

```tsx
import { useState } from 'react';
import { Box, Collapse, List, ListItemButton, ListItemText, Stack, Tooltip } from '@mui/material';
import { ChevronRight, ChevronDown, Folder, File as FileIcon, FolderInput } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { useDirListing, useResolveAbsolutePath } from '../../hooks/use-file-browser.js';
import type { FileBrowserEntry } from '../../../shared/file-browser.js';

interface FolderTreeProps {
  onSelectFile: (relPath: string) => void;
  onUseAsProject: (absolutePath: string) => void;
}

interface TreeNodeProps {
  entry: FileBrowserEntry;
  relPath: string;
  depth: number;
  onSelectFile: (relPath: string) => void;
  onUseAsProject: (absolutePath: string) => void;
}

function TreeNode({ entry, relPath, depth, onSelectFile, onUseAsProject }: TreeNodeProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { data: children } = useDirListing(relPath, { enabled: expanded });
  const resolveAbsolutePath = useResolveAbsolutePath();

  const handleUseAsProject = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    const absolutePath = await resolveAbsolutePath.mutateAsync(relPath);
    onUseAsProject(absolutePath);
  };

  return (
    <>
      <ListItemButton
        dense
        sx={{ pl: 1.5 + depth * 2 }}
        onClick={() => (entry.kind === 'dir' ? setExpanded((v) => !v) : onSelectFile(relPath))}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
          {entry.kind === 'dir' ? (
            <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
          ) : (
            <Box sx={{ width: 14 }} />
          )}
          <Icon glyph={entry.kind === 'dir' ? Folder : FileIcon} size={14} />
          <ListItemText
            primary={entry.name}
            slotProps={{ primary: { noWrap: true, sx: { fontSize: '0.85rem' } } }}
          />
        </Stack>
        {entry.kind === 'dir' && (
          <Tooltip title="Usar como Project">
            <Box
              component="span"
              role="button"
              aria-label={`Usar ${entry.name} como Project`}
              data-testid={`tree-node-use-as-project-${entry.name}`}
              onClick={(e) => void handleUseAsProject(e)}
              sx={{ display: 'inline-flex', p: 0.5 }}
            >
              <Icon glyph={FolderInput} size={14} />
            </Box>
          </Tooltip>
        )}
      </ListItemButton>
      {entry.kind === 'dir' && (
        <Collapse in={expanded} unmountOnExit>
          <List disablePadding>
            {(children ?? []).map((child) => (
              <TreeNode
                key={child.name}
                entry={child}
                relPath={relPath ? `${relPath}/${child.name}` : child.name}
                depth={depth + 1}
                onSelectFile={onSelectFile}
                onUseAsProject={onUseAsProject}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}

export function FolderTree({ onSelectFile, onUseAsProject }: FolderTreeProps): React.ReactElement {
  const { data: rootEntries } = useDirListing('');

  return (
    <List disablePadding data-testid="folder-tree">
      {(rootEntries ?? []).map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          relPath={entry.name}
          depth={0}
          onSelectFile={onSelectFile}
          onUseAsProject={onUseAsProject}
        />
      ))}
    </List>
  );
}
```

(`useDirListing(relPath, { enabled: expanded })` — Task 8's `enabled` option — means a collapsed node's children are never fetched until the first expand; react-query caches the result afterward, so re-collapsing and re-expanding doesn't re-fetch.)

- [ ] **Step 4: Run the `FolderTree` test to verify it passes**

Run: `npx vitest run tests/renderer/components/workspace/FolderTree.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing `FilePreviewPane` test**

Create `tests/renderer/components/workspace/FilePreviewPane.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { FilePreviewPane } from '../../../../src/renderer/components/workspace/FilePreviewPane.js';

const renderPane = (path: string | null) =>
  render(
    <QueryClientProvider client={queryClient}>
      <FilePreviewPane path={path} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('FilePreviewPane', () => {
  it('shows an empty placeholder when no file is selected', () => {
    renderPane(null);
    expect(screen.getByTestId('file-preview-empty')).toBeInTheDocument();
  });

  it('renders previewable text content', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: true, content: 'hello world', truncated: false });
    renderPane('a.txt');
    expect(await screen.findByText('hello world')).toBeInTheDocument();
  });

  it('shows a truncated notice when the preview was cut off', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: true, content: 'partial', truncated: true });
    renderPane('big.txt');
    expect(await screen.findByTestId('file-preview-truncated-notice')).toBeInTheDocument();
  });

  it('shows the not-previewable placeholder with the given reason', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: false, reason: 'File appears to be binary' });
    renderPane('image.png');
    expect(await screen.findByText('File appears to be binary')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/workspace/FilePreviewPane.test.tsx`
Expected: FAIL — `Cannot find module '.../FilePreviewPane.js'`

- [ ] **Step 7: Implement `FilePreviewPane`**

Create `src/renderer/components/workspace/FilePreviewPane.tsx`:

```tsx
import { Alert, Box, Typography } from '@mui/material';
import { FileX } from 'lucide-react';
import { EmptyState } from '../ds/EmptyState.js';
import { useFilePreview } from '../../hooks/use-file-browser.js';
import { fonts } from '../../tokens.js';

interface FilePreviewPaneProps {
  path: string | null;
}

export function FilePreviewPane({ path }: FilePreviewPaneProps): React.ReactElement {
  const { data: preview, isLoading } = useFilePreview(path);

  if (path === null) {
    return (
      <Box data-testid="file-preview-empty">
        <EmptyState glyph={FileX} title="Nenhum arquivo selecionado" description="Escolha um arquivo na árvore para visualizar o conteúdo." testId="file-preview-empty-state" />
      </Box>
    );
  }

  if (isLoading || !preview) {
    return <Box data-testid="file-preview-loading" sx={{ p: 2 }} />;
  }

  if (!preview.previewable) {
    return (
      <Box data-testid="file-preview-not-previewable" sx={{ p: 2 }}>
        <EmptyState glyph={FileX} title="Não é possível pré-visualizar" description={preview.reason} testId="file-preview-reason" />
      </Box>
    );
  }

  return (
    <Box data-testid="file-preview-content">
      {preview.truncated && (
        <Alert severity="info" data-testid="file-preview-truncated-notice" sx={{ mb: 1.5 }}>
          Arquivo grande — mostrando apenas o início.
        </Alert>
      )}
      <Typography
        component="pre"
        sx={{
          fontFamily: fonts.mono,
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          m: 0,
        }}
      >
        {preview.content}
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/workspace/FilePreviewPane.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/workspace/FolderTree.tsx src/renderer/components/workspace/FilePreviewPane.tsx \
  tests/renderer/components/workspace/FolderTree.test.tsx tests/renderer/components/workspace/FilePreviewPane.test.tsx
git commit -m "feat: add FolderTree and FilePreviewPane workspace-browsing components"
```

---

## Task 11: Renderer — `SessionDialog`

**Files:**
- Create: `src/renderer/components/workspace/SessionDialog.tsx`
- Test: `tests/renderer/components/workspace/SessionDialog.test.tsx`

**Interfaces:**
- Consumes: `SessionPanel` (Task 4), `SessionAnchor`.
- Produces: `SessionDialog({ open: boolean; anchor: SessionAnchor | null; title: string; onClose: () => void })` — a MUI `Dialog` embedding `SessionPanel`. Consumed by Task 12 (`WorkspaceScreen`'s "Open session" actions).

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/workspace/SessionDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionDialog } from '../../../../src/renderer/components/workspace/SessionDialog.js';

beforeEach(() => {
  (window as unknown as { api: unknown }).api = {
    session: { onOutput: () => () => undefined, onExit: () => () => undefined },
  };
});

describe('SessionDialog', () => {
  it('renders nothing interactive when closed', () => {
    render(<SessionDialog open={false} anchor={{ kind: 'workspace', workspaceId: 'w1' }} title="Workspace" onClose={vi.fn()} />);
    expect(screen.queryByTestId('session-panel')).not.toBeInTheDocument();
  });

  it('renders the SessionPanel with the given anchor when open', () => {
    render(<SessionDialog open anchor={{ kind: 'project', projectId: 'p1' }} title="acme" onClose={vi.fn()} />);
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/workspace/SessionDialog.test.tsx`
Expected: FAIL — `Cannot find module '.../SessionDialog.js'`

- [ ] **Step 3: Implement `SessionDialog`**

Create `src/renderer/components/workspace/SessionDialog.tsx`:

```tsx
import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import { X } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { SessionPanel } from '../SessionPanel.js';
import type { SessionAnchor } from '../../../shared/session.js';

interface SessionDialogProps {
  open: boolean;
  anchor: SessionAnchor | null;
  title: string;
  onClose: () => void;
}

export function SessionDialog({ open, anchor, title, onClose }: SessionDialogProps): React.ReactElement {
  return (
    <Dialog open={open && anchor !== null} onClose={onClose} maxWidth="md" fullWidth data-testid="session-dialog">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {title}
        <IconButton onClick={onClose} size="small" aria-label="Fechar">
          <Icon glyph={X} size={16} />
        </IconButton>
      </DialogTitle>
      <DialogContent>{anchor && <SessionPanel anchor={anchor} />}</DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/workspace/SessionDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/workspace/SessionDialog.tsx tests/renderer/components/workspace/SessionDialog.test.tsx
git commit -m "feat: add SessionDialog for workspace/project-anchored sessions"
```

---

## Task 12: Renderer — `WorkspaceScreen` and nav wiring

**Files:**
- Create: `src/renderer/screens/workspace/WorkspaceScreen.tsx`
- Modify: `src/renderer/components/shell/nav.ts`
- Modify: `src/renderer/screens/Main.tsx`
- Test: `tests/renderer/screens/workspace/WorkspaceScreen.test.tsx`

**Interfaces:**
- Consumes: `useActiveWorkspace` (plan 1), `useProjects`/`useFindOrCreateProjectByPath`/`useDeleteProject` (plan 2 + Task 9), `FolderTree`/`FilePreviewPane` (Task 10), `SessionDialog` (Task 11).
- Produces: `WorkspaceScreen(): React.ReactElement` — active-workspace header with "Abrir sessão" (workspace anchor), a `Project` list (each row: "Abrir sessão" with a project anchor, delete), the folder tree + preview pane side by side, and "Use as Project" wired from the tree to `useFindOrCreateProjectByPath`. `Area` (`nav.ts`) gains `'workspace'`; `Main.tsx`'s `screenFor` renders `<WorkspaceScreen />` for it.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/screens/workspace/WorkspaceScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { WorkspaceScreen } from '../../../../src/renderer/screens/workspace/WorkspaceScreen.js';

const activeWorkspace = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const projects = [{ id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '' }];

const renderScreen = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen />
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return activeWorkspace;
    if (method === 'project.list') return projects;
    if (method === 'workspace.listDir') return [];
    return undefined;
  });
});

describe('WorkspaceScreen', () => {
  it('shows the active workspace name and root path', async () => {
    renderScreen();
    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(await screen.findByText('/home/u')).toBeInTheDocument();
  });

  it('lists every registered project with an "Abrir sessão" action', async () => {
    renderScreen();
    expect(await screen.findByText('acme')).toBeInTheDocument();
    expect(screen.getByTestId('project-open-session-p1')).toBeInTheDocument();
  });

  it('opening a session on the workspace root spawns with a workspace anchor', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByTestId('workspace-open-session'));
    expect(await screen.findByTestId('session-dialog')).toBeInTheDocument();
  });

  it('opening a session on a project row spawns with a project anchor', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByTestId('project-open-session-p1'));
    expect(await screen.findByTestId('session-dialog')).toBeInTheDocument();
  });

  it('deleting a project calls project.delete', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByTestId('project-delete-p1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('project.delete', { id: 'p1' }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/screens/workspace/WorkspaceScreen.test.tsx`
Expected: FAIL — `Cannot find module '.../WorkspaceScreen.js'`

- [ ] **Step 3: Implement `WorkspaceScreen`**

Create `src/renderer/screens/workspace/WorkspaceScreen.tsx`:

```tsx
import { useState } from 'react';
import { Box, Button, Container, Divider, IconButton, List, ListItem, ListItemText, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { SquareTerminal, Trash2 } from 'lucide-react';
import { fonts } from '../../tokens.js';
import { Icon } from '../../components/ds/Icon.js';
import { Kicker } from '../../components/ds/Kicker.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { FolderTree } from '../../components/workspace/FolderTree.js';
import { FilePreviewPane } from '../../components/workspace/FilePreviewPane.js';
import { SessionDialog } from '../../components/workspace/SessionDialog.js';
import { useActiveWorkspace } from '../../hooks/use-workspaces.js';
import { useDeleteProject, useFindOrCreateProjectByPath, useProjects } from '../../hooks/use-projects.js';
import type { SessionAnchor } from '../../../shared/session.js';

export function WorkspaceScreen(): React.ReactElement {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: projects = [] } = useProjects();
  const findOrCreateProject = useFindOrCreateProjectByPath();
  const deleteProject = useDeleteProject();

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionAnchor, setSessionAnchor] = useState<SessionAnchor | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');

  const openSession = (anchor: SessionAnchor, title: string): void => {
    setSessionAnchor(anchor);
    setSessionTitle(title);
  };

  return (
    <Container component="main" data-testid="workspace-screen" maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader kicker="Workspace" title={activeWorkspace?.name ?? '…'} subtitle={activeWorkspace?.rootPath ?? ''} />

      <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="subtitle2">{activeWorkspace?.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: fonts.mono }}>
            {activeWorkspace?.rootPath}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Icon glyph={SquareTerminal} size={16} />}
          data-testid="workspace-open-session"
          disabled={!activeWorkspace}
          onClick={() =>
            activeWorkspace && openSession({ kind: 'workspace', workspaceId: activeWorkspace.id }, activeWorkspace.name)
          }
        >
          Abrir sessão
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Kicker>Projects</Kicker>
        <List dense disablePadding sx={{ mt: 1 }}>
          {projects.map((p) => (
            <ListItem
              key={p.id}
              divider
              secondaryAction={
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Abrir sessão">
                    <IconButton
                      edge="end"
                      size="small"
                      data-testid={`project-open-session-${p.id}`}
                      onClick={() => openSession({ kind: 'project', projectId: p.id }, p.name)}
                    >
                      <Icon glyph={SquareTerminal} size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remover">
                    <IconButton
                      edge="end"
                      size="small"
                      data-testid={`project-delete-${p.id}`}
                      onClick={() => void deleteProject.mutateAsync(p.id)}
                    >
                      <Icon glyph={Trash2} size={16} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              }
            >
              <ListItemText
                primary={p.name}
                secondary={<Box component="code" sx={{ fontFamily: fonts.mono }}>{p.path}</Box>}
              />
            </ListItem>
          ))}
        </List>
      </Paper>

      <Paper variant="outlined" sx={{ p: 0, display: 'flex', minHeight: 420 }}>
        <Box sx={{ width: 320, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
          <FolderTree
            onSelectFile={setSelectedFile}
            onUseAsProject={(absolutePath) => void findOrCreateProject.mutateAsync(absolutePath)}
          />
        </Box>
        <Divider orientation="vertical" flexItem />
        <Box sx={{ flexGrow: 1, p: 2, overflow: 'auto' }}>
          <FilePreviewPane path={selectedFile} />
        </Box>
      </Paper>

      <SessionDialog
        open={sessionAnchor !== null}
        anchor={sessionAnchor}
        title={sessionTitle}
        onClose={() => setSessionAnchor(null)}
      />
    </Container>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/screens/workspace/WorkspaceScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the new nav area**

In `src/renderer/components/shell/nav.ts`:

```ts
import {
  House, SlidersHorizontal, Puzzle, Activity, Sparkles, Bot,
  Webhook, NotebookPen, Store, Plug, FolderTree as FolderTreeIcon, type LucideIcon,
} from 'lucide-react';

export type Area = 'inicio' | 'workspace' | 'biblioteca' | 'plugins' | 'diagnostico';
```

```ts
export type Nav =
  | { area: 'inicio' }
  | { area: 'workspace' }
  | { area: 'biblioteca'; sub: LibrarySub }
  | { area: 'plugins'; sub: PluginsSub }
  | { area: 'diagnostico' };
```

Add to `NAV_AREAS` (after `inicio`, before `biblioteca`):

```ts
  { area: 'workspace', label: 'Workspace', glyph: FolderTreeIcon },
```

(`defaultSubFor` needs no change — its `if`/`else if` chain already falls through to `{ area }` for any area without subs, which now correctly includes `'workspace'`.)

In `src/renderer/screens/Main.tsx`:

```ts
import { WorkspaceScreen } from './workspace/WorkspaceScreen.js';
```

```ts
    case 'workspace':
      return <WorkspaceScreen />;
```

(Add this case right after the `'inicio'` case in `screenFor`'s switch.)

- [ ] **Step 6: Run the full jsdom suite to confirm no regression**

Run: `npx vitest --project jsdom run`
Expected: PASS

- [ ] **Step 7: Manual smoke check**

Run: `npm run dev`. Click the new "Workspace" tab. Confirm: the active workspace's name/path show; the folder tree lists your real home directory's contents (dotfiles hidden); clicking a folder expands it; clicking a text file shows its content in the preview pane; clicking a large/binary file shows the not-previewable placeholder; the "Use as Project" icon on a folder registers a `Project` (check `~/.ai-companion/projects.json`, or switch to the Instructions screen and confirm it appears in the project picker from plan 2); "Abrir sessão" at the workspace-root level and on a Project row each open a terminal in the right directory.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/screens/workspace/WorkspaceScreen.tsx src/renderer/components/shell/nav.ts src/renderer/screens/Main.tsx \
  tests/renderer/screens/workspace/WorkspaceScreen.test.tsx
git commit -m "feat: add the Workspace screen (folder browser, projects, sessions)"
```

---

## Task 13: Update reference docs

**Files:**
- Modify: `docs/reference/architecture.md`
- Modify: `docs/reference/ipc-contract.md`
- Modify: `docs/superpowers/plans/2026-08-21-embedded-claude-sessions.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Document `FileBrowserService` and the Workspace screen**

In `docs/reference/architecture.md`'s "Workspace / Project" section (added by plan 1, extended by plan 2), append:

```markdown
`FileBrowserPort` (`listDir`/`readFile`/`realpath`, implemented by `NodeFileBrowserAdapter` via
`node:fs/promises`) is wrapped by `FileBrowserService`, which resolves a caller-supplied path relative to
the active workspace's `rootPath` and rejects anything escaping it (`..`, an absolute path, or a symlink
resolving outside the root) before touching the filesystem. Read-only: no write/rename/delete/move
support. Re-created on every workspace switch, alongside the Entity-backed graph, but rooted at the raw
`rootPath` rather than `<rootPath>/.ai-companion` — it browses the author's real files, not the app's own
data.

`Session`s can now anchor on an entity, a workspace, or a project (`SessionAnchor` in
`src/shared/session.ts`) — `SessionService` keys live sessions by `sessionAnchorKey(anchor)` instead of by
entity urn alone, so "one live session per anchor" replaces "one live session per entity". The Workspace
screen's "Abrir sessão" actions (workspace-root and per-`Project`) and the entity-anchored flow from the
Customization editor both go through the same `SessionService`/`session.spawn` surface.
```

- [ ] **Step 2: Update the IPC contract**

In `docs/reference/ipc-contract.md`:

Add to the `workspace.*` table (added by plan 1):

```markdown
| `workspace.listDir` | `{ path?: string }` | `FileBrowserEntry[]` | Lists a directory relative to the active workspace's root (`path` defaults to `''`, the root itself). Rejects paths escaping the root. |
| `workspace.readFile` | `{ path: string }` | `FilePreview` | Reads a file for preview. `{previewable:false, reason}` for binary/oversized files instead of an error. |
| `workspace.resolvePath` | `{ path: string }` | `{ absolutePath: string }` | Resolves a workspace-relative path to an absolute one (used by "Use as Project"), applying the same containment guard. |
```

Update `session.spawn`'s row (from plan 1's original embedded-sessions documentation, if present, or add fresh):

```markdown
| `session.spawn` | `{ anchor: SessionAnchor }` | `SessionSnapshot` | `SessionAnchor = {kind:'entity',urn} \| {kind:'workspace',workspaceId} \| {kind:'project',projectId}`. One live session per anchor. |
```

- [ ] **Step 3: Close the loop on the embedded-sessions design doc**

`docs/superpowers/plans/2026-08-21-embedded-claude-sessions.md` already carries a superseded-note (per this spec's §3 cross-reference) pointing at the Workspace/Project spec for the `SessionAnchor` generalization. Find that note and append one line confirming it shipped:

```markdown
> **Implemented:** see `docs/superpowers/plans/2026-08-22-workspace-filebrowser-sessions.md` (plan 3 of the
> Workspace/Project scoping spec) — `session.spawn` now takes a `SessionAnchor`, as anticipated here.
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/architecture.md docs/reference/ipc-contract.md docs/superpowers/plans/2026-08-21-embedded-claude-sessions.md
git commit -m "docs: document the file browser, Workspace screen, and SessionAnchor generalization"
```

---

## Final verification

- [ ] Run `npm test` — both `node` and `jsdom` projects pass.
- [ ] Run `npm run lint` — clean.
- [ ] Run `npm run typecheck` — clean.
- [ ] Repeat Task 12 Step 7's manual smoke check end-to-end, including switching workspaces (plan 1's switcher) and confirming the folder tree/preview pane re-root to the new workspace, and every "Abrir sessão" entry point (entity editor, workspace root, project row) opens a working terminal in the correct directory.
