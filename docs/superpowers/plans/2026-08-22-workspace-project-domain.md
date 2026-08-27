# Workspace/Project Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `Workspace` and `Project` as first-class, non-synced bounded-context entities with their own JSON registries, wire `WorkspaceService`/`ProjectService` and `workspace.*`/`project.*` IPC, and extract `src/main/index.ts`'s composition root into a re-invocable function so switching the active workspace actually rebuilds the Entity-backed service graph (skills/agents/instructions/sessions/adapters) — then give the author a minimal switcher UI to exercise it end-to-end.

**Architecture:** New `workspace` bounded context (`domain-free` shared types / `application/{ports,services}` / `infrastructure` / `ipc`) mirroring the existing `entity`/`session` hexagonal split. Both registries are flat JSON files (`~/.ai-companion/workspaces.json`, `<active-workspace-root>/.ai-companion/projects.json`) following the exact `FsSettingsRepository` load/save/atomic-rename pattern — no new storage abstraction. The composition root's workspace-scoped construction block is extracted into `buildWorkspaceScopedServices(dataDir, shared)`, a pure, unit-testable function; `src/main/index.ts` holds the result behind a mutable binding and rebuilds the IPC dispatcher whenever `workspace.switchTo` fires.

**Tech Stack:** TypeScript (strict), Electron main process, Vitest (`node`/`jsdom` projects), `node:crypto` (`randomUUID`), `node:fs/promises`, React + `@tanstack/react-query` (renderer), MUI (`Menu`/`MenuItem`) for the switcher.

**Spec:** `docs/superpowers/specs/2026-08-22-workspace-project-scope-design.md` — this is **plan 1 of 3** for that spec. It implements §2.1–2.4, §2.6, §2.11 (only the existing-flow half, see "Out of scope"), most of §3's architecture bullets (registries, `WorkspaceService`/`ProjectService`, IPC, composition-root extraction), and data flows §4.1–§4.3 and part of §4.5. It does **not** implement:

- §2.7–2.9, §2.12 and the rest of §3/§4 that depend on `Entity.scopeId`/`resolveScopePath`/flattened `Instruction`/`SessionAnchor` — that is **plan 2** (`docs/superpowers/plans/2026-08-22-entity-generic-scoping.md`) and **plan 3** (file browser, full Workspace screen, `SessionAnchor`).
- Nothing in this plan touches `src/shared/entity.ts`, `entity-schema.ts`, the adapters, or `SessionService.resolveCwd` — `ProjectInstruction.repoPath` keeps working exactly as today throughout this plan. `Project` and `Workspace` are inert registries with no consumer yet; that's plan 2's job.

This plan's own deliverable is fully testable in isolation: after it lands, you can create a second workspace pointed at an empty folder via the UI, switch to it, watch the Skills/Agents/Instructions screens go empty (a fresh `.ai-companion` data dir), switch back, and see the original data untouched. `project.*` CRUD works end-to-end over IPC even though no renderer screen consumes it yet (plan 2 adds the Project-picker UI).

## Global Constraints

- Imports use `.js` extensions (ESM + `verbatimModuleSyntax`).
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are on — build objects with conditional spreads (`...(x !== undefined ? { x } : {})`), never assign a bare `undefined` to an optional field.
- Services depend on **ports**, never directly on `node:fs`/`electron` — concrete I/O lives in `infrastructure/`.
- No new dependencies (MUI `Menu`/`MenuItem` and `@tanstack/react-query` are already in `package.json`).
- IDs use `randomUUID()` from `node:crypto` (existing convention, see `entity-service.ts`'s callers / `hook-service.ts`).
- `npm test` (both `node` and `jsdom` projects), `npm run lint`, `npm run typecheck` must be green before this plan is considered done — the project is past the spike phase (CLAUDE.md: green lint+typecheck+tests is a release gate, no exceptions).
- `src/main/index.ts` itself is outside `vitest.config.ts`'s coverage `include` list (only `src/main/application/**`, `src/main/ipc/**`, `src/main/infrastructure/**`, `src/renderer/screens/**`, `src/renderer/App.tsx` are covered) — Task 8's changes there are verified by typecheck + a manual `npm run dev` smoke check, not a unit test, consistent with how the rest of `index.ts`'s Electron glue is already (not) tested.

## Decisions locked in during research (read before touching Task 8)

1. **Only the Entity-backed graph is rebuilt on `workspace.switchTo`.** Concretely: `FsEntityRepository`, `SymlinkManager`, `FileMaterializer`, `AdapterManager`, `EntityService`, `SkillService`, `AgentService`, `InstructionService`, `SessionService`, `ProjectService`, `HealthService` (its `SymlinkCollector`/`GeneratedFileCollector` close over `adapterManager`/`symlinkManager`/`fileMaterializer`, so they'd go stale otherwise — the other 3 collectors don't touch workspace-scoped state and are reused as-is), and `WorkspaceTeardownService` (same staleness reason — it holds the `adapterManager` reference used by `app.restore`). **`settingsService`, `pluginService` (and everything under it: `pluginCache`, `claudeSettingsFile`, `gitClient`, `octokitClient`, …), `marketplaceService`, `mcpService`, `hookService`, `credentialStore`, `repoService`, `dialogPort`, `notificationPort` stay anchored to the workspace that was active at app startup.** Reason: today's code already keys those by home/cwd or a `'personal' | 'project'` Claude-plugin-scope that predates and is orthogonal to the new `Workspace` concept (CLAUDE.md: "`hook-service` and `mcp-service` are not Entity-backed yet — Phase 1"); broadening their scope to follow the active `Workspace` is a real, separate design question (e.g. should plugin installs be per-Workspace too?) that this plan does not answer. Flagged here as a deliberate, documented scope bound, not a silent gap.
2. **`WorkspaceService.switchTo(id)` only flips the registry's active-pointer field and returns the target `Workspace`.** It does **not** kill sessions or touch the service graph — that orchestration (kill → rebuild → swap dispatcher) lives in the composition root (`src/main/index.ts`), the same layering `app.restore` already uses today (`src/main/ipc/registry.ts:196-199` calls `workspaceTeardownService.restore()` then `appQuit()` — two steps, neither service knows about the other).
3. **`workspace.pickFolder` from the spec is not a new IPC method.** `dialog.selectFolder` (`src/main/ipc/registry.ts:130-137`, backed by the existing `DialogPort`) already opens a native folder picker with no workspace-specific behavior — the renderer's "create workspace" flow reuses it directly, exactly like `InstructionsScreen.tsx`'s existing project-creation flow does today. Adding a second IPC method that wraps the identical dialog call would be pure duplication.
4. **The delete-reference-guard from spec §5 ("deleting a Workspace/Project still referenced by any entity's `scopeId` is blocked") is not implemented in this plan.** `scopeId` does not exist until plan 2. `WorkspaceService.delete` only guards "not the active workspace"; `ProjectService.delete` has no guard at all (nothing references a `Project.id` yet). Plan 2 adds the reference check once `scopeId` exists — tracked there, not here.

---

## File structure

New files:
- `src/shared/workspace.ts` — `Workspace`, `WorkspaceRegistryFile`.
- `src/shared/project.ts` — `Project`, `ProjectRegistryFile`.
- `src/main/application/ports/workspace-registry.ts` — `WorkspaceRegistry` port.
- `src/main/application/ports/project-registry.ts` — `ProjectRegistry` port.
- `src/main/infrastructure/workspace/fs-workspace-registry.ts` — `FsWorkspaceRegistry`.
- `src/main/infrastructure/workspace/in-memory-workspace-registry.ts` — `InMemoryWorkspaceRegistry`.
- `src/main/infrastructure/project/fs-project-registry.ts` — `FsProjectRegistry`.
- `src/main/infrastructure/project/in-memory-project-registry.ts` — `InMemoryProjectRegistry`.
- `src/main/application/services/workspace-service.ts` — `WorkspaceService`.
- `src/main/application/services/project-service.ts` — `ProjectService`.
- `src/main/ipc/workspace-handlers.ts` — `buildWorkspaceHandlers`.
- `src/main/ipc/project-handlers.ts` — `buildProjectHandlers`.
- `src/main/application/workspace-scoped-services.ts` — `buildWorkspaceScopedServices`, `WorkspaceScopedServices`, `WorkspaceScopedSharedDeps`.
- `src/renderer/hooks/use-workspaces.ts` — `useWorkspaces`, `useActiveWorkspace`, `useCreateWorkspace`, `useSwitchWorkspace`, `useDeleteWorkspace`.
- `src/renderer/components/shell/WorkspaceSwitcher.tsx`.

Modified files:
- `src/main/ipc/registry.ts` — `IpcDeps` gains `workspaceService`, `projectService`, `switchActiveWorkspace`; `buildHandlers` spreads the two new handler builders.
- `src/main/index.ts` — composition root split into shared (startup-only) deps + `buildWorkspaceScopedServices(dataDir, shared)`; mutable `deps`/`dispatch`; `switchActiveWorkspace` closure.
- `src/renderer/components/shell/TopNav.tsx` — renders `<WorkspaceSwitcher />` in the right cluster.
- `vitest.config.ts` — add the two new in-memory adapters to the coverage `exclude` list (pure test doubles, same treatment as `InMemorySettingsRepository`).
- `docs/reference/architecture.md`, `docs/reference/ipc-contract.md` — document the new bounded context and IPC methods.

---

## Task 1: Workspace shared type, registry port, Fs + in-memory adapters

**Files:**
- Create: `src/shared/workspace.ts`
- Create: `src/main/application/ports/workspace-registry.ts`
- Create: `src/main/infrastructure/workspace/fs-workspace-registry.ts`
- Create: `src/main/infrastructure/workspace/in-memory-workspace-registry.ts`
- Test: `tests/main/infrastructure/workspace/fs-workspace-registry.test.ts`

**Interfaces:**
- Produces: `Workspace { id: string; name: string; rootPath: string; isDefault: boolean; createdAt: string }`, `WorkspaceRegistryFile { workspaces: Workspace[]; activeWorkspaceId: string }` (`src/shared/workspace.ts`); `WorkspaceRegistry { load(): Promise<WorkspaceRegistryFile | null>; save(file: WorkspaceRegistryFile): Promise<void> }` port; `FsWorkspaceRegistry implements WorkspaceRegistry`; `InMemoryWorkspaceRegistry implements WorkspaceRegistry`. Consumed by Task 2 (`WorkspaceService`).

- [ ] **Step 1: Write the shared type**

Create `src/shared/workspace.ts`:

```ts
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  isDefault: boolean;
  createdAt: string;
}

export interface WorkspaceRegistryFile {
  workspaces: Workspace[];
  activeWorkspaceId: string;
}
```

- [ ] **Step 2: Write the port**

Create `src/main/application/ports/workspace-registry.ts`:

```ts
import type { WorkspaceRegistryFile } from '../../../shared/workspace.js';

export interface WorkspaceRegistry {
  load(): Promise<WorkspaceRegistryFile | null>;
  save(file: WorkspaceRegistryFile): Promise<void>;
}
```

- [ ] **Step 3: Write the failing Fs adapter test**

Create `tests/main/infrastructure/workspace/fs-workspace-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsWorkspaceRegistry } from '../../../../src/main/infrastructure/workspace/fs-workspace-registry.js';
import type { WorkspaceRegistryFile } from '../../../../src/shared/workspace.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ws-registry-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FsWorkspaceRegistry', () => {
  it('load returns null when the file does not exist yet', async () => {
    const registry = new FsWorkspaceRegistry(join(dir, 'workspaces.json'));
    expect(await registry.load()).toBeNull();
  });

  it('save then load round-trips the registry', async () => {
    const registry = new FsWorkspaceRegistry(join(dir, 'nested', 'workspaces.json'));
    const file: WorkspaceRegistryFile = {
      workspaces: [
        { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      activeWorkspaceId: 'default',
    };
    await registry.save(file);
    expect(await registry.load()).toEqual(file);
  });

  it('save creates the parent directory if missing', async () => {
    const registry = new FsWorkspaceRegistry(join(dir, 'a', 'b', 'workspaces.json'));
    await registry.save({ workspaces: [], activeWorkspaceId: '' });
    expect(await registry.load()).toEqual({ workspaces: [], activeWorkspaceId: '' });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/main/infrastructure/workspace/fs-workspace-registry.test.ts`
Expected: FAIL — `Cannot find module '.../fs-workspace-registry.js'`

- [ ] **Step 5: Implement the Fs adapter (mirrors `FsSettingsRepository` exactly)**

Create `src/main/infrastructure/workspace/fs-workspace-registry.ts`:

```ts
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { WorkspaceRegistryFile } from '../../../shared/workspace.js';
import type { WorkspaceRegistry } from '../../application/ports/workspace-registry.js';

const hasErrnoCode = (err: unknown, code: string): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;

export class FsWorkspaceRegistry implements WorkspaceRegistry {
  constructor(private readonly filePath: string) {}

  async load(): Promise<WorkspaceRegistryFile | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as WorkspaceRegistryFile;
    } catch (err) {
      if (hasErrnoCode(err, 'ENOENT')) return null;
      throw err;
    }
  }

  async save(file: WorkspaceRegistryFile): Promise<void> {
    const dir = dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const name = basename(this.filePath);
    const tempPath = join(dir, `.${name}.${randomBytes(8).toString('hex')}.tmp`);

    await fs.writeFile(tempPath, JSON.stringify(file, null, 2), 'utf8');
    try {
      await fs.rename(tempPath, this.filePath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/main/infrastructure/workspace/fs-workspace-registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Write the in-memory fake (mirrors `InMemorySettingsRepository`)**

Create `src/main/infrastructure/workspace/in-memory-workspace-registry.ts`:

```ts
import type { WorkspaceRegistryFile } from '../../../shared/workspace.js';
import type { WorkspaceRegistry } from '../../application/ports/workspace-registry.js';

export class InMemoryWorkspaceRegistry implements WorkspaceRegistry {
  private state: WorkspaceRegistryFile | null = null;

  load(): Promise<WorkspaceRegistryFile | null> {
    return Promise.resolve(this.state === null ? null : structuredClone(this.state));
  }

  save(file: WorkspaceRegistryFile): Promise<void> {
    this.state = structuredClone(file);
    return Promise.resolve();
  }
}
```

- [ ] **Step 8: Exclude the in-memory fake from coverage**

In `vitest.config.ts`, add it next to the existing exclusion:

```ts
      exclude: [
        'src/main/infrastructure/dialog/**',
        'src/main/infrastructure/notification/**',
        'src/main/infrastructure/settings/in-memory-settings-repository.ts',
        'src/main/infrastructure/workspace/in-memory-workspace-registry.ts',
        'src/main/infrastructure/project/in-memory-project-registry.ts',
      ],
```

(The second new line is added now so Task 3 doesn't need to touch this file again.)

- [ ] **Step 9: Commit**

```bash
git add src/shared/workspace.ts src/main/application/ports/workspace-registry.ts \
  src/main/infrastructure/workspace/fs-workspace-registry.ts \
  src/main/infrastructure/workspace/in-memory-workspace-registry.ts \
  tests/main/infrastructure/workspace/fs-workspace-registry.test.ts vitest.config.ts
git commit -m "feat: add Workspace shared type and registry port/adapters"
```

---

## Task 2: `WorkspaceService`

**Files:**
- Create: `src/main/application/services/workspace-service.ts`
- Test: `tests/main/application/services/workspace-service.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRegistry` (Task 1); `ClockPort.now(): Date` (`src/main/application/ports/clock-port.js`, existing); `Pick<WorkspaceBootstrapService, 'create'>.create(dataDir: string): Promise<void>` (existing, `src/main/application/services/workspace-bootstrap.js` — note it takes the **data dir** path, i.e. `<rootPath>/.ai-companion`, not the raw `rootPath`); `workspacePath(home: string): string` (existing, `src/shared/brand-paths.js`, returns `<home>/.ai-companion`).
- Produces: `WorkspaceService { list(): Promise<Workspace[]>; get(id: string): Promise<Workspace>; getActive(): Promise<Workspace>; create(input: {name: string; rootPath: string}): Promise<Workspace>; switchTo(id: string): Promise<Workspace>; delete(id: string): Promise<void> }`. `get`/`switchTo` throw `DomainError('not_found', ...)` for an unknown id; `delete` throws `DomainError('not_found', ...)` for an unknown id and `DomainError('validation', ...)` for the active workspace. Consumed by Task 5 (IPC), Task 8 (composition root).

- [ ] **Step 1: Write the failing tests**

Create `tests/main/application/services/workspace-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { WorkspaceService } from '../../../../src/main/application/services/workspace-service.js';
import { InMemoryWorkspaceRegistry } from '../../../../src/main/infrastructure/workspace/in-memory-workspace-registry.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const setup = () => {
  const registry = new InMemoryWorkspaceRegistry();
  const clock = new FixedClock(new Date('2026-08-22T10:00:00.000Z'));
  const bootstrap = { create: vi.fn().mockResolvedValue(undefined) };
  const service = new WorkspaceService(registry, clock, bootstrap, '/home/u');
  return { service, registry, bootstrap };
};

describe('WorkspaceService', () => {
  it('seeds the default workspace on first list() and bootstraps its data dir', async () => {
    const { service, bootstrap } = setup();
    const list = await service.list();
    expect(list).toEqual([
      { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '2026-08-22T10:00:00.000Z' },
    ]);
    expect(bootstrap.create).toHaveBeenCalledWith('/home/u/.ai-companion');
  });

  it('getActive returns the default workspace on first run', async () => {
    const { service } = setup();
    expect(await service.getActive()).toMatchObject({ id: 'default', isDefault: true });
  });

  it('seeding is idempotent across repeated calls', async () => {
    const { service, registry } = setup();
    await service.list();
    await service.list();
    const loaded = await registry.load();
    expect(loaded?.workspaces).toHaveLength(1);
  });

  it('create adds a new workspace, bootstraps it, and does not change the active one', async () => {
    const { service, bootstrap } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    expect(created).toMatchObject({ name: 'Acme', rootPath: '/repos/acme', isDefault: false });
    expect(typeof created.id).toBe('string');
    expect(bootstrap.create).toHaveBeenCalledWith('/repos/acme/.ai-companion');
    expect((await service.getActive()).id).toBe('default');
    expect(await service.list()).toHaveLength(2);
  });

  it('switchTo updates the active workspace id and returns it', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    const active = await service.switchTo(created.id);
    expect(active).toEqual(created);
    expect((await service.getActive()).id).toBe(created.id);
  });

  it('switchTo rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.switchTo('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('get rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.get('nope')).rejects.toBeInstanceOf(DomainError);
  });

  it('delete removes a non-active workspace', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    await service.delete(created.id);
    expect(await service.list()).toHaveLength(1);
  });

  it('delete rejects deleting the active workspace with validation', async () => {
    const { service } = setup();
    await expect(service.delete('default')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('delete rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.delete('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/services/workspace-service.test.ts`
Expected: FAIL — `Cannot find module '.../workspace-service.js'`

- [ ] **Step 3: Implement `WorkspaceService`**

Create `src/main/application/services/workspace-service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Workspace, WorkspaceRegistryFile } from '../../../shared/workspace.js';
import { workspacePath } from '../../../shared/brand-paths.js';
import type { WorkspaceRegistry } from '../ports/workspace-registry.js';
import type { ClockPort } from '../ports/clock-port.js';
import { DomainError } from '../../domain/errors.js';

interface BootstrapPort {
  create(dataDir: string): Promise<void>;
}

export class WorkspaceService {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly clock: ClockPort,
    private readonly bootstrap: BootstrapPort,
    private readonly defaultRootPath: string,
  ) {}

  private async loadOrSeed(): Promise<WorkspaceRegistryFile> {
    const existing = await this.registry.load();
    if (existing !== null) return existing;

    await this.bootstrap.create(workspacePath(this.defaultRootPath));
    const seeded: WorkspaceRegistryFile = {
      workspaces: [
        {
          id: 'default',
          name: 'Default',
          rootPath: this.defaultRootPath,
          isDefault: true,
          createdAt: this.clock.now().toISOString(),
        },
      ],
      activeWorkspaceId: 'default',
    };
    await this.registry.save(seeded);
    return seeded;
  }

  async list(): Promise<Workspace[]> {
    const registry = await this.loadOrSeed();
    return registry.workspaces;
  }

  async get(id: string): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    const found = registry.workspaces.find((w) => w.id === id);
    if (!found) throw new DomainError('not_found', `Workspace not found: ${id}`);
    return found;
  }

  async getActive(): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    return this.get(registry.activeWorkspaceId);
  }

  async create(input: { name: string; rootPath: string }): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    await this.bootstrap.create(workspacePath(input.rootPath));
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      rootPath: input.rootPath,
      isDefault: false,
      createdAt: this.clock.now().toISOString(),
    };
    await this.registry.save({ ...registry, workspaces: [...registry.workspaces, workspace] });
    return workspace;
  }

  async switchTo(id: string): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    const target = registry.workspaces.find((w) => w.id === id);
    if (!target) throw new DomainError('not_found', `Workspace not found: ${id}`);
    await this.registry.save({ ...registry, activeWorkspaceId: id });
    return target;
  }

  async delete(id: string): Promise<void> {
    const registry = await this.loadOrSeed();
    if (!registry.workspaces.some((w) => w.id === id)) {
      throw new DomainError('not_found', `Workspace not found: ${id}`);
    }
    if (registry.activeWorkspaceId === id) {
      throw new DomainError('validation', 'Cannot delete the active workspace — switch away first');
    }
    await this.registry.save({
      ...registry,
      workspaces: registry.workspaces.filter((w) => w.id !== id),
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/services/workspace-service.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/application/services/workspace-service.ts tests/main/application/services/workspace-service.test.ts
git commit -m "feat: add WorkspaceService (registry CRUD, default-seed, active switching)"
```

---

## Task 3: Project shared type, registry port, Fs + in-memory adapters

**Files:**
- Create: `src/shared/project.ts`
- Create: `src/main/application/ports/project-registry.ts`
- Create: `src/main/infrastructure/project/fs-project-registry.ts`
- Create: `src/main/infrastructure/project/in-memory-project-registry.ts`
- Test: `tests/main/infrastructure/project/fs-project-registry.test.ts`

**Interfaces:**
- Produces: `Project { id: string; name: string; path: string; createdAt: string }`, `ProjectRegistryFile { projects: Project[] }` (`src/shared/project.ts`); `ProjectRegistry { load(): Promise<ProjectRegistryFile | null>; save(file: ProjectRegistryFile): Promise<void> }` port; `FsProjectRegistry`; `InMemoryProjectRegistry`. Consumed by Task 4 (`ProjectService`). (Task 1's Step 8 already added `in-memory-project-registry.ts` to `vitest.config.ts`'s coverage exclude — nothing to change there in this task.)

- [ ] **Step 1: Write the shared type**

Create `src/shared/project.ts`:

```ts
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface ProjectRegistryFile {
  projects: Project[];
}
```

- [ ] **Step 2: Write the port**

Create `src/main/application/ports/project-registry.ts`:

```ts
import type { ProjectRegistryFile } from '../../../shared/project.js';

export interface ProjectRegistry {
  load(): Promise<ProjectRegistryFile | null>;
  save(file: ProjectRegistryFile): Promise<void>;
}
```

- [ ] **Step 3: Write the failing Fs adapter test**

Create `tests/main/infrastructure/project/fs-project-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsProjectRegistry } from '../../../../src/main/infrastructure/project/fs-project-registry.js';
import type { ProjectRegistryFile } from '../../../../src/shared/project.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'proj-registry-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FsProjectRegistry', () => {
  it('load returns null when the file does not exist yet', async () => {
    const registry = new FsProjectRegistry(join(dir, 'projects.json'));
    expect(await registry.load()).toBeNull();
  });

  it('save then load round-trips the registry', async () => {
    const registry = new FsProjectRegistry(join(dir, 'projects.json'));
    const file: ProjectRegistryFile = {
      projects: [{ id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '2026-01-01T00:00:00.000Z' }],
    };
    await registry.save(file);
    expect(await registry.load()).toEqual(file);
  });

  it('save creates the parent directory if missing', async () => {
    const registry = new FsProjectRegistry(join(dir, 'a', 'b', 'projects.json'));
    await registry.save({ projects: [] });
    expect(await registry.load()).toEqual({ projects: [] });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/main/infrastructure/project/fs-project-registry.test.ts`
Expected: FAIL — `Cannot find module '.../fs-project-registry.js'`

- [ ] **Step 5: Implement the Fs adapter**

Create `src/main/infrastructure/project/fs-project-registry.ts`:

```ts
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { ProjectRegistryFile } from '../../../shared/project.js';
import type { ProjectRegistry } from '../../application/ports/project-registry.js';

const hasErrnoCode = (err: unknown, code: string): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;

export class FsProjectRegistry implements ProjectRegistry {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ProjectRegistryFile | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as ProjectRegistryFile;
    } catch (err) {
      if (hasErrnoCode(err, 'ENOENT')) return null;
      throw err;
    }
  }

  async save(file: ProjectRegistryFile): Promise<void> {
    const dir = dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const name = basename(this.filePath);
    const tempPath = join(dir, `.${name}.${randomBytes(8).toString('hex')}.tmp`);

    await fs.writeFile(tempPath, JSON.stringify(file, null, 2), 'utf8');
    try {
      await fs.rename(tempPath, this.filePath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/main/infrastructure/project/fs-project-registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Write the in-memory fake**

Create `src/main/infrastructure/project/in-memory-project-registry.ts`:

```ts
import type { ProjectRegistryFile } from '../../../shared/project.js';
import type { ProjectRegistry } from '../../application/ports/project-registry.js';

export class InMemoryProjectRegistry implements ProjectRegistry {
  private state: ProjectRegistryFile | null = null;

  load(): Promise<ProjectRegistryFile | null> {
    return Promise.resolve(this.state === null ? null : structuredClone(this.state));
  }

  save(file: ProjectRegistryFile): Promise<void> {
    this.state = structuredClone(file);
    return Promise.resolve();
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/project.ts src/main/application/ports/project-registry.ts \
  src/main/infrastructure/project/fs-project-registry.ts \
  src/main/infrastructure/project/in-memory-project-registry.ts \
  tests/main/infrastructure/project/fs-project-registry.test.ts
git commit -m "feat: add Project shared type and registry port/adapters"
```

---

## Task 4: `ProjectService`

**Files:**
- Create: `src/main/application/services/project-service.ts`
- Test: `tests/main/application/services/project-service.test.ts`

**Interfaces:**
- Consumes: `ProjectRegistry` (Task 3), `ClockPort` (existing).
- Produces: `ProjectService { list(): Promise<Project[]>; get(id: string): Promise<Project>; create(input: {name: string; path: string}): Promise<Project>; update(input: {id: string; name?: string; path?: string}): Promise<Project>; delete(id: string): Promise<void>; findOrCreateByPath(path: string): Promise<Project> }`. `get`/`update`/`delete` throw `DomainError('not_found', ...)` for an unknown id. `findOrCreateByPath` dedups by **exact** path match and derives the default name from `path.basename`. Consumed by Task 6 (IPC), Task 8 (composition root), and by plan 2's lazy migration (§2.9 of the spec) — plan 2 calls this method by this exact name/signature, so it must not change later.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/application/services/project-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ProjectService } from '../../../../src/main/application/services/project-service.js';
import { InMemoryProjectRegistry } from '../../../../src/main/infrastructure/project/in-memory-project-registry.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';

const setup = () => {
  const registry = new InMemoryProjectRegistry();
  const clock = new FixedClock(new Date('2026-08-22T10:00:00.000Z'));
  return { service: new ProjectService(registry, clock), registry };
};

describe('ProjectService', () => {
  it('list returns [] when no projects exist yet', async () => {
    const { service } = setup();
    expect(await service.list()).toEqual([]);
  });

  it('create adds a project with a generated id and timestamp', async () => {
    const { service } = setup();
    const project = await service.create({ name: 'acme', path: '/repos/acme' });
    expect(project).toMatchObject({ name: 'acme', path: '/repos/acme', createdAt: '2026-08-22T10:00:00.000Z' });
    expect(typeof project.id).toBe('string');
    expect(await service.list()).toEqual([project]);
  });

  it('get returns the project by id', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'acme', path: '/repos/acme' });
    expect(await service.get(created.id)).toEqual(created);
  });

  it('get rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.get('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('update changes name and/or path, leaving id and createdAt intact', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'acme', path: '/repos/acme' });
    const updated = await service.update({ id: created.id, name: 'acme-renamed' });
    expect(updated).toEqual({ ...created, name: 'acme-renamed' });
  });

  it('update rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.update({ id: 'nope', name: 'x' })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('delete removes the project', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'acme', path: '/repos/acme' });
    await service.delete(created.id);
    expect(await service.list()).toEqual([]);
  });

  it('delete rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.delete('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('findOrCreateByPath creates a project on first call, reuses it on the next (dedup by exact path)', async () => {
    const { service } = setup();
    const first = await service.findOrCreateByPath('/repos/acme');
    const second = await service.findOrCreateByPath('/repos/acme');
    expect(second).toEqual(first);
    expect(await service.list()).toHaveLength(1);
  });

  it('findOrCreateByPath derives the name from the path basename', async () => {
    const { service } = setup();
    const project = await service.findOrCreateByPath('/repos/My Repo');
    expect(project.name).toBe('My Repo');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/services/project-service.test.ts`
Expected: FAIL — `Cannot find module '.../project-service.js'`

- [ ] **Step 3: Implement `ProjectService`**

Create `src/main/application/services/project-service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Project, ProjectRegistryFile } from '../../../shared/project.js';
import type { ProjectRegistry } from '../ports/project-registry.js';
import type { ClockPort } from '../ports/clock-port.js';
import { DomainError } from '../../domain/errors.js';

export class ProjectService {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly clock: ClockPort,
  ) {}

  private async load(): Promise<ProjectRegistryFile> {
    return (await this.registry.load()) ?? { projects: [] };
  }

  async list(): Promise<Project[]> {
    return (await this.load()).projects;
  }

  async get(id: string): Promise<Project> {
    const found = (await this.load()).projects.find((p) => p.id === id);
    if (!found) throw new DomainError('not_found', `Project not found: ${id}`);
    return found;
  }

  async create(input: { name: string; path: string }): Promise<Project> {
    const registry = await this.load();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      path: input.path,
      createdAt: this.clock.now().toISOString(),
    };
    await this.registry.save({ projects: [...registry.projects, project] });
    return project;
  }

  async update(input: { id: string; name?: string; path?: string }): Promise<Project> {
    const registry = await this.load();
    const index = registry.projects.findIndex((p) => p.id === input.id);
    const current = index === -1 ? undefined : registry.projects[index];
    if (index === -1 || current === undefined) {
      throw new DomainError('not_found', `Project not found: ${input.id}`);
    }
    const updated: Project = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.path !== undefined ? { path: input.path } : {}),
    };
    const projects = [...registry.projects];
    projects[index] = updated;
    await this.registry.save({ projects });
    return updated;
  }

  async delete(id: string): Promise<void> {
    const registry = await this.load();
    if (!registry.projects.some((p) => p.id === id)) {
      throw new DomainError('not_found', `Project not found: ${id}`);
    }
    await this.registry.save({ projects: registry.projects.filter((p) => p.id !== id) });
  }

  async findOrCreateByPath(path: string): Promise<Project> {
    const existing = (await this.load()).projects.find((p) => p.path === path);
    if (existing) return existing;
    return this.create({ name: basename(path) || path, path });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/services/project-service.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/application/services/project-service.ts tests/main/application/services/project-service.test.ts
git commit -m "feat: add ProjectService (CRUD + findOrCreateByPath for plan 2's migration)"
```

---

## Task 5: `workspace.*` IPC handlers

**Files:**
- Create: `src/main/ipc/workspace-handlers.ts`
- Modify: `src/main/ipc/registry.ts`
- Test: `tests/main/ipc/typed-handlers.test.ts`

**Interfaces:**
- Consumes: `WorkspaceService` (Task 2); `asObject`, `asString` from `./_validators.js` (existing).
- Produces: `buildWorkspaceHandlers(service: WorkspaceService, switchActiveWorkspace: (id: string) => Promise<Workspace>): IpcHandlers` registering `workspace.list`, `workspace.getActive`, `workspace.create`, `workspace.switchTo`, `workspace.delete`. `switchActiveWorkspace` is injected rather than the handler calling `service.switchTo` directly, because the actual service-graph rebuild is the composition root's job (Task 8) — the handler only routes to whatever orchestration the composition root wired in. `IpcDeps` (in `registry.ts`) gains `workspaceService: WorkspaceService` and `switchActiveWorkspace: (id: string) => Promise<Workspace>`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/ipc/typed-handlers.test.ts` (new imports at the top, new `describe` block at the bottom — follow the existing file's `setupInstructionService`-style pattern):

```ts
import { buildWorkspaceHandlers } from '../../../src/main/ipc/workspace-handlers.js';
import { WorkspaceService } from '../../../src/main/application/services/workspace-service.js';
import { InMemoryWorkspaceRegistry } from '../../../src/main/infrastructure/workspace/in-memory-workspace-registry.js';
import type { Workspace } from '../../../src/shared/workspace.js';
```

```ts
const setupWorkspaceService = () => {
  const registry = new InMemoryWorkspaceRegistry();
  const bootstrap = { create: vi.fn().mockResolvedValue(undefined) };
  return new WorkspaceService(registry, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), bootstrap, '/home/u');
};

describe('workspace-handlers', () => {
  it('workspace.list calls service.list', async () => {
    const svc = setupWorkspaceService();
    const spy = vi.spyOn(svc, 'list');
    const h = buildWorkspaceHandlers(svc, vi.fn());
    await h['workspace.list']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('workspace.getActive calls service.getActive', async () => {
    const svc = setupWorkspaceService();
    const spy = vi.spyOn(svc, 'getActive');
    const h = buildWorkspaceHandlers(svc, vi.fn());
    await h['workspace.getActive']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('workspace.create passes name and rootPath through', async () => {
    const svc = setupWorkspaceService();
    const spy = vi.spyOn(svc, 'create');
    const h = buildWorkspaceHandlers(svc, vi.fn());
    await h['workspace.create']!({ name: 'Acme', rootPath: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith({ name: 'Acme', rootPath: '/repos/acme' });
  });

  it('workspace.switchTo calls the injected switchActiveWorkspace, not service.switchTo directly', async () => {
    const svc = setupWorkspaceService();
    const serviceSpy = vi.spyOn(svc, 'switchTo');
    const orchestrated: Workspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };
    const switchActiveWorkspace = vi.fn().mockResolvedValue(orchestrated);
    const h = buildWorkspaceHandlers(svc, switchActiveWorkspace);
    const result = await h['workspace.switchTo']!({ id: 'w1' });
    expect(switchActiveWorkspace).toHaveBeenCalledWith('w1');
    expect(serviceSpy).not.toHaveBeenCalled();
    expect(result).toEqual(orchestrated);
  });

  it('workspace.delete passes the id through', async () => {
    const svc = setupWorkspaceService();
    const spy = vi.spyOn(svc, 'delete');
    const h = buildWorkspaceHandlers(svc, vi.fn());
    await h['workspace.delete']!({ id: 'w1' });
    expect(spy).toHaveBeenCalledWith('w1');
  });

  it('workspace.create rejects a missing name', async () => {
    const h = buildWorkspaceHandlers(setupWorkspaceService(), vi.fn());
    await expect(h['workspace.create']!({ rootPath: '/repos/acme' })).rejects.toMatchObject({ kind: 'validation' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: FAIL — `Cannot find module '.../workspace-handlers.js'`

- [ ] **Step 3: Implement `buildWorkspaceHandlers`**

Create `src/main/ipc/workspace-handlers.ts`:

```ts
import type { IpcHandlers } from './dispatcher.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
import { asObject, asString } from './_validators.js';

export function buildWorkspaceHandlers(
  service: WorkspaceService,
  switchActiveWorkspace: (id: string) => Promise<Workspace>,
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
  };
}
```

- [ ] **Step 4: Wire `IpcDeps`/`buildHandlers`**

In `src/main/ipc/registry.ts`:

Add the import (near the other `build*Handlers` imports):

```ts
import { buildWorkspaceHandlers } from './workspace-handlers.js';
import type { WorkspaceService } from '../application/services/workspace-service.js';
import type { Workspace } from '../../shared/workspace.js';
```

Add two fields to `IpcDeps` (after `sessionService: SessionService;`):

```ts
  workspaceService: WorkspaceService;
  switchActiveWorkspace: (id: string) => Promise<Workspace>;
```

Destructure them in `buildHandlers` (after `sessionService,`):

```ts
    workspaceService,
    switchActiveWorkspace,
```

Spread the new handlers (after `...buildSessionHandlers(sessionService),`):

```ts
    ...buildWorkspaceHandlers(workspaceService, switchActiveWorkspace),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: PASS

Note: `registry.ts` will not typecheck stand-alone until Task 8 supplies `workspaceService`/`switchActiveWorkspace` at the one real call site (`src/main/index.ts`) — this is expected and resolved by Task 8. `npm run typecheck` is not required to pass again until after Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/workspace-handlers.ts src/main/ipc/registry.ts tests/main/ipc/typed-handlers.test.ts
git commit -m "feat: add workspace.* IPC handlers"
```

---

## Task 6: `project.*` IPC handlers

**Files:**
- Create: `src/main/ipc/project-handlers.ts`
- Modify: `src/main/ipc/registry.ts`
- Test: `tests/main/ipc/typed-handlers.test.ts`

**Interfaces:**
- Consumes: `ProjectService` (Task 4).
- Produces: `buildProjectHandlers(service: ProjectService): IpcHandlers` registering `project.list`, `project.create`, `project.update`, `project.delete`. `IpcDeps` gains `projectService: ProjectService`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/ipc/typed-handlers.test.ts`:

```ts
import { buildProjectHandlers } from '../../../src/main/ipc/project-handlers.js';
import { ProjectService } from '../../../src/main/application/services/project-service.js';
import { InMemoryProjectRegistry } from '../../../src/main/infrastructure/project/in-memory-project-registry.js';
```

```ts
const setupProjectService = () =>
  new ProjectService(new InMemoryProjectRegistry(), new FixedClock(new Date('2026-04-26T10:00:00.000Z')));

describe('project-handlers', () => {
  it('project.list calls service.list', async () => {
    const svc = setupProjectService();
    const spy = vi.spyOn(svc, 'list');
    const h = buildProjectHandlers(svc);
    await h['project.list']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('project.create passes name and path through', async () => {
    const svc = setupProjectService();
    const spy = vi.spyOn(svc, 'create');
    const h = buildProjectHandlers(svc);
    await h['project.create']!({ name: 'acme', path: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith({ name: 'acme', path: '/repos/acme' });
  });

  it('project.update passes id and optional fields through', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const spy = vi.spyOn(svc, 'update');
    const h = buildProjectHandlers(svc);
    await h['project.update']!({ id: created.id, name: 'acme-renamed' });
    expect(spy).toHaveBeenCalledWith({ id: created.id, name: 'acme-renamed' });
  });

  it('project.delete passes the id through', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const spy = vi.spyOn(svc, 'delete');
    const h = buildProjectHandlers(svc);
    await h['project.delete']!({ id: created.id });
    expect(spy).toHaveBeenCalledWith(created.id);
  });

  it('project.create rejects a missing path', async () => {
    const h = buildProjectHandlers(setupProjectService());
    await expect(h['project.create']!({ name: 'acme' })).rejects.toMatchObject({ kind: 'validation' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: FAIL — `Cannot find module '.../project-handlers.js'`

- [ ] **Step 3: Implement `buildProjectHandlers`**

Create `src/main/ipc/project-handlers.ts`:

```ts
import type { IpcHandlers } from './dispatcher.js';
import type { ProjectService } from '../application/services/project-service.js';
import { asObject, asString } from './_validators.js';

export function buildProjectHandlers(service: ProjectService): IpcHandlers {
  return {
    'project.list': async () => service.list(),
    'project.create': async (params) => {
      const raw = asObject(params, 'project.create');
      return service.create({
        name: asString(raw['name'], 'name'),
        path: asString(raw['path'], 'path'),
      });
    },
    'project.update': async (params) => {
      const raw = asObject(params, 'project.update');
      const name = typeof raw['name'] === 'string' ? raw['name'] : undefined;
      const path = typeof raw['path'] === 'string' ? raw['path'] : undefined;
      return service.update({
        id: asString(raw['id'], 'id'),
        ...(name !== undefined ? { name } : {}),
        ...(path !== undefined ? { path } : {}),
      });
    },
    'project.delete': async (params) => {
      const raw = asObject(params, 'project.delete');
      return service.delete(asString(raw['id'], 'id'));
    },
  };
}
```

- [ ] **Step 4: Wire `IpcDeps`/`buildHandlers`**

In `src/main/ipc/registry.ts`:

Add the import:

```ts
import { buildProjectHandlers } from './project-handlers.js';
import type { ProjectService } from '../application/services/project-service.js';
```

Add one field to `IpcDeps` (after `switchActiveWorkspace: (id: string) => Promise<Workspace>;` from Task 5):

```ts
  projectService: ProjectService;
```

Destructure it in `buildHandlers` (after `switchActiveWorkspace,`):

```ts
    projectService,
```

Spread the new handlers (after `...buildWorkspaceHandlers(workspaceService, switchActiveWorkspace),`):

```ts
    ...buildProjectHandlers(projectService),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/project-handlers.ts src/main/ipc/registry.ts tests/main/ipc/typed-handlers.test.ts
git commit -m "feat: add project.* IPC handlers"
```

---

## Task 7: Extract `buildWorkspaceScopedServices` (pure, testable composition function)

**Files:**
- Create: `src/main/application/workspace-scoped-services.ts`
- Test: `tests/main/application/workspace-scoped-services.test.ts`

**Interfaces:**
- Consumes: `WorkspaceScopedSharedDeps` (defined in this file — see Step 3), all existing infra classes it wires (`FsEntityRepository`, `SymlinkManager`, `FileMaterializer`, `AdapterManager`, `EntityService`, `EntityValidator`, `SkillService`, `AgentService`, `InstructionService`, `SessionService`, `HealthService` + its 5 collectors, `WorkspaceTeardownService`), `ProjectService` + `FsProjectRegistry` (Tasks 3-4).
- Produces: `WorkspaceScopedServices { entityRepository, symlinkManager, fileMaterializer, adapterManager, entityService, skillService, agentService, instructionService, sessionService, projectService, healthService, workspaceTeardownService }` and `buildWorkspaceScopedServices(dataDir: string, shared: WorkspaceScopedSharedDeps): WorkspaceScopedServices`. Two calls with different `dataDir` values must produce fully independent graphs (no shared mutable state) — this is the property Task 8's `switchTo` orchestration relies on. Consumed by Task 8.

This function assumes `dataDir` (the `<rootPath>/.ai-companion` directory) already exists — `WorkspaceService.create`/the startup seed (Task 2) already call `WorkspaceBootstrapService.create` for every workspace before this function is ever invoked against it, so no bootstrap call belongs here.

- [ ] **Step 1: Read the current composition root to confirm every constructor call this task reproduces**

Open `src/main/index.ts` and locate the block from `const symlinkManager = ...` (currently around line 166) through `const workspaceTeardownService = ...` (currently around line 335-340), plus the `healthCollectors`/`healthService` block (currently around lines 326-333). This task moves exactly those constructions into the new file — no behavior change, pure extraction. Cross-check every constructor argument against the current file before writing Step 3; if a constructor signature has drifted since this plan was written, follow the actual current signature, not this step's text.

- [ ] **Step 2: Write the failing test**

Create `tests/main/application/workspace-scoped-services.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkspaceScopedServices } from '../../../src/main/application/workspace-scoped-services.js';
import { SystemClock } from '../../../src/main/infrastructure/clock/system-clock.js';
import { NodeFsAdapter } from '../../../src/main/infrastructure/filesystem/node-fs-adapter.js';
import { SettingsService } from '../../../src/main/application/services/settings-service.js';
import { InMemorySettingsRepository } from '../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { ClaudeAdapter } from '../../../src/main/infrastructure/adapters/claude-adapter.js';
import { CursorAdapter } from '../../../src/main/infrastructure/adapters/cursor-adapter.js';
import { PluginProvenanceService } from '../../../src/main/application/services/plugin-provenance.js';
import { PluginCacheFile } from '../../../src/main/infrastructure/plugins/plugin-cache-file.js';
import { ClaudeCodePluginReader } from '../../../src/main/infrastructure/plugins/claude-code-plugin-reader.js';
import { FakeClaudeCliPort } from '../../../src/main/application/services/__fixtures__/fake-claude-cli-port.js';
import { FakeClaudeSessionPort } from '../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { FsClaudeRuntimeReader } from '../../../src/main/infrastructure/claude-runtime/fs-claude-runtime-reader.js';
import { PluginService } from '../../../src/main/application/services/plugin-service.js';
import { PluginManifestParser } from '../../../src/main/application/services/plugin-manifest-parser.js';
import { MarketplaceParser } from '../../../src/main/application/services/marketplace-parser.js';
import { PluginInstaller } from '../../../src/main/application/services/plugin-installer.js';
import { PluginAuthorService } from '../../../src/main/application/services/plugin-author-service.js';
import { PluginPublisher } from '../../../src/main/application/services/plugin-publisher.js';
import { ClaudeSettingsFile } from '../../../src/main/infrastructure/settings/claude-settings-file.js';
import { SimpleGitClient } from '../../../src/main/infrastructure/git/simple-git-client.js';
import { OctokitClient } from '../../../src/main/infrastructure/github/octokit-client.js';
import { FakeCredentialStorePort } from '../../../src/main/application/services/__fixtures__/fake-credential-store-port.js';
import type { WorkspaceScopedSharedDeps } from '../../../src/main/application/workspace-scoped-services.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../src/shared/entity.js';

let dirA: string;
let dirB: string;

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), 'wss-a-'));
  dirB = await mkdtemp(join(tmpdir(), 'wss-b-'));
});

afterEach(async () => {
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

function buildShared(): WorkspaceScopedSharedDeps {
  const nodeFsAdapter = new NodeFsAdapter();
  const clock = new SystemClock();
  const settingsService = new SettingsService(new InMemorySettingsRepository());
  const homedir = '/home/test-user';
  const claudeAdapter = new ClaudeAdapter({ homedir });
  const cursorAdapter = new CursorAdapter({ homedir });
  const pluginCache = new PluginCacheFile({
    pluginsDir: () => join(homedir, '.ai-companion', 'plugins'),
    cacheDir: () => join(homedir, '.claude', 'plugins', 'cache', 'local'),
  });
  const claudeCodePluginReader = new ClaudeCodePluginReader({
    registryPath: join(homedir, '.claude', 'plugins', 'installed_plugins.json'),
    fs: nodeFsAdapter,
  });
  const pluginProvenance = new PluginProvenanceService({
    cache: pluginCache,
    fs: nodeFsAdapter,
    claudeCodeRegistry: claudeCodePluginReader,
  });
  const manifestParser = new PluginManifestParser(nodeFsAdapter);
  const marketplaceParser = new MarketplaceParser(nodeFsAdapter);
  const claudeSettingsFile = new ClaudeSettingsFile({
    settingsPath: () => join(homedir, '.claude', 'settings.json'),
    symlinkPath: (_scope, id) => join(homedir, '.claude', 'plugins', 'cache', 'local', id),
  });
  const pluginInstaller = new PluginInstaller({ cache: pluginCache, settings: claudeSettingsFile });
  const pluginAuthor = new PluginAuthorService({ cache: pluginCache, installer: pluginInstaller, parser: manifestParser });
  const gitClient = new SimpleGitClient();
  const octokitClient = new OctokitClient(async () => undefined);
  const pluginPublisher = new PluginPublisher({
    cache: pluginCache, git: gitClient, githubApi: octokitClient,
    credentials: new FakeCredentialStorePort(),
    parser: manifestParser, clock,
  });
  const pluginService = new PluginService({
    installer: pluginInstaller, author: pluginAuthor, publisher: pluginPublisher, git: gitClient,
    cache: pluginCache, settings: claudeSettingsFile, parser: manifestParser, marketplaceParser, fs: nodeFsAdapter,
  });
  const claudeRuntimeReader = new FsClaudeRuntimeReader({
    claudeJsonPath: join(homedir, '.claude.json'),
    authCachePath: join(homedir, '.claude', 'mcp-needs-auth-cache.json'),
    mcpLogsBaseDir: join(homedir, 'Library', 'Caches', 'claude-cli-nodejs'),
  });

  return {
    clock,
    nodeFsAdapter,
    settingsService,
    claudeAdapter,
    cursorAdapter,
    pluginProvenance,
    pluginService,
    claudeRuntimeReader,
    claudeSettingsFile,
    claudeCli: new FakeClaudeCliPort(),
    claudeSessionPort: new FakeClaudeSessionPort(),
  };
}

describe('buildWorkspaceScopedServices', () => {
  it('two calls with different dataDirs produce fully independent entity graphs', async () => {
    const shared = buildShared();
    const a = buildWorkspaceScopedServices(dirA, shared);
    const b = buildWorkspaceScopedServices(dirB, shared);

    const skill: Skill = {
      urn: 'urn:skill:foo', kind: 'skill', name: 'foo', description: 'd',
      scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
      source: WORKSPACE_SOURCE, content: 'body',
    };
    await a.skillService.save({ skill, isCreate: true });

    expect((await a.skillService.list()).map((s) => s.name)).toEqual(['foo']);
    expect(await b.skillService.list()).toEqual([]);
  });

  it('wires projectService against <dataDir>/projects.json independently per graph', async () => {
    const shared = buildShared();
    const a = buildWorkspaceScopedServices(dirA, shared);
    const b = buildWorkspaceScopedServices(dirB, shared);

    await a.projectService.create({ name: 'acme', path: '/repos/acme' });
    expect(await a.projectService.list()).toHaveLength(1);
    expect(await b.projectService.list()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/main/application/workspace-scoped-services.test.ts`
Expected: FAIL — `Cannot find module '.../workspace-scoped-services.js'`

- [ ] **Step 4: Implement `buildWorkspaceScopedServices`**

Create `src/main/application/workspace-scoped-services.ts`. This is a straight extraction of the current `src/main/index.ts` workspace-scoped block (per Step 1) plus the two new services from Tasks 3-4 — every constructor call below must match what you confirmed in Step 1:

```ts
import { join } from 'node:path';
import type { Adapter } from './ports/adapter.js';
import type { NodeFsAdapter } from '../infrastructure/filesystem/node-fs-adapter.js';
import type { SettingsService } from './services/settings-service.js';
import type { ClockPort } from './ports/clock-port.js';
import type { PluginProvenanceService } from './services/plugin-provenance.js';
import type { PluginService } from './services/plugin-service.js';
import type { ClaudeRuntimePort } from './ports/claude-runtime-port.js';
import type { ClaudeSettingsFile } from '../infrastructure/settings/claude-settings-file.js';
import type { ClaudeCliPort } from './ports/claude-cli-port.js';
import type { ClaudeSessionPort } from './ports/claude-session-port.js';
import { SymlinkManager } from './services/symlink-manager.js';
import { FileMaterializer } from './services/file-materializer.js';
import { FsEntityRepository } from '../infrastructure/entity/fs-entity-repository.js';
import { AdapterManager } from './services/adapter-manager.js';
import { EntityService } from './services/entity-service.js';
import { EntityValidator } from './services/entity-validator.js';
import { SkillService } from './services/skill-service.js';
import { AgentService } from './services/agent-service.js';
import { InstructionService } from './services/instruction-service.js';
import { SessionService } from './services/session-service.js';
import { ProjectService } from './services/project-service.js';
import { FsProjectRegistry } from '../infrastructure/project/fs-project-registry.js';
import { HealthService } from './services/health/health-service.js';
import { McpAuthCollector } from './services/health/mcp-auth-collector.js';
import { McpRuntimeCollector } from './services/health/mcp-runtime-collector.js';
import { ConfigDriftCollector } from './services/health/config-drift-collector.js';
import { SymlinkCollector } from './services/health/symlink-collector.js';
import { GeneratedFileCollector } from './services/health/generated-file-collector.js';
import type { HealthCollector } from './services/health/health-collector.js';
import { WorkspaceTeardownService } from './services/workspace-teardown.js';

export interface WorkspaceScopedSharedDeps {
  clock: ClockPort;
  nodeFsAdapter: NodeFsAdapter;
  settingsService: SettingsService;
  claudeAdapter: Adapter;
  cursorAdapter: Adapter;
  pluginProvenance: PluginProvenanceService;
  pluginService: PluginService;
  claudeRuntimeReader: ClaudeRuntimePort;
  claudeSettingsFile: ClaudeSettingsFile;
  claudeCli: ClaudeCliPort;
  claudeSessionPort: ClaudeSessionPort;
}

export interface WorkspaceScopedServices {
  entityRepository: FsEntityRepository;
  symlinkManager: SymlinkManager;
  fileMaterializer: FileMaterializer;
  adapterManager: AdapterManager;
  entityService: EntityService;
  skillService: SkillService;
  agentService: AgentService;
  instructionService: InstructionService;
  sessionService: SessionService;
  projectService: ProjectService;
  healthService: HealthService;
  workspaceTeardownService: WorkspaceTeardownService;
}

/** `dataDir` is `<workspace.rootPath>/.ai-companion` — already bootstrapped by the caller. */
export function buildWorkspaceScopedServices(
  dataDir: string,
  shared: WorkspaceScopedSharedDeps,
): WorkspaceScopedServices {
  const {
    clock, nodeFsAdapter, settingsService, claudeAdapter, cursorAdapter,
    pluginProvenance, pluginService, claudeRuntimeReader, claudeSettingsFile,
    claudeCli, claudeSessionPort,
  } = shared;

  const symlinkManager = new SymlinkManager(nodeFsAdapter, clock, dataDir);
  const fileMaterializer = new FileMaterializer(nodeFsAdapter, clock, dataDir);
  const entityRepository = new FsEntityRepository(dataDir);
  const adapterManager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager,
    fileMaterializer,
    workspacePath: dataDir,
    adapters: new Map<string, Adapter>([
      [claudeAdapter.adapterId, claudeAdapter],
      [cursorAdapter.adapterId, cursorAdapter],
    ]),
  });

  const entityValidator = new EntityValidator();
  const entityService = new EntityService(entityRepository, clock, adapterManager, entityValidator);

  const skillService = new SkillService(entityService, { provenance: pluginProvenance, fs: nodeFsAdapter });
  const agentService = new AgentService(entityService, { provenance: pluginProvenance, fs: nodeFsAdapter });
  const instructionService = new InstructionService(entityService, claudeCli);
  const sessionService = new SessionService(entityService, claudeSessionPort, dataDir);
  const projectService = new ProjectService(new FsProjectRegistry(join(dataDir, 'projects.json')), clock);

  const healthCollectors: HealthCollector[] = [
    new McpAuthCollector(claudeRuntimeReader, clock),
    new McpRuntimeCollector(claudeRuntimeReader, clock),
    new ConfigDriftCollector(pluginService, clock),
    new SymlinkCollector(adapterManager, symlinkManager, clock),
    new GeneratedFileCollector(adapterManager, fileMaterializer, settingsService, clock),
  ];
  const healthService = new HealthService(healthCollectors, clock);

  const workspaceTeardownService = new WorkspaceTeardownService(
    adapterManager,
    nodeFsAdapter,
    dataDir,
    claudeSettingsFile,
  );

  return {
    entityRepository, symlinkManager, fileMaterializer, adapterManager, entityService,
    skillService, agentService, instructionService, sessionService, projectService,
    healthService, workspaceTeardownService,
  };
}
```

`ClaudeRuntimePort` (`./ports/claude-runtime-port.js`) and `HealthCollector` (`./services/health/health-collector.js`) are the verified current paths — if either has moved since this plan was written, grep for `class FsClaudeRuntimeReader implements` / `interface HealthCollector` and fix the import to match.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/main/application/workspace-scoped-services.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/application/workspace-scoped-services.ts tests/main/application/workspace-scoped-services.test.ts
git commit -m "refactor: extract workspace-scoped service construction into a pure, testable function"
```

---

## Task 8: Wire the composition root — startup + `workspace.switchTo` rebuild

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `WorkspaceService` (Task 2), `ProjectService`/`buildWorkspaceScopedServices` (Tasks 4/7), `buildWorkspaceHandlers`/`buildProjectHandlers` (Tasks 5/6).
- Produces: a working app where `workspace.switchTo` kills the outgoing workspace's live sessions, rebuilds the Entity-backed graph against the new workspace's data dir, and makes every subsequent IPC call see the new graph. No new exports — this task only changes `wireIpc()`'s body.

This task is not unit-tested (see Global Constraints — `index.ts` is outside the coverage `include` list and requires real Electron `app`/`ipcMain`). Verify it with `npm run typecheck` and the manual smoke check in Step 4.

- [ ] **Step 1: Replace the workspace-scoped construction block in `wireIpc()`**

In `src/main/index.ts`, the current block runs (per Task 7's Step 1 reading) roughly from `const symlinkManager = ...` through the `healthService`/`workspaceTeardownService` constructions. Replace that whole block — keep everything **before** it (the `nodeFsAdapter`, `home`, `ProductMigrationService` migration, `settingsService`, `repoReader`/`repoService`, `dialogPort`, `clock`, `claudeAdapter`/`cursorAdapter`, `credentialStore`, plugin/marketplace/mcp wiring down through `pluginProvenance`, `claudeRuntimeReader`, `mcpConfigStore`/`pluginMcpReader`/`mcpDisabledStash`/`mcpService`) exactly as-is, and everything **after** it (the `notificationPort` line onward) exactly as-is except where noted below.

Add the new imports at the top of the file:

```ts
import { WorkspaceService } from './application/services/workspace-service.js';
import { FsWorkspaceRegistry } from './infrastructure/workspace/fs-workspace-registry.js';
import { buildWorkspaceScopedServices, type WorkspaceScopedServices } from './application/workspace-scoped-services.js';
import { buildWorkspaceHandlers } from './ipc/workspace-handlers.js';
import { buildProjectHandlers } from './ipc/project-handlers.js';
import type { Workspace } from '../shared/workspace.js';
```

Immediately after the existing `const workspaceBootstrap = new WorkspaceBootstrapService(new FsWorkspaceBootstrap());` / `await workspaceBootstrap.create(workspacePath);` lines, add the `WorkspaceService` and resolve the active workspace:

```ts
  const workspaceRegistryPath = join(workspacePath, 'workspaces.json');
  const workspaceService = new WorkspaceService(
    new FsWorkspaceRegistry(workspaceRegistryPath),
    clock,
    workspaceBootstrap,
    home,
  );
  const activeWorkspace = await workspaceService.getActive();
  const activeDataDir = activeWorkspace.rootPath === home ? workspacePath : join(activeWorkspace.rootPath, '.ai-companion');
```

(`clock` is declared a few lines below the current bootstrap call — move `const clock = new SystemClock();` up above this block if it isn't already before it. `activeDataDir` special-cases the default workspace to reuse the already-migrated `workspacePath` constant instead of recomputing `workspacePath(home)` a second time — both are the same string, this just avoids a second identical computation.)

Replace the block Step 1 identified (the direct `symlinkManager`/`fileMaterializer`/`entityRepository`/`adapterManager`/`entityValidator`/`entityService`/`skillService`/`agentService`/`instructionService`/`sessionService`/`healthCollectors`/`healthService`/`workspaceTeardownService` constructions) with:

```ts
  const sharedDeps = {
    clock,
    nodeFsAdapter,
    settingsService,
    claudeAdapter,
    cursorAdapter,
    pluginProvenance,
    pluginService,
    claudeRuntimeReader,
    claudeSettingsFile,
    claudeCli: new NodeClaudeCliAdapter(),
    claudeSessionPort: new NodePtySessionAdapter(),
  };

  let workspaceScoped: WorkspaceScopedServices = buildWorkspaceScopedServices(activeDataDir, sharedDeps);

  const attachSessionBridges = (services: WorkspaceScopedServices): void => {
    services.sessionService.onOutput((sessionId, chunk) => {
      mainWindow?.webContents.send(SESSION_OUTPUT_CHANNEL, { sessionId, chunk });
    });
    services.sessionService.onExit((sessionId, _status, exitCode) => {
      mainWindow?.webContents.send(SESSION_EXIT_CHANNEL, { sessionId, exitCode });
    });
  };
  attachSessionBridges(workspaceScoped);
```

(`agentService`/`skillService`/`instructionService`/`entityService`/`adapterManager`/`symlinkManager`/`fileMaterializer`/`healthService`/`workspaceTeardownService`/`projectService` are now accessed as `workspaceScoped.<name>` everywhere below instead of as bare locals — update every reference in the rest of `wireIpc()`, e.g. the `healthCollectors` array literal is gone entirely since it now lives inside `buildWorkspaceScopedServices`.)

Remove the old `const claudeSessionPort = new NodePtySessionAdapter();` / `const sessionService = new SessionService(...)` / `sessionService.onOutput(...)` / `sessionService.onExit(...)` lines — replaced by `sharedDeps.claudeSessionPort` and `attachSessionBridges` above.

- [ ] **Step 2: Rebuild `app.on('before-quit', ...)` against the mutable graph**

Replace:

```ts
  app.on('before-quit', () => {
    sessionService.killAll();
  });
```

with:

```ts
  app.on('before-quit', () => {
    workspaceScoped.sessionService.killAll();
  });
```

- [ ] **Step 3: Wire the mutable dispatcher and `switchActiveWorkspace`**

Replace the `const handlers = buildHandlers({...}); const dispatch = createDispatcher(handlers);` block with:

```ts
  const buildDeps = () => ({
    settingsService,
    repoService,
    adapterManager: workspaceScoped.adapterManager,
    dialogPort,
    pluginService,
    credentialStore,
    skillService: workspaceScoped.skillService,
    agentService: workspaceScoped.agentService,
    hookService,
    instructionService: workspaceScoped.instructionService,
    sessionService: workspaceScoped.sessionService,
    workspaceService,
    projectService: workspaceScoped.projectService,
    switchActiveWorkspace,
    marketplaceService,
    healthService: workspaceScoped.healthService,
    mcpService,
    notificationPort,
    workspaceTeardownService: workspaceScoped.workspaceTeardownService,
    appQuit: () => app.quit(),
    emitInstructionGenerateProgress,
  });

  let dispatch = createDispatcher(buildHandlers(buildDeps()));

  async function switchActiveWorkspace(id: string): Promise<Workspace> {
    workspaceScoped.sessionService.killAll();
    const target = await workspaceService.switchTo(id);
    const dataDir = target.rootPath === home ? workspacePath : join(target.rootPath, '.ai-companion');
    workspaceScoped = buildWorkspaceScopedServices(dataDir, sharedDeps);
    attachSessionBridges(workspaceScoped);
    dispatch = createDispatcher(buildHandlers(buildDeps()));
    return target;
  }
```

`emitInstructionGenerateProgress` keeps its existing definition (unchanged, still above this block).

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — must pass.

Run: `npm run dev`, then manually:
1. Open the app, note the Skills/Agents lists (should show your real `~/.ai-companion` data).
2. Create a temp folder (e.g. `mktemp -d`).
3. Via the DevTools console (`window.api.call('workspace.create', { name: 'Test', rootPath: '<temp-folder>' })`), create a second workspace — Task 9/10 will replace this with real UI, but the IPC method is fully wired now.
4. `window.api.call('workspace.switchTo', { id: '<returned-id>' })`, then re-open the Skills screen — it should now be empty (fresh data dir).
5. Switch back to `'default'` and confirm the original data is intact.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: rebuild the Entity-backed service graph on workspace.switchTo"
```

---

## Task 9: Renderer — `use-workspaces` hooks

**Files:**
- Create: `src/renderer/hooks/use-workspaces.ts`
- Test: `tests/renderer/hooks/use-workspaces.test.tsx`

**Interfaces:**
- Consumes: `callIpc` (`src/renderer/lib/ipc.js`, existing), `queryClient` (`src/renderer/lib/query-client.js`, existing).
- Produces: `useWorkspaces()` (query `['workspace', 'list']`), `useActiveWorkspace()` (query `['workspace', 'active']`), `useCreateWorkspace()`, `useSwitchWorkspace()`, `useDeleteWorkspace()` mutation hooks. `useSwitchWorkspace`'s `onSuccess` calls `queryClient.clear()` (switching workspaces changes every Entity-backed list in the app, not just workspace state) in addition to invalidating the two workspace queries; `useCreateWorkspace`/`useDeleteWorkspace` only invalidate `['workspace', 'list']`. Consumed by Task 10.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/hooks/use-workspaces.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../src/renderer/lib/ipc.js';
import {
  useWorkspaces,
  useActiveWorkspace,
  useCreateWorkspace,
  useSwitchWorkspace,
  useDeleteWorkspace,
} from '../../../src/renderer/hooks/use-workspaces.js';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const workspace = (id = 'w1') => ({ id, name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' });

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('use-workspaces', () => {
  it('useWorkspaces fetches via workspace.list', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([workspace()]);
    const { result } = renderHook(() => useWorkspaces(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([workspace()]));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.list', {});
  });

  it('useActiveWorkspace fetches via workspace.getActive', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue(workspace('default'));
    const { result } = renderHook(() => useActiveWorkspace(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(workspace('default')));
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.getActive', {});
  });

  it('useCreateWorkspace calls workspace.create and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(workspace());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateWorkspace(), { wrapper });
    await result.current.mutateAsync({ name: 'Acme', rootPath: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith('workspace.create', { name: 'Acme', rootPath: '/repos/acme' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace', 'list'] });
  });

  it('useSwitchWorkspace calls workspace.switchTo and clears the whole cache', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(workspace());
    const clearSpy = vi.spyOn(queryClient, 'clear');
    const { result } = renderHook(() => useSwitchWorkspace(), { wrapper });
    await result.current.mutateAsync('w1');
    expect(spy).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' });
    expect(clearSpy).toHaveBeenCalled();
  });

  it('useDeleteWorkspace calls workspace.delete and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(undefined);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteWorkspace(), { wrapper });
    await result.current.mutateAsync('w1');
    expect(spy).toHaveBeenCalledWith('workspace.delete', { id: 'w1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace', 'list'] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/hooks/use-workspaces.test.tsx`
Expected: FAIL — `Cannot find module '.../use-workspaces.js'`

- [ ] **Step 3: Implement the hooks**

Create `src/renderer/hooks/use-workspaces.ts`:

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { queryClient } from '../lib/query-client.js';
import type { Workspace } from '../../shared/workspace.js';

const listKey = ['workspace', 'list'] as const;
const activeKey = ['workspace', 'active'] as const;

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: listKey,
    queryFn: () => callIpc<Workspace[]>('workspace.list', {}),
  });
}

export function useActiveWorkspace() {
  return useQuery<Workspace>({
    queryKey: activeKey,
    queryFn: () => callIpc<Workspace>('workspace.getActive', {}),
  });
}

export function useCreateWorkspace() {
  return useMutation({
    mutationFn: (input: { name: string; rootPath: string }) =>
      callIpc<Workspace>('workspace.create', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useSwitchWorkspace() {
  return useMutation({
    mutationFn: (id: string) => callIpc<Workspace>('workspace.switchTo', { id }),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useDeleteWorkspace() {
  return useMutation({
    mutationFn: (id: string) => callIpc<void>('workspace.delete', { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/hooks/use-workspaces.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/use-workspaces.ts tests/renderer/hooks/use-workspaces.test.tsx
git commit -m "feat: add react-query hooks for the Workspace registry"
```

---

## Task 10: Renderer — `WorkspaceSwitcher` in `TopNav`

**Files:**
- Create: `src/renderer/components/shell/WorkspaceSwitcher.tsx`
- Modify: `src/renderer/components/shell/TopNav.tsx`
- Test: `tests/renderer/components/shell/WorkspaceSwitcher.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaces`/`useActiveWorkspace`/`useCreateWorkspace`/`useSwitchWorkspace`/`useDeleteWorkspace` (Task 9); `callIpc` for the reused `dialog.selectFolder` method (existing).
- Produces: `WorkspaceSwitcher(): React.ReactElement` — a `Menu`-based dropdown showing the active workspace's name, every other workspace with a switch action, a delete action per non-active row, and a "Novo workspace" action that opens the native folder picker then creates a workspace named after the folder's basename (editable via a follow-up `prompt`-free inline text field, matching the "editable before saving" requirement without introducing a second dialog).

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/shell/WorkspaceSwitcher.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { WorkspaceSwitcher } from '../../../../src/renderer/components/shell/WorkspaceSwitcher.js';

const renderSwitcher = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSwitcher />
    </QueryClientProvider>,
  );

const workspaces = [
  { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' },
  { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' },
];

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method === 'workspace.list') return workspaces;
    if (method === 'workspace.getActive') return workspaces[0];
    return undefined;
  });
});

describe('WorkspaceSwitcher', () => {
  it('shows the active workspace name as the trigger label', async () => {
    renderSwitcher();
    expect(await screen.findByTestId('workspace-switcher-trigger')).toHaveTextContent('Default');
  });

  it('lists every other workspace with a switch action, opened via the trigger', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    expect(await screen.findByTestId('workspace-switch-w1')).toHaveTextContent('Acme');
  });

  it('clicking a non-active workspace calls workspace.switchTo', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    await user.click(await screen.findByTestId('workspace-switch-w1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'w1' }));
  });

  it('does not render a delete action for the active workspace', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    await screen.findByTestId('workspace-switch-w1');
    expect(screen.queryByTestId('workspace-delete-default')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-delete-w1')).toBeInTheDocument();
  });

  it('"Novo workspace" opens the folder picker and creates a workspace named after the folder', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return workspaces;
      if (method === 'workspace.getActive') return workspaces[0];
      if (method === 'dialog.selectFolder') return { canceled: false, path: '/repos/client-x' };
      if (method === 'workspace.create') return { id: 'w2', name: 'client-x', rootPath: '/repos/client-x', isDefault: false, createdAt: '' };
      return undefined;
    });
    renderSwitcher();
    await user.click(await screen.findByTestId('workspace-switcher-trigger'));
    await user.click(await screen.findByTestId('workspace-new'));
    await waitFor(() =>
      expect(ipc.callIpc).toHaveBeenCalledWith('workspace.create', { name: 'client-x', rootPath: '/repos/client-x' }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/components/shell/WorkspaceSwitcher.test.tsx`
Expected: FAIL — `Cannot find module '.../WorkspaceSwitcher.js'`

- [ ] **Step 3: Implement `WorkspaceSwitcher`**

Create `src/renderer/components/shell/WorkspaceSwitcher.tsx`:

```tsx
import { useState } from 'react';
import { Box, Button, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { callIpc } from '../../lib/ipc.js';
import {
  useActiveWorkspace,
  useCreateWorkspace,
  useDeleteWorkspace,
  useSwitchWorkspace,
  useWorkspaces,
} from '../../hooks/use-workspaces.js';

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function WorkspaceSwitcher(): React.ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data: workspaces = [] } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const switchWorkspace = useSwitchWorkspace();
  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  const close = (): void => setAnchor(null);

  const handleNew = async (): Promise<void> => {
    close();
    const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
    if (picked.canceled || !picked.path) return;
    await createWorkspace.mutateAsync({ name: basename(picked.path), rootPath: picked.path });
  };

  return (
    <Box>
      <Button
        data-testid="workspace-switcher-trigger"
        onClick={(e) => setAnchor(e.currentTarget)}
        color="inherit"
        size="small"
        endIcon={<Icon glyph={ChevronDown} size={14} />}
      >
        {active?.name ?? '…'}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        {workspaces
          .filter((w) => w.id !== active?.id)
          .map((w) => (
            <MenuItem
              key={w.id}
              data-testid={`workspace-switch-${w.id}`}
              onClick={() => {
                close();
                void switchWorkspace.mutateAsync(w.id);
              }}
            >
              <ListItemText primary={w.name} secondary={w.rootPath} />
              <Box
                component="span"
                data-testid={`workspace-delete-${w.id}`}
                role="button"
                aria-label={`Excluir ${w.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  void deleteWorkspace.mutateAsync(w.id);
                }}
                sx={{ display: 'inline-flex', ml: 1, cursor: 'pointer' }}
              >
                <Icon glyph={Trash2} size={14} />
              </Box>
            </MenuItem>
          ))}
        <MenuItem data-testid="workspace-new" onClick={() => void handleNew()}>
          <Icon glyph={Plus} size={14} />
          <Typography sx={{ ml: 1 }}>Novo workspace</Typography>
        </MenuItem>
      </Menu>
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/components/shell/WorkspaceSwitcher.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Mount it in `TopNav`**

In `src/renderer/components/shell/TopNav.tsx`, add the import:

```ts
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
```

Add `<WorkspaceSwitcher />` to the right cluster `Stack`, right after the command-palette `Tooltip`/`Button` block and before the `healthSeverity` pill:

```tsx
          <WorkspaceSwitcher />

          {healthSeverity !== undefined && (
```

- [ ] **Step 6: Run the full jsdom suite to confirm no regression**

Run: `npx vitest --project jsdom run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/shell/WorkspaceSwitcher.tsx src/renderer/components/shell/TopNav.tsx \
  tests/renderer/components/shell/WorkspaceSwitcher.test.tsx
git commit -m "feat: add workspace switcher to the top navigation bar"
```

---

## Task 11: Update reference docs

**Files:**
- Modify: `docs/reference/architecture.md`
- Modify: `docs/reference/ipc-contract.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Document the `workspace` bounded context**

In `docs/reference/architecture.md`, add a new subsection near the existing `entity`/`session` bounded-context descriptions (match that file's existing heading level and prose style — read the surrounding section first):

```markdown
### Workspace / Project

`Workspace` and `Project` are non-synced, purely organizational entities — never an `EntityKind`, never
materialized to `~/.claude/` or `~/.cursor/`. Both are flat JSON registries following the
`FsSettingsRepository` load/save/atomic-rename pattern:

- `~/.ai-companion/workspaces.json` — every known `Workspace` (`id`, `name`, `rootPath`, `isDefault`,
  `createdAt`) plus `activeWorkspaceId`. Always at this fixed location, seeded with the default workspace
  (`rootPath` = home dir) on first read. Owned by `WorkspaceService`.
- `<workspace.rootPath>/.ai-companion/projects.json` — every `Project` (`id`, `name`, `path`, `createdAt`)
  belonging to that workspace. Owned by `ProjectService`, re-pointed at a different file whenever the
  active workspace changes.

Only one workspace is "active" at a time. `workspace.switchTo` kills the outgoing workspace's live
`claude` sessions, then rebuilds the Entity-backed service graph (`FsEntityRepository`, `AdapterManager`,
`SymlinkManager`, `FileMaterializer`, `EntityService`, `SkillService`, `AgentService`,
`InstructionService`, `SessionService`, `ProjectService`, `HealthService`) against the new workspace's
data dir via `buildWorkspaceScopedServices` (`src/main/application/workspace-scoped-services.ts`) — see
`src/main/index.ts`'s `switchActiveWorkspace`. Plugin installs, marketplaces, MCP config, and adapter
on/off settings stay anchored to the workspace active at app startup; they are not (yet) per-workspace.
```

- [ ] **Step 2: Document the IPC methods**

In `docs/reference/ipc-contract.md`, add to the per-method table (match the existing table's exact column format):

```markdown
| `workspace.list` | – | `Workspace[]` | Every registered workspace. |
| `workspace.getActive` | – | `Workspace` | The currently active workspace. |
| `workspace.create` | `{ name: string; rootPath: string }` | `Workspace` | Registers a new workspace and bootstraps its `.ai-companion` data dir. Does not switch to it. |
| `workspace.switchTo` | `{ id: string }` | `Workspace` | Kills the outgoing workspace's live sessions and rebuilds the Entity-backed service graph against the target workspace. |
| `workspace.delete` | `{ id: string }` | `void` | Rejects (`validation`) if `id` is the active workspace. |
| `project.list` | – | `Project[]` | Every project registered under the active workspace. |
| `project.create` | `{ name: string; path: string }` | `Project` | |
| `project.update` | `{ id: string; name?: string; path?: string }` | `Project` | |
| `project.delete` | `{ id: string }` | `void` | |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reference/architecture.md docs/reference/ipc-contract.md
git commit -m "docs: document the Workspace/Project bounded context and IPC methods"
```

---

## Final verification

- [ ] Run `npm test` — both `node` and `jsdom` projects pass.
- [ ] Run `npm run lint` — clean.
- [ ] Run `npm run typecheck` — clean.
- [ ] Repeat the manual smoke check from Task 8 Step 4, this time through the real `WorkspaceSwitcher` UI instead of the DevTools console.
