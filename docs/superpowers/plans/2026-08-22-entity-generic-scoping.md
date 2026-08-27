# Entity Generic Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Instruction`'s closed `PersonalInstruction | ProjectInstruction` union with one flat shape carrying an optional `scopeId`, generalize `Scope` to `'personal' | 'project' | 'workspace'` on the shared `Entity` base, add a `resolveScopePath` helper the adapters and `SessionService` resolve through instead of reading `entity.repoPath` directly, lazily migrate existing on-disk `ProjectInstruction.repoPath` data to a real `Project` (from plan 1) the first time it's read, and replace the Instructions screen's raw folder-to-`repoPath` flow with one that goes through the `Project` registry.

**Architecture:** `Entity.scopeId?: string` + `Scope` gaining `'workspace'` are added to the shared base in `src/shared/entity.ts`; `Instruction` becomes one interface (`{ ...Entity; content: string; legacyRepoPath?: string }` — the last field is migration-only, set only when on-disk data predates `scopeId`). `resolveScopePath(entity, { workspaceService, projectService })` is a standalone function (not a service method, since both the adapters and `SessionService` need it) that maps `scopes[0] === 'project' | 'workspace'` + `scopeId` to a concrete absolute path via plan 1's `ProjectService`/`WorkspaceService`, throwing `DomainError('not_found')` when the reference no longer resolves. `ClaudeAdapter`/`CursorAdapter.resolveEntityDestinations` become `async` and call it (the `Adapter` port already permits `Promise<AdapterDestination[]>`, so no port change). `InstructionService.get`/`.list` detect a `legacyRepoPath`-only instruction on read, find-or-create a matching `Project` (plan 1's `ProjectService.findOrCreateByPath`, deduped by exact path), and persist the backfilled `scopeId` before returning.

**Tech Stack:** TypeScript (strict), Zod (entity schema), Vitest (`node`/`jsdom` projects), React + `@tanstack/react-query`.

**Spec:** `docs/superpowers/specs/2026-08-22-workspace-project-scope-design.md` — this is **plan 2 of 3**. It implements §2.7–2.9 and part of §2.11, the `resolveScopePath`/`Entity.scopeId`/flattened-`Instruction` parts of §3, and data flows §4.6 and §4.8. It builds on **plan 1** (`docs/superpowers/plans/2026-08-22-workspace-project-domain.md`) — `WorkspaceService`, `ProjectService`, and `buildWorkspaceScopedServices` must already exist. It does **not** implement §2.10, §2.12, or §3's `FileBrowserService`/full Workspace-screen/`SessionAnchor` material — that is **plan 3**.

## Global Constraints

- Imports use `.js` extensions (ESM + `verbatimModuleSyntax`).
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are on — build objects with conditional spreads, never assign a bare `undefined` to an optional field.
- Services depend on **ports**, never directly on `node:fs`/`electron`.
- No new dependencies.
- `npm test`, `npm run lint`, `npm run typecheck` must be green after the final task — this plan is not done until all three pass with zero exceptions (CLAUDE.md: green lint+typecheck+tests is a release gate).
- **This plan touches a type (`Instruction`) that ~15 files reference beyond the ones this plan explicitly edits** (grep `PersonalInstruction\|ProjectInstruction` across `src/` and `tests/` before starting — the count may have shifted since this plan was written). Tasks 1–11 make the substantive behavioral changes with full precision; **Task 12 is a mandatory compiler-driven sweep** that closes out every remaining reference. Do not skip it, and do not consider any earlier task "done" in isolation — `npm run typecheck` will not be clean until Task 12 lands.

---

## File structure

New files:
- `src/main/application/resolve-scope-path.ts` — `resolveScopePath`.
- `src/main/application/schemas/__tests__/entity-schema.test.ts` (or `tests/main/application/schemas/entity-schema.test.ts` — match whichever convention `tests/main/application/schemas/` already uses; create the directory if it doesn't exist yet).
- `src/renderer/hooks/use-projects.ts` — `useProjects`, `useCreateProject`, `useFindOrCreateProjectByPath`.

Modified files (substantive, full diffs in this plan):
- `src/shared/entity.ts` — flatten `Instruction`, generalize `Scope`, add `scopeId`/`legacyRepoPath`.
- `src/main/application/schemas/entity-schema.ts` — validate `scopeId` instead of `repoPath`.
- `src/main/application/entity/entity-serializer.ts` + its test — parse `scopeId`/`legacyRepoPath` from the sidecar.
- `src/main/infrastructure/entity/fs-entity-repository.ts` + its test — persist `scope`/`scopeId`, stop writing `repoPath`.
- `src/main/infrastructure/adapters/claude-adapter.ts`, `cursor-adapter.ts` + their `entity-destinations` tests — async, `resolveScopePath`-based.
- `src/main/application/entity/cursor-plugin-manifest.ts` — `PersonalInstruction` → `Instruction`.
- `src/main/application/workspace-scoped-services.ts`, `src/main/index.ts` (plan 1's files) — move Claude/Cursor adapter construction inside `buildWorkspaceScopedServices`, inject `workspaceService`/`projectService`.
- `src/main/application/services/session-service.ts` + its test — `resolveCwd` async via `resolveScopePath`.
- `src/main/application/services/instruction-service.ts` + its test — lazy migration in `get`/`list`.
- `src/main/ipc/project-handlers.ts` — add `project.findOrCreateByPath`.
- `src/renderer/screens/instructions/InstructionsScreen.tsx` — project-picker create flow, `Project`-resolved row display.
- `src/renderer/lib/blank-customization.ts` — return type `Instruction` instead of `PersonalInstruction`.
- `docs/reference/customization-schema.md`, `docs/reference/architecture.md`, `docs/reference/ipc-contract.md`.

Swept by Task 12 (compiler-driven, no pre-written diff): `src/main/application/services/__fixtures__/fake-adapter.ts`, every other adapter test under `tests/main/infrastructure/adapters/__tests__/`, `tests/main/application/services/__tests__/adapter-manager.*.test.ts`, `tests/main/application/services/entity-validator.test.ts`, `tests/renderer/screens/instructions/instructions-screen.test.tsx`, `tests/renderer/components/customization-editor.test.tsx`, and any other file the grep in that task turns up.

---

## Task 1: Flatten `Instruction`, generalize `Scope`, add `Entity.scopeId`

**Files:**
- Modify: `src/shared/entity.ts`
- Test: `tests/shared/entity.test.ts`

**Interfaces:**
- Produces: `Scope = 'personal' | 'project' | 'workspace'`; `Entity` gains `scopeId?: string`; one `Instruction extends Entity { kind: 'instruction'; content: string; legacyRepoPath?: string }` (no more `PersonalInstruction`/`ProjectInstruction`); `isPersonalInstruction(entity: Instruction): boolean` / `isProjectInstruction(entity: Instruction): boolean` become predicates over `entity.scopes[0]`; `InstructionSidecar` gains `scope?: 'project' | 'workspace'` and `scopeId?: string`, keeps `repoPath?: string` (read-only legacy field, never written again after Task 4). Consumed by every later task in this plan.

`legacyRepoPath` is set **only** by `parseEntityFile` (Task 3) when it finds an on-disk sidecar with the old `repoPath` field and no `scopeId` yet. `InstructionService.get`/`.list` (Task 9) detect it, find-or-create a `Project`, persist the backfilled `scopeId`, and never return it again — it is never present on a freshly-created or already-migrated instruction.

- [ ] **Step 1: Write the failing tests**

Add to `tests/shared/entity.test.ts` (new import additions plus a new `describe` block at the end of the file):

```ts
import {
  entityUrn,
  parseUrn,
  isPluginSource,
  isWorkspaceSource,
  isPersonalInstruction,
  isProjectInstruction,
  WORKSPACE_SOURCE,
  type Instruction,
  type Skill,
} from '../../src/shared/entity.js';
```

(Replaces the existing import block's final two lines — keep `entityUrn`, `parseUrn`, `isPluginSource`, `isWorkspaceSource`, `WORKSPACE_SOURCE`, `Skill` exactly as they are, just add the four new names.)

```ts
describe('Instruction scoping', () => {
  const base = {
    urn: 'urn:instruction:x',
    kind: 'instruction' as const,
    description: '',
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: WORKSPACE_SOURCE,
    content: '# Body\n',
  };

  it('isPersonalInstruction / isProjectInstruction read scopes[0]', () => {
    const personal: Instruction = { ...base, name: 'default', scopes: ['personal'] };
    const project: Instruction = { ...base, name: 'acme', scopes: ['project'], scopeId: 'proj-1' };
    expect(isPersonalInstruction(personal)).toBe(true);
    expect(isProjectInstruction(personal)).toBe(false);
    expect(isProjectInstruction(project)).toBe(true);
    expect(isPersonalInstruction(project)).toBe(false);
  });

  it('accepts a workspace-scoped instruction with scopeId', () => {
    const workspaceScoped: Instruction = {
      ...base, name: 'ws-wide', scopes: ['workspace'], scopeId: 'ws-1',
    };
    expect(workspaceScoped.scopes[0]).toBe('workspace');
    expect(workspaceScoped.scopeId).toBe('ws-1');
  });

  it('carries legacyRepoPath instead of scopeId for pre-migration data', () => {
    const legacy: Instruction = {
      ...base, name: 'legacy-acme', scopes: ['project'], legacyRepoPath: '/repos/legacy-acme',
    };
    expect(legacy.scopeId).toBeUndefined();
    expect(legacy.legacyRepoPath).toBe('/repos/legacy-acme');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/shared/entity.test.ts`
Expected: FAIL — `scopeId`/`legacyRepoPath` aren't known properties yet, `isPersonalInstruction`/`isProjectInstruction` aren't exported as free functions over the union shape.

- [ ] **Step 3: Replace the union with one flat `Instruction` interface**

In `src/shared/entity.ts`, change `export type Scope = 'personal' | 'project';` to:

```ts
export type Scope = 'personal' | 'project' | 'workspace';
```

Add `scopeId` to the `Entity` interface (right after `scopes: Scope[];`):

```ts
export interface Entity {
  urn: string;
  kind: EntityKind;
  name: string;
  description: string;
  scopes: Scope[];
  scopeId?: string;
  metadata: EntityMetadata;
  source: EntitySource;
  ext?: Record<string, unknown>;
}
```

Replace the `PersonalInstruction`/`ProjectInstruction`/`Instruction`/`isPersonalInstruction`/`isProjectInstruction` block with:

```ts
/**
 * `name === 'default'` and `scopes === ['personal']` identify the personal
 * singleton; any other instruction carries `scopes[0] === 'project' | 'workspace'`
 * and a `scopeId` resolved against `Project.id` / `Workspace.id` (see
 * `resolveScopePath`). `legacyRepoPath` is set only on read, only for
 * pre-migration on-disk data that predates `scopeId` — see
 * `InstructionService.get`/`.list`.
 */
export interface Instruction extends Entity {
  kind: 'instruction';
  content: string;
  legacyRepoPath?: string;
}

export function isPersonalInstruction(entity: Instruction): boolean {
  return entity.scopes[0] === 'personal';
}

export function isProjectInstruction(entity: Instruction): boolean {
  return entity.scopes[0] === 'project';
}
```

Replace `InstructionSidecar`:

```ts
export interface InstructionSidecar {
  description: string;
  version: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  /** Current shape (post scopeId migration). */
  scope?: 'project' | 'workspace';
  scopeId?: string;
  /** Legacy shape — read-only. Never written again after the scopeId migration lands. */
  repoPath?: string;
}
```

`entityUrn`/`parseUrn`/`EntityKind`/`EntitySource`/`EntityMetadata`/`Skill`/`Agent` are unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/shared/entity.test.ts`
Expected: PASS

Note: `npx tsc --noEmit` will now report errors in every other file that still references `PersonalInstruction`/`ProjectInstruction` or reads `.repoPath` off an `Instruction`. That is expected until Task 12 — do not chase those errors yet.

- [ ] **Step 5: Commit**

```bash
git add src/shared/entity.ts tests/shared/entity.test.ts
git commit -m "feat: flatten Instruction and generalize Entity scoping to scopeId"
```

---

## Task 2: Update entity schema validation for generic scoping

**Files:**
- Modify: `src/main/application/schemas/entity-schema.ts`
- Test: `tests/main/application/schemas/entity-schema.test.ts` (new)

**Interfaces:**
- Consumes: `Scope` from Task 1.
- Produces: `instructionEntitySchema` now validates `scopeId` (not `repoPath`) against `scopes[0]`; `skillEntitySchema`/`agentEntitySchema` keep their existing `skillAgentScopes` restriction to `['personal']` unchanged (per CLAUDE.md's documented TODO and this spec's §2.7: "the schema/type unlocks in this slice — the editor UI... stays Instruction-only; Skill/Agent keep validating `['personal']` only until a later pass"). No exported name changes — `EntityValidator` needs no edits.

- [ ] **Step 1: Write the failing test**

Create `tests/main/application/schemas/entity-schema.test.ts` (create the `tests/main/application/schemas/` directory if it doesn't exist):

```ts
import { describe, it, expect } from 'vitest';
import { instructionEntitySchema } from '../../../../src/main/application/schemas/entity-schema.js';
import { WORKSPACE_SOURCE } from '../../../../src/shared/entity.js';

const meta = { version: '0.1.0', createdAt: '', updatedAt: '' };
const base = {
  urn: 'urn:instruction:x', kind: 'instruction' as const, description: '',
  metadata: meta, source: WORKSPACE_SOURCE, content: '# Body\n',
};

describe('instructionEntitySchema', () => {
  it('accepts the personal singleton with no scopeId', () => {
    const result = instructionEntitySchema.safeParse({ ...base, name: 'default', scopes: ['personal'] });
    expect(result.success).toBe(true);
  });

  it('rejects a personal instruction carrying a scopeId', () => {
    const result = instructionEntitySchema.safeParse({
      ...base, name: 'default', scopes: ['personal'], scopeId: 'proj-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name "default" for a project-scoped instruction', () => {
    const result = instructionEntitySchema.safeParse({
      ...base, name: 'default', scopes: ['project'], scopeId: 'proj-1',
    });
    expect(result.success).toBe(false);
  });

  it('requires a non-empty scopeId for project scope', () => {
    const result = instructionEntitySchema.safeParse({ ...base, name: 'acme', scopes: ['project'] });
    expect(result.success).toBe(false);
  });

  it('accepts a workspace-scoped instruction with a scopeId', () => {
    const result = instructionEntitySchema.safeParse({
      ...base, name: 'ws-wide', scopes: ['workspace'], scopeId: 'ws-1',
    });
    expect(result.success).toBe(true);
  });

  it('requires a non-empty scopeId for workspace scope too', () => {
    const result = instructionEntitySchema.safeParse({ ...base, name: 'ws-wide', scopes: ['workspace'] });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/application/schemas/entity-schema.test.ts`
Expected: FAIL — the current schema still requires an absolute-path `repoPath` and rejects `'workspace'` scope.

- [ ] **Step 3: Update the schema**

In `src/main/application/schemas/entity-schema.ts`, change the shared `scopes` const:

```ts
const scopes = z
  .array(z.enum(['personal', 'project', 'workspace']))
  .min(1, 'scopes must have at least 1 entry')
  .refine((arr) => new Set(arr).size === arr.length, { message: 'scopes must not contain duplicates' });
```

Replace `instructionEntitySchema` in full:

```ts
// Instruction: discriminated by scopes[0]. Because Zod's discriminatedUnion
// requires a top-level literal discriminator (and 'scopes' is a tuple, not a
// scalar), we branch via superRefine on the shared shape.
export const instructionEntitySchema = entityBase
  .extend({
    kind: z.literal('instruction'),
    content: z.string(),
    scopes: z.tuple([z.enum(['personal', 'project', 'workspace'])], {
      message: 'instruction scopes must be exactly ["personal"], ["project"] or ["workspace"]',
    }),
    scopeId: z.string().optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const scope = val.scopes[0];
    if (scope === 'personal') {
      if (val.name !== 'default') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'personal instruction name must be "default"',
        });
      }
      if (val.scopeId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scopeId'],
          message: 'personal instruction must not carry scopeId',
        });
      }
    } else {
      if (val.name === 'default') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'non-personal instruction name cannot be "default" (reserved for personal singleton)',
        });
      }
      if (typeof val.scopeId !== 'string' || val.scopeId.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scopeId'],
          message: `${scope} instruction requires a non-empty scopeId`,
        });
      }
    }
  });
```

Remove the now-unused `import { isAbsolute } from 'node:path';` at the top of the file — nothing else in the file uses it after `repoPath`'s absolute-path check is gone. `skillAgentScopes`, `skillEntitySchema`, `agentEntitySchema` are unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/application/schemas/entity-schema.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/application/schemas/entity-schema.ts tests/main/application/schemas/entity-schema.test.ts
git commit -m "feat: validate instruction scopeId instead of repoPath in entity schema"
```

---

## Task 3: Update the entity serializer for `scopeId` + legacy `repoPath`

**Files:**
- Modify: `src/main/application/entity/entity-serializer.ts`
- Test: `tests/main/application/entity/entity-serializer.test.ts`

**Interfaces:**
- Consumes: `InstructionSidecar.scope`/`.scopeId`/`.repoPath` (Task 1).
- Produces: `parseEntityFile` returns an `Instruction` with `scopeId` set when the sidecar has one; with `legacyRepoPath` set (and no `scopeId`) when the sidecar only has the old `repoPath`; throws when neither is present for a non-personal instruction. `readScopes` accepts `'workspace'`. `renderEntityFile` is unchanged (it never touched `repoPath`/`scopeId` — instructions are frontmatter-free).

- [ ] **Step 1: Write the failing tests**

In `tests/main/application/entity/entity-serializer.test.ts`, replace the two tests at the end of the `'instruction — frontmatter-free'` block (currently "emits a project instruction when name != default and sidecar.repoPath is present" and "throws when a project instruction is parsed without sidecar.repoPath") with:

```ts
  it('emits a project instruction with scopeId when sidecar.scopeId is present', () => {
    const raw = '# Body\n';
    const ins = parseEntityFile({
      kind: 'instruction', name: 'acme', raw, source: WORKSPACE_SOURCE,
      instructionSidecar: {
        description: 'Acme rules', version: '0.1.0', createdAt: '', updatedAt: '',
        scope: 'project', scopeId: 'proj-1',
      },
    }) as Instruction;
    expect(ins.name).toBe('acme');
    expect(ins.scopes).toEqual(['project']);
    expect(ins.scopeId).toBe('proj-1');
    expect(ins.legacyRepoPath).toBeUndefined();
  });

  it('emits a workspace-scoped instruction when sidecar.scope is "workspace"', () => {
    const raw = '# Body\n';
    const ins = parseEntityFile({
      kind: 'instruction', name: 'ws-wide', raw, source: WORKSPACE_SOURCE,
      instructionSidecar: {
        description: 'Workspace rules', version: '0.1.0', createdAt: '', updatedAt: '',
        scope: 'workspace', scopeId: 'ws-1',
      },
    }) as Instruction;
    expect(ins.scopes).toEqual(['workspace']);
    expect(ins.scopeId).toBe('ws-1');
  });

  it('flags a legacy repoPath sidecar as scopes:["project"] with legacyRepoPath, no scopeId', () => {
    const raw = '# Body\n';
    const ins = parseEntityFile({
      kind: 'instruction', name: 'acme', raw, source: WORKSPACE_SOURCE,
      instructionSidecar: {
        description: 'Acme rules', version: '0.1.0', createdAt: '', updatedAt: '',
        repoPath: '/Users/me/projects/acme',
      },
    }) as Instruction;
    expect(ins.scopes).toEqual(['project']);
    expect(ins.scopeId).toBeUndefined();
    expect(ins.legacyRepoPath).toBe('/Users/me/projects/acme');
  });

  it('throws when a non-personal instruction has neither scopeId nor legacy repoPath', () => {
    expect(() =>
      parseEntityFile({ kind: 'instruction', name: 'acme', raw: 'x', source: WORKSPACE_SOURCE }),
    ).toThrow(/scopeId/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/entity/entity-serializer.test.ts`
Expected: FAIL — `parseEntityFile` still throws on missing `repoPath` unconditionally and doesn't know `scopeId`/`legacyRepoPath`.

- [ ] **Step 3: Update `entity-serializer.ts`**

Change the import list at the top (drop `PersonalInstruction`/`ProjectInstruction`, they no longer exist):

```ts
import type {
  Agent,
  Entity,
  EntityKind,
  EntityMetadata,
  EntitySource,
  Instruction,
  InstructionSidecar,
  Scope,
  Skill,
} from '../../../shared/entity.js';
```

Update `readScopes`:

```ts
function readScopes(fm: Record<string, unknown>): Scope[] {
  const raw = fm['scopes'];
  if (Array.isArray(raw)) {
    return raw.filter((s): s is Scope => s === 'personal' || s === 'project' || s === 'workspace');
  }
  return ['personal'];
}
```

Replace the `if (kind === 'instruction') { ... }` block inside `parseEntityFile` (everything from `if (name === 'default') {` through the final `throw new Error(...)` for the instruction branch):

```ts
    if (name === 'default') {
      const personal: Instruction = {
        urn: entityUrn('instruction', name),
        kind: 'instruction',
        name: 'default',
        description: sidecar.description,
        scopes: ['personal'],
        metadata: meta,
        source,
        content: body,
      };
      return personal;
    }
    if (sidecar.scopeId !== undefined && sidecar.scopeId !== '') {
      const scoped: Instruction = {
        urn: entityUrn('instruction', name),
        kind: 'instruction',
        name,
        description: sidecar.description,
        scopes: [sidecar.scope ?? 'project'],
        scopeId: sidecar.scopeId,
        metadata: meta,
        source,
        content: body,
      };
      return scoped;
    }
    if (sidecar.repoPath !== undefined && sidecar.repoPath !== '') {
      // Pre-migration shape: no scopeId persisted yet. InstructionService
      // lazily finds-or-creates a matching Project and re-saves with a real
      // scopeId — see InstructionService.get/.list.
      const legacy: Instruction = {
        urn: entityUrn('instruction', name),
        kind: 'instruction',
        name,
        description: sidecar.description,
        scopes: ['project'],
        legacyRepoPath: sidecar.repoPath,
        metadata: meta,
        source,
        content: body,
      };
      return legacy;
    }
    throw new Error(
      `parseEntityFile: non-personal instruction '${name}' requires sidecar.scopeId (or legacy sidecar.repoPath)`,
    );
```

`renderEntityFile`, the skill/agent branches of `parseEntityFile`, `metaFrontmatter`, `readMetadata`, `extOf` are all unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/entity/entity-serializer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/application/entity/entity-serializer.ts tests/main/application/entity/entity-serializer.test.ts
git commit -m "feat: parse instruction scopeId from sidecar, flag legacy repoPath for migration"
```

---

## Task 4: Update `FsEntityRepository` to persist `scope`/`scopeId`, stop writing `repoPath`

**Files:**
- Modify: `src/main/infrastructure/entity/fs-entity-repository.ts`
- Test: `tests/main/infrastructure/entity/fs-entity-repository.test.ts`

**Interfaces:**
- Consumes: `InstructionSidecar.scope`/`.scopeId`/`.repoPath` (Task 1), updated `parseEntityFile` (Task 3).
- Produces: `saveInstruction` writes `{ ..., scope, scopeId }` to `meta.json`, never `repoPath`. `parseSidecar` still reads `repoPath` off raw JSON (so legacy on-disk files keep parsing) alongside the new `scope`/`scopeId` keys.

- [ ] **Step 1: Write the failing tests**

In `tests/main/infrastructure/entity/fs-entity-repository.test.ts`, replace the `projectInstruction` fixture (lines 76-86) and the two tests that follow it ("save writes body..." and "get rehydrates repoPath...") — everything from `describe('FsEntityRepository — project instruction storage', ...)`'s opening fixture through the end of the second test — with:

```ts
describe('FsEntityRepository — project instruction storage', () => {
  const projectInstruction = (name = 'acme', scopeId = 'proj-1'): Instruction => ({
    urn: `urn:instruction:${name}`,
    kind: 'instruction',
    name,
    description: `${name} rules`,
    scopes: ['project'],
    scopeId,
    metadata: meta,
    source: WORKSPACE_SOURCE,
    content: `# ${name}\n\nProject-only rules.\n`,
  });

  it('save writes body under project/<slug>/INSTRUCTION.md and meta.json with scope+scopeId', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save(projectInstruction('acme', 'proj-1'));

    const body = await readFile(join(ws, 'instructions', 'project', 'acme', 'INSTRUCTION.md'), 'utf8');
    expect(body.startsWith('---')).toBe(false);
    expect(body).toContain('Project-only rules.');

    const metaJson = JSON.parse(
      await readFile(join(ws, 'instructions', 'project', 'acme', 'meta.json'), 'utf8'),
    );
    expect(metaJson).toMatchObject({
      description: 'acme rules',
      version: '0.1.0',
      scope: 'project',
      scopeId: 'proj-1',
    });
    expect(metaJson.repoPath).toBeUndefined();
  });

  it('get rehydrates scopeId, description and version from meta.json', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save(projectInstruction('bravo', 'proj-2'));
    const back = (await repo.get('urn:instruction:bravo')) as Instruction;
    expect(back.name).toBe('bravo');
    expect(back.scopeId).toBe('proj-2');
    expect(back.scopes).toEqual(['project']);
    expect(back.description).toBe('bravo rules');
    expect(back.metadata.version).toBe('0.1.0');
    expect(back.content).toContain('Project-only rules.');
  });

  it('get surfaces a legacy repoPath-only meta.json as legacyRepoPath with no scopeId', async () => {
    const dir = join(ws, 'instructions', 'project', 'legacy-acme');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'INSTRUCTION.md'), '# Legacy project rules\n', 'utf8');
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({
        description: 'legacy rules', version: '0.1.0', createdAt: '', updatedAt: '',
        repoPath: '/repos/legacy-acme',
      }, null, 2)}\n`,
      'utf8',
    );
    const repo = new FsEntityRepository(ws);
    const back = (await repo.get('urn:instruction:legacy-acme')) as Instruction;
    expect(back.scopeId).toBeUndefined();
    expect(back.legacyRepoPath).toBe('/repos/legacy-acme');
  });
```

(The `projectInstruction(name, repoPath)` calls in the *remaining* tests in this `describe` block — "get rejects with not_found...", "get rejects with validation...", "list returns personal singleton...", "delete removes...", "delete of a missing...", "exists returns true..." — now call `projectInstruction('acme', 'proj-1')` etc. with a `scopeId` as the second arg instead of a `repoPath`; the fixture's new signature already accepts that positionally, so those call sites don't need to change at all, only the fixture definition and the two tests replaced above.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/infrastructure/entity/fs-entity-repository.test.ts`
Expected: FAIL — `saveInstruction` still writes `repoPath`, not `scope`/`scopeId`.

- [ ] **Step 3: Update `saveInstruction` and `parseSidecar`**

Replace the sidecar-building block inside `saveInstruction` (from `// Project: write body + meta.json atomically-per-file.` through the closing `return entity;` of that method):

```ts
    // Project/workspace: write body + meta.json atomically-per-file.
    const paths = await this.projectInstructionPaths(entity.name);
    await mkdir(paths.dir, { recursive: true });
    const body = renderEntityFile(entity);
    const scope = entity.scopes[0];
    const sidecar: InstructionSidecar = {
      description: entity.description,
      version: entity.metadata.version,
      ...(entity.metadata.tags !== undefined ? { tags: entity.metadata.tags } : {}),
      createdAt: entity.metadata.createdAt,
      updatedAt: entity.metadata.updatedAt,
      ...(scope === 'project' || scope === 'workspace' ? { scope } : {}),
      ...(entity.scopeId !== undefined ? { scopeId: entity.scopeId } : {}),
    };
    await writeFileAtomic(paths.body, body);
    await writeFileAtomic(paths.meta, `${JSON.stringify(sidecar, null, 2)}\n`);
    return entity;
```

Replace `parseSidecar` in full:

```ts
function parseSidecar(raw: string, urn: string): InstructionSidecar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainError('validation', `Invalid meta.json for ${urn}: not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DomainError('validation', `Invalid meta.json for ${urn}: expected object`);
  }
  const obj = parsed as Record<string, unknown>;
  const str = (key: string, def = ''): string =>
    typeof obj[key] === 'string' ? (obj[key] as string) : def;
  const scopeRaw = obj['scope'];
  const sidecar: InstructionSidecar = {
    description: str('description'),
    version: str('version', '0.0.0'),
    createdAt: str('createdAt'),
    updatedAt: str('updatedAt'),
    ...(Array.isArray(obj['tags']) ? { tags: obj['tags'] as string[] } : {}),
    ...(scopeRaw === 'project' || scopeRaw === 'workspace' ? { scope: scopeRaw } : {}),
    ...(typeof obj['scopeId'] === 'string' ? { scopeId: obj['scopeId'] } : {}),
    ...(typeof obj['repoPath'] === 'string' ? { repoPath: obj['repoPath'] } : {}),
  };
  return sidecar;
}
```

`saveInstruction`'s personal-instruction early-return branch, `get`/`getInstruction`/`delete`/`exists`/`list`/`listInstructions`/`writeFileAtomic` are all unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/infrastructure/entity/fs-entity-repository.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/entity/fs-entity-repository.ts tests/main/infrastructure/entity/fs-entity-repository.test.ts
git commit -m "feat: persist instruction scope/scopeId in sidecar instead of repoPath"
```

---

## Task 5: `resolveScopePath`

**Files:**
- Create: `src/main/application/resolve-scope-path.ts`
- Test: `tests/main/application/resolve-scope-path.test.ts`

**Interfaces:**
- Consumes: `Pick<WorkspaceService, 'get'>`, `Pick<ProjectService, 'get'>` (plan 1).
- Produces: `resolveScopePath(entity: Entity, deps: { workspaceService: Pick<WorkspaceService, 'get'>; projectService: Pick<ProjectService, 'get'> }): Promise<string>`. Throws `DomainError('validation', ...)` when `scopes[0]` is `'project'`/`'workspace'` but `scopeId` is missing; propagates the `DomainError('not_found', ...)` `WorkspaceService.get`/`ProjectService.get` already throw for an unresolvable id; throws `DomainError('internal', ...)` for `'personal'` scope (callers must branch on `'personal'` before calling this — matches how the adapters and `SessionService` already special-case personal destinations today). Consumed by Task 7 (adapters), Task 8 (`SessionService`).

- [ ] **Step 1: Write the failing tests**

Create `tests/main/application/resolve-scope-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveScopePath } from '../../../src/main/application/resolve-scope-path.js';
import { DomainError } from '../../../src/main/domain/errors.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../src/shared/entity.js';

const base = {
  urn: 'urn:instruction:x', kind: 'instruction' as const, name: 'x', description: '',
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'x',
};

describe('resolveScopePath', () => {
  it('resolves a project scope via projectService.get', async () => {
    const entity: Instruction = { ...base, scopes: ['project'], scopeId: 'proj-1' };
    const deps = {
      workspaceService: { get: async () => { throw new Error('should not be called'); } },
      projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
    };
    expect(await resolveScopePath(entity, deps)).toBe('/repos/acme');
  });

  it('resolves a workspace scope via workspaceService.get', async () => {
    const entity: Instruction = { ...base, scopes: ['workspace'], scopeId: 'ws-1' };
    const deps = {
      workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
      projectService: { get: async () => { throw new Error('should not be called'); } },
    };
    expect(await resolveScopePath(entity, deps)).toBe('/repos/ws');
  });

  it('throws validation when scope is project but scopeId is missing', async () => {
    const entity: Instruction = { ...base, scopes: ['project'] };
    const deps = { workspaceService: { get: async () => { throw new Error('n/a'); } }, projectService: { get: async () => { throw new Error('n/a'); } } };
    const err = await resolveScopePath(entity, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('validation');
  });

  it('propagates not_found when the referenced project no longer exists', async () => {
    const entity: Instruction = { ...base, scopes: ['project'], scopeId: 'gone' };
    const deps = {
      workspaceService: { get: async () => { throw new Error('n/a'); } },
      projectService: { get: async () => { throw new DomainError('not_found', 'Project not found: gone'); } },
    };
    await expect(resolveScopePath(entity, deps)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws internal for personal scope — callers must branch before calling this', async () => {
    const entity: Instruction = { ...base, scopes: ['personal'], name: 'default' };
    const deps = { workspaceService: { get: async () => { throw new Error('n/a'); } }, projectService: { get: async () => { throw new Error('n/a'); } } };
    const err = await resolveScopePath(entity, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('internal');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/resolve-scope-path.test.ts`
Expected: FAIL — `Cannot find module '.../resolve-scope-path.js'`

- [ ] **Step 3: Implement `resolveScopePath`**

Create `src/main/application/resolve-scope-path.ts`:

```ts
import type { Entity } from '../../shared/entity.js';
import type { WorkspaceService } from './services/workspace-service.js';
import type { ProjectService } from './services/project-service.js';
import { DomainError } from '../domain/errors.js';

export interface ResolveScopePathDeps {
  workspaceService: Pick<WorkspaceService, 'get'>;
  projectService: Pick<ProjectService, 'get'>;
}

export async function resolveScopePath(entity: Entity, deps: ResolveScopePathDeps): Promise<string> {
  const scope = entity.scopes[0];

  if (scope === 'project') {
    if (entity.scopeId === undefined) {
      throw new DomainError('validation', `Entity ${entity.urn} has scope 'project' but no scopeId`);
    }
    const project = await deps.projectService.get(entity.scopeId);
    return project.path;
  }

  if (scope === 'workspace') {
    if (entity.scopeId === undefined) {
      throw new DomainError('validation', `Entity ${entity.urn} has scope 'workspace' but no scopeId`);
    }
    const workspace = await deps.workspaceService.get(entity.scopeId);
    return workspace.rootPath;
  }

  throw new DomainError('internal', `resolveScopePath: scope '${scope}' has no path — callers must branch on 'personal' first`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/resolve-scope-path.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/application/resolve-scope-path.ts tests/main/application/resolve-scope-path.test.ts
git commit -m "feat: add resolveScopePath, mapping entity scope+scopeId to an absolute path"
```

---

## Task 6: `project.findOrCreateByPath` IPC method

**Files:**
- Modify: `src/main/ipc/project-handlers.ts`
- Test: `tests/main/ipc/typed-handlers.test.ts`

**Interfaces:**
- Consumes: `ProjectService.findOrCreateByPath` (plan 1, already implemented, not yet exposed over IPC).
- Produces: `buildProjectHandlers` gains `project.findOrCreateByPath`. Consumed by Task 11 (renderer's project-picker create flow) — this keeps the "same folder picked twice → same `Project`, not a duplicate" dedup guarantee end-to-end from the UI, not just from server-side migration.

- [ ] **Step 1: Write the failing test**

Add to `tests/main/ipc/typed-handlers.test.ts`, inside the existing `describe('project-handlers', ...)` block:

```ts
  it('project.findOrCreateByPath passes the path through', async () => {
    const svc = setupProjectService();
    const spy = vi.spyOn(svc, 'findOrCreateByPath');
    const h = buildProjectHandlers(svc);
    await h['project.findOrCreateByPath']!({ path: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith('/repos/acme');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: FAIL — `h['project.findOrCreateByPath']` is `undefined`.

- [ ] **Step 3: Add the handler**

In `src/main/ipc/project-handlers.ts`, add one entry to the object `buildProjectHandlers` returns (after `'project.create'`):

```ts
    'project.findOrCreateByPath': async (params) => {
      const raw = asObject(params, 'project.findOrCreateByPath');
      return service.findOrCreateByPath(asString(raw['path'], 'path'));
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/project-handlers.ts tests/main/ipc/typed-handlers.test.ts
git commit -m "feat: expose project.findOrCreateByPath over IPC"
```

---

## Task 7: Adapters become `resolveScopePath`-based and async

**Files:**
- Modify: `src/main/infrastructure/adapters/claude-adapter.ts`
- Modify: `src/main/infrastructure/adapters/cursor-adapter.ts`
- Modify: `src/main/application/entity/cursor-plugin-manifest.ts`
- Modify: `src/main/application/ports/adapter.ts`
- Modify: `src/main/application/workspace-scoped-services.ts`, `src/main/index.ts` (plan 1's files)
- Test: `tests/main/infrastructure/adapters/__tests__/claude-adapter.entity-destinations.test.ts`
- Test: `tests/main/infrastructure/adapters/__tests__/cursor-adapter.entity-destinations.test.ts`

**Interfaces:**
- Consumes: `resolveScopePath` (Task 5), `WorkspaceService`/`ProjectService` (plan 1).
- Produces: `AdapterDestination.scope` gains `'workspace'`. `ClaudeAdapterDeps`/`CursorAdapterDeps` gain `workspaceService: Pick<WorkspaceService, 'get'>` and `projectService: Pick<ProjectService, 'get'>`. `resolveEntityDestinations` becomes `async` on both adapters (the `Adapter` port already types it as `Promise<AdapterDestination[]> | AdapterDestination[]`, so this is not a port-signature change). `buildWorkspaceScopedServices` (plan 1) now constructs `claudeAdapter`/`cursorAdapter` **inside** itself instead of receiving them as already-built shared deps, since they now depend on the per-workspace `projectService`.

**Why the plan-1 composition-root change is necessary:** plan 1 built `claudeAdapter`/`cursorAdapter` once, outside `buildWorkspaceScopedServices`, because at the time they only needed a static `homedir`. Now they need `projectService`, which is rebuilt on every `workspace.switchTo` — an adapter instance built before the first switch would keep resolving project-scoped instructions against the *previous* workspace's projects. Moving their construction inside `buildWorkspaceScopedServices` fixes this; `workspaceService` (never rebuilt, per plan 1) is threaded through from `WorkspaceScopedSharedDeps` unchanged.

- [ ] **Step 1: Write the failing tests**

Replace `tests/main/infrastructure/adapters/__tests__/claude-adapter.entity-destinations.test.ts` in full:

```ts
import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { DomainError } from '../../../../../src/main/domain/errors.js';
import {
  WORKSPACE_SOURCE,
  type Agent,
  type Instruction,
  type Skill,
} from '../../../../../src/shared/entity.js';

const meta = { version: '0.1.0', createdAt: '', updatedAt: '' };

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
};

const adapter = new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps });

describe('ClaudeAdapter.resolveEntityDestinations', () => {
  it('routes a personal skill to ~/.claude/skills/<name>', async () => {
    const skill: Skill = { urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: skill })).toEqual([
      { scope: 'personal', destination: '/home/u/.claude/skills/demo', strategy: 'symlink' },
    ]);
  });

  it('fans the personal instruction out to both ~/.claude/CLAUDE.md and ~/AGENTS.md', async () => {
    const ins: Instruction = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
      description: '', scopes: ['personal'], metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    expect(await adapter.resolveEntityDestinations({ entity: ins })).toEqual([
      { scope: 'personal', destination: '/home/u/.claude/CLAUDE.md', strategy: 'symlink' },
      { scope: 'personal', destination: '/home/u/AGENTS.md', strategy: 'symlink' },
    ]);
  });

  it('drops project-scoped skill/agent destinations while linkedRepos is being replaced', async () => {
    const skill: Skill = { urn: 'urn:skill:multi', kind: 'skill', name: 'multi', description: 'd',
      scopes: ['personal', 'project'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: skill })).toEqual([
      { scope: 'personal', destination: '/home/u/.claude/skills/multi', strategy: 'symlink' },
    ]);
  });

  it('returns [] for a project-only agent (linkedRepos gone; no per-agent repoPath yet)', async () => {
    const agent: Agent = { urn: 'urn:agent:triage', kind: 'agent', name: 'triage', description: 'd',
      scopes: ['project'], metadata: meta, source: WORKSPACE_SOURCE, systemPrompt: 'b' };
    expect(await adapter.resolveEntityDestinations({ entity: agent })).toEqual([]);
  });

  it('routes a project instruction to <resolved project path>/{.claude/CLAUDE.md, AGENTS.md}', async () => {
    const ins: Instruction = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
      description: '', scopes: ['project'], scopeId: 'proj-1', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    expect(await adapter.resolveEntityDestinations({ entity: ins })).toEqual([
      { scope: 'project', destination: '/repos/acme/.claude/CLAUDE.md', strategy: 'symlink' },
      { scope: 'project', destination: '/repos/acme/AGENTS.md', strategy: 'symlink' },
    ]);
  });

  it('routes a workspace instruction to <resolved workspace root>/{.claude/CLAUDE.md, AGENTS.md}', async () => {
    const wsAdapter = new ClaudeAdapter({
      homedir: '/home/u',
      workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
      projectService: { get: async () => { throw new Error('not stubbed'); } },
    });
    const ins: Instruction = {
      urn: 'urn:instruction:ws-wide', kind: 'instruction', name: 'ws-wide',
      description: '', scopes: ['workspace'], scopeId: 'ws-1', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    expect(await wsAdapter.resolveEntityDestinations({ entity: ins })).toEqual([
      { scope: 'workspace', destination: '/repos/ws/.claude/CLAUDE.md', strategy: 'symlink' },
      { scope: 'workspace', destination: '/repos/ws/AGENTS.md', strategy: 'symlink' },
    ]);
  });

  it('rejects when the referenced project no longer exists', async () => {
    const goneAdapter = new ClaudeAdapter({
      homedir: '/home/u',
      workspaceService: { get: async () => { throw new Error('not stubbed'); } },
      projectService: { get: async () => { throw new DomainError('not_found', 'Project not found'); } },
    });
    const ins: Instruction = {
      urn: 'urn:instruction:gone', kind: 'instruction', name: 'gone',
      description: '', scopes: ['project'], scopeId: 'gone', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    await expect(goneAdapter.resolveEntityDestinations({ entity: ins })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('preserves non-ASCII / spaced paths as-is', async () => {
    const accented = new ClaudeAdapter({ homedir: '/Users/José Silva', ...scopeDeps });
    const skill: Skill = { urn: 'urn:skill:review', kind: 'skill', name: 'review', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' };
    const [personal] = await accented.resolveEntityDestinations({ entity: skill });
    expect(personal?.destination).toBe('/Users/José Silva/.claude/skills/review');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/infrastructure/adapters/__tests__/claude-adapter.entity-destinations.test.ts`
Expected: FAIL — `ClaudeAdapter` doesn't accept `workspaceService`/`projectService` yet and returns synchronously.

- [ ] **Step 3: Update `ClaudeAdapter`**

Replace `src/main/infrastructure/adapters/claude-adapter.ts` in full:

```ts
import { join } from 'node:path';
import type { Adapter, AdapterDestination } from '../../application/ports/adapter.js';
import type { Entity, Instruction } from '../../../shared/entity.js';
import type { WorkspaceService } from '../../application/services/workspace-service.js';
import type { ProjectService } from '../../application/services/project-service.js';
import { resolveScopePath } from '../../application/resolve-scope-path.js';
import { DomainError } from '../../domain/errors.js';

export interface ClaudeAdapterDeps {
  homedir: string;
  workspaceService: Pick<WorkspaceService, 'get'>;
  projectService: Pick<ProjectService, 'get'>;
}

export class ClaudeAdapter implements Adapter {
  readonly adapterId = 'claude';
  private readonly homedir: string;
  private readonly scopeDeps: Pick<ClaudeAdapterDeps, 'workspaceService' | 'projectService'>;

  constructor(deps: ClaudeAdapterDeps) {
    if (deps.homedir === undefined || deps.homedir === null || deps.homedir === '') {
      throw new DomainError(
        'internal',
        'ClaudeAdapter requires a non-empty homedir',
        { reason: 'missing-homedir' },
      );
    }
    this.homedir = deps.homedir;
    this.scopeDeps = { workspaceService: deps.workspaceService, projectService: deps.projectService };
  }

  async resolveEntityDestinations(args: { entity: Entity }): Promise<AdapterDestination[]> {
    const { kind, name, scopes } = args.entity;

    if (kind === 'instruction') {
      const instruction = args.entity as Instruction;
      if (instruction.scopes[0] === 'personal') {
        return [
          { scope: 'personal', destination: join(this.homedir, '.claude/CLAUDE.md'), strategy: 'symlink' },
          { scope: 'personal', destination: join(this.homedir, 'AGENTS.md'), strategy: 'symlink' },
        ];
      }
      const scope = instruction.scopes[0];
      const repoPath = await resolveScopePath(instruction, this.scopeDeps);
      return [
        { scope, destination: join(repoPath, '.claude/CLAUDE.md'), strategy: 'symlink' },
        { scope, destination: join(repoPath, 'AGENTS.md'), strategy: 'symlink' },
      ];
    }

    if (kind !== 'skill' && kind !== 'agent') {
      return [];
    }

    // TODO(follow-up): skill/agent scope 'project'/'workspace' is temporarily
    // blocked at the schema level (skillAgentScopes still pins ['personal']).
    // When we introduce a per-entity repoPath/scopeId for skill/agent, re-add
    // project/workspace destinations here.
    const subfolder = kind === 'skill' ? '.claude/skills' : '.claude/agents';
    const fileName = kind === 'skill' ? name : `${name}.md`;
    const out: AdapterDestination[] = [];

    if (scopes.includes('personal')) {
      out.push({ scope: 'personal', destination: join(this.homedir, subfolder, fileName), strategy: 'symlink' });
    }
    return out;
  }
}
```

- [ ] **Step 4: Run the Claude adapter test to verify it passes**

Run: `npx vitest run tests/main/infrastructure/adapters/__tests__/claude-adapter.entity-destinations.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Write the failing Cursor adapter test**

Replace `tests/main/infrastructure/adapters/__tests__/cursor-adapter.entity-destinations.test.ts`'s project-instruction test(s) — read the file first to find its exact current project-instruction case(s) (it mirrors the Claude one you just replaced, but the write-strategy `AGENTS.md`-via-`renderAgentsFile` destination instead of a symlink pair) — and add the same `scopeDeps`/async pattern used above. The shape to land on:

```ts
  it('routes a project instruction to <resolved project path>/AGENTS.md (write, marker-owned)', async () => {
    const ins: Instruction = {
      urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
      description: '', scopes: ['project'], scopeId: 'proj-1', metadata: meta,
      source: WORKSPACE_SOURCE, content: 'body',
    };
    const result = await adapter.resolveEntityDestinations({ entity: ins });
    expect(result).toEqual([
      {
        scope: 'project',
        destination: '/repos/acme/AGENTS.md',
        strategy: 'write',
        content: expect.stringContaining('body'),
      },
    ]);
  });
```

using the same `scopeDeps` constant and `adapter`/import shape as the Claude test file (adjust the import path's `CursorAdapter` and the personal-instruction plugin-manifest assertions, which are untouched by this task, to stay exactly as they are today — only the project-instruction case(s) change).

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/main/infrastructure/adapters/__tests__/cursor-adapter.entity-destinations.test.ts`
Expected: FAIL

- [ ] **Step 7: Update `CursorAdapter` and `cursor-plugin-manifest.ts`**

In `src/main/application/entity/cursor-plugin-manifest.ts`, change the import and signature:

```ts
import type { Instruction } from '../../../shared/entity.js';
```

```ts
export function renderCursorPersonalRule(instruction: Instruction): string {
```

(body of the function is unchanged — it only ever reads fields common to every `Instruction`.)

Replace `src/main/infrastructure/adapters/cursor-adapter.ts` in full:

```ts
import { join } from 'node:path';
import type { Adapter, AdapterDestination } from '../../application/ports/adapter.js';
import type { Entity, Instruction } from '../../../shared/entity.js';
import type { WorkspaceService } from '../../application/services/workspace-service.js';
import type { ProjectService } from '../../application/services/project-service.js';
import { resolveScopePath } from '../../application/resolve-scope-path.js';
import { DomainError } from '../../domain/errors.js';
import { renderAgentsFile } from '../../application/entity/agents-file.js';
import {
  CURSOR_PLUGIN_ID,
  CURSOR_PLUGIN_JSON_MARKER,
  CURSOR_PLUGIN_MANIFEST_SUBPATH,
  CURSOR_PLUGIN_PERSONAL_RULE_FILE,
  CURSOR_PLUGIN_RULES_SUBPATH,
  CURSOR_RULE_MDC_MARKER,
  renderCursorPersonalRule,
  renderCursorPluginManifest,
} from '../../application/entity/cursor-plugin-manifest.js';

export interface CursorAdapterDeps {
  homedir: string;
  workspaceService: Pick<WorkspaceService, 'get'>;
  projectService: Pick<ProjectService, 'get'>;
}

/**
 * Publishes workspace entities into Cursor's native file surface.
 *
 * - Skills / agents (scope `personal`) → `~/.cursor/{skills,agents}/…` (symlink).
 * - Personal Instruction → materialized as a Cursor local plugin under
 *   `~/.cursor/plugins/ai-companion/` (the "hack": Cursor loads plugin rules at
 *   startup and applies rules with `alwaysApply: true` to every conversation,
 *   which is the closest analogue to Claude's home-level CLAUDE.md today —
 *   native `~/.cursor/rules/*.mdc` support is not stable as of this writing).
 * - Project/workspace Instruction → `<resolved scope path>/AGENTS.md` (write, marker-owned).
 */
export class CursorAdapter implements Adapter {
  readonly adapterId = 'cursor';
  private readonly homedir: string;
  private readonly scopeDeps: Pick<CursorAdapterDeps, 'workspaceService' | 'projectService'>;

  constructor(deps: CursorAdapterDeps) {
    if (deps.homedir === undefined || deps.homedir === null || deps.homedir === '') {
      throw new DomainError('internal', 'CursorAdapter requires a non-empty homedir', {
        reason: 'missing-homedir',
      });
    }
    this.homedir = deps.homedir;
    this.scopeDeps = { workspaceService: deps.workspaceService, projectService: deps.projectService };
  }

  async resolveEntityDestinations(args: { entity: Entity }): Promise<AdapterDestination[]> {
    const { kind, name, scopes } = args.entity;

    if (kind === 'instruction') {
      const instruction = args.entity as Instruction;
      if (instruction.scopes[0] === 'personal') {
        return this.personalInstructionDestinations(instruction);
      }
      const scope = instruction.scopes[0];
      const repoPath = await resolveScopePath(instruction, this.scopeDeps);
      return [
        {
          scope,
          destination: join(repoPath, 'AGENTS.md'),
          strategy: 'write' as const,
          content: renderAgentsFile(instruction),
        },
      ];
    }

    if (kind !== 'skill' && kind !== 'agent') {
      return [];
    }

    // TODO(follow-up): skill/agent scope 'project'/'workspace' is temporarily
    // blocked at the schema level while linkedRepos is removed.
    const subfolder = kind === 'skill' ? '.cursor/skills' : '.cursor/agents';
    const fileName = kind === 'skill' ? name : `${name}.md`;
    const out: AdapterDestination[] = [];

    if (scopes.includes('personal')) {
      out.push({ scope: 'personal', destination: join(this.homedir, subfolder, fileName), strategy: 'symlink' });
    }
    return out;
  }

  private personalInstructionDestinations(instruction: Instruction): AdapterDestination[] {
    const pluginRoot = join(this.homedir, '.cursor', 'plugins', CURSOR_PLUGIN_ID);
    return [
      {
        scope: 'personal',
        destination: join(pluginRoot, CURSOR_PLUGIN_MANIFEST_SUBPATH),
        strategy: 'write',
        content: renderCursorPluginManifest(),
        ownershipMarker: CURSOR_PLUGIN_JSON_MARKER,
        ownershipCheck: 'includes',
      },
      {
        scope: 'personal',
        destination: join(pluginRoot, CURSOR_PLUGIN_RULES_SUBPATH, CURSOR_PLUGIN_PERSONAL_RULE_FILE),
        strategy: 'write',
        content: renderCursorPersonalRule(instruction),
        ownershipMarker: CURSOR_RULE_MDC_MARKER,
        ownershipCheck: 'includes',
      },
    ];
  }
}
```

- [ ] **Step 8: Run the Cursor adapter test to verify it passes**

Run: `npx vitest run tests/main/infrastructure/adapters/__tests__/cursor-adapter.entity-destinations.test.ts`
Expected: PASS

- [ ] **Step 9: Widen `AdapterDestination.scope`**

In `src/main/application/ports/adapter.ts`, change both occurrences of `scope: 'personal' | 'project';` to `scope: 'personal' | 'project' | 'workspace';`. Update the doc comment above `resolveEntityDestinations` (currently "project-scoped instructions carry their own `repoPath`...") to:

```ts
  /**
   * Resolve the concrete on-disk destinations for an entity. Personal-scoped
   * entities go to the adapter's home surface; project/workspace-scoped
   * instructions resolve their target path via `resolveScopePath` and fan out
   * to that single path.
   */
```

- [ ] **Step 10: Move Claude/Cursor adapter construction into `buildWorkspaceScopedServices`**

In `src/main/application/workspace-scoped-services.ts` (plan 1's file):

Change `WorkspaceScopedSharedDeps` — remove the pre-built `claudeAdapter: Adapter;` / `cursorAdapter: Adapter;` fields, add:

```ts
  homedir: string;
  workspaceService: import('./services/workspace-service.js').WorkspaceService;
```

(Use a top-level `import type { WorkspaceService } from './services/workspace-service.js';` instead of the inline `import(...)` form shown above — the inline form is only to make the diff unambiguous here; write it as a normal top-of-file import.)

Add imports for `ClaudeAdapter`/`CursorAdapter` and their `Deps` types:

```ts
import { ClaudeAdapter } from '../infrastructure/adapters/claude-adapter.js';
import { CursorAdapter } from '../infrastructure/adapters/cursor-adapter.js';
```

Inside `buildWorkspaceScopedServices`, **before** the `adapterManager` construction (which needs the adapters), construct `projectService` first (it already exists slightly later in the function per Task 7 of plan 1 — move that one line up), then build the adapters:

```ts
  const projectService = new ProjectService(new FsProjectRegistry(join(dataDir, 'projects.json')), clock);

  const claudeAdapter = new ClaudeAdapter({ homedir: shared.homedir, workspaceService: shared.workspaceService, projectService });
  const cursorAdapter = new CursorAdapter({ homedir: shared.homedir, workspaceService: shared.workspaceService, projectService });

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
```

Remove the now-duplicate later `const projectService = ...` line that plan 1 placed after `sessionService` — there is now only one.

In `src/main/index.ts`, remove the top-level `const claudeAdapter = new ClaudeAdapter({ homedir: home });` / `const cursorAdapter = new CursorAdapter({ homedir: home });` lines (they moved inside `buildWorkspaceScopedServices`), and change `sharedDeps` to drop `claudeAdapter`/`cursorAdapter` and add `homedir: home, workspaceService,`:

```ts
  const sharedDeps = {
    clock,
    nodeFsAdapter,
    settingsService,
    homedir: home,
    workspaceService,
    pluginProvenance,
    pluginService,
    claudeRuntimeReader,
    claudeSettingsFile,
    claudeCli: new NodeClaudeCliAdapter(),
    claudeSessionPort: new NodePtySessionAdapter(),
  };
```

- [ ] **Step 11: Update plan 1's `workspace-scoped-services.test.ts` fixture to the new shared-deps shape**

`tests/main/application/workspace-scoped-services.test.ts` (written in plan 1) has its own `buildShared()` helper that constructs `claudeAdapter`/`cursorAdapter` directly and includes them in the object it returns. Since `WorkspaceScopedSharedDeps` no longer has those two fields, update `buildShared()`:

- Delete the `const claudeAdapter = new ClaudeAdapter({ homedir });` / `const cursorAdapter = new CursorAdapter({ homedir });` lines and their now-unused imports (`ClaudeAdapter`, `CursorAdapter`).
- Add a minimal stub `WorkspaceService`-shaped object (the test never exercises workspace/project-scoped instruction routing, only skill/project-service independence, so a stub that throws if actually called is correct and matches this plan's other adapter tests' pattern):

```ts
  const workspaceService = { get: async () => { throw new Error('not stubbed in this test'); } };
```

- In the returned object, replace `claudeAdapter, cursorAdapter,` with `homedir, workspaceService,`.

Run: `npx vitest run tests/main/application/workspace-scoped-services.test.ts` — passes with the updated fixture (it doesn't assert on adapter identity, only on `skillService`/`projectService` behavior, which is unaffected by where the adapters are constructed).

- [ ] **Step 12: Verify**

Run: `npm run typecheck` — the adapters and `workspace-scoped-services.ts`/`index.ts` should now be internally consistent; remaining errors elsewhere are addressed by Task 12.

- [ ] **Step 13: Commit**

```bash
git add src/main/infrastructure/adapters/claude-adapter.ts src/main/infrastructure/adapters/cursor-adapter.ts \
  src/main/application/entity/cursor-plugin-manifest.ts src/main/application/ports/adapter.ts \
  src/main/application/workspace-scoped-services.ts src/main/index.ts \
  tests/main/infrastructure/adapters/__tests__/claude-adapter.entity-destinations.test.ts \
  tests/main/infrastructure/adapters/__tests__/cursor-adapter.entity-destinations.test.ts \
  tests/main/application/workspace-scoped-services.test.ts
git commit -m "feat: adapters resolve project/workspace instruction paths via resolveScopePath"
```

---

## Task 8: `SessionService.resolveCwd` via `resolveScopePath`

**Files:**
- Modify: `src/main/application/services/session-service.ts`
- Test: `tests/main/application/services/session-service.test.ts`

**Interfaces:**
- Consumes: `resolveScopePath` (Task 5).
- Produces: `SessionService`'s constructor gains a 4th param `scopeDeps: { workspaceService: Pick<WorkspaceService, 'get'>; projectService: Pick<ProjectService, 'get'> }`; `resolveCwd` becomes `private async`.

- [ ] **Step 1: Write the failing test**

In `tests/main/application/services/session-service.test.ts`, replace the `projectInstruction` fixture and `setup()`:

```ts
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
    workspaceService: { get: async () => { throw new Error('not stubbed'); } },
    projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
  };
  const service = new SessionService(base, claudeSession, WORKSPACE, scopeDeps);
  return { service, base, claudeSession };
};
```

(Change the import line's `type ProjectInstruction` to `type Instruction`, and add `type Instruction` where `ProjectInstruction` was.) Change the one test using `projectInstruction`:

```ts
  it('spawn resolves cwd via resolveScopePath for a project instruction', async () => {
    const { service, base } = setup();
    await base.save({ entity: projectInstruction('acme', 'proj-1'), isCreate: true });
    const session = await service.spawn(entityUrn('instruction', 'acme'));
    expect(session.cwd).toBe('/repos/acme');
  });
```

Every other test in the file (spawn/write/resize/kill/killAll/onOutput/onExit/dedup) is unchanged — they only use `skill()`, which never touches `resolveCwd`'s project/workspace branch.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/services/session-service.test.ts`
Expected: FAIL — `SessionService` constructor doesn't accept a 4th argument yet.

- [ ] **Step 3: Update `SessionService`**

In `src/main/application/services/session-service.ts`, change the imports:

```ts
import type { Entity, Instruction } from '../../../shared/entity.js';
import type { SessionSnapshot, SessionStatus } from '../../../shared/session.js';
import type { EntityService } from './entity-service.js';
import type { ClaudeSessionPort } from '../ports/claude-session-port.js';
import type { WorkspaceService } from './workspace-service.js';
import type { ProjectService } from './project-service.js';
import { resolveScopePath } from '../resolve-scope-path.js';
import { ioError } from '../../domain/errors.js';
```

(Drop `isProjectInstruction` — no longer used.) Add a constructor param and change `resolveCwd`:

```ts
  constructor(
    private readonly entityService: EntityService,
    private readonly claudeSession: ClaudeSessionPort,
    private readonly workspacePath: string,
    private readonly scopeDeps: {
      workspaceService: Pick<WorkspaceService, 'get'>;
      projectService: Pick<ProjectService, 'get'>;
    },
  ) {
```

(the rest of the constructor body — the `onData`/`onExit` wiring — is unchanged.) In `spawn`'s inner async function, change `const cwd = this.resolveCwd(entity);` to `const cwd = await this.resolveCwd(entity);`. Replace `resolveCwd`:

```ts
  private async resolveCwd(entity: Entity): Promise<string> {
    if (entity.kind === 'instruction') {
      const instruction = entity as Instruction;
      if (instruction.scopes[0] !== 'personal') {
        return resolveScopePath(instruction, this.scopeDeps);
      }
    }
    return this.workspacePath;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/services/session-service.test.ts`
Expected: PASS

- [ ] **Step 4b: Fix the other direct `SessionService` construction site**

`tests/main/ipc/session-handlers.test.ts` also constructs `SessionService` directly (`new SessionService(base, claudeSession, '/workspace')`) and will fail to compile without the new 4th argument. It never exercises a project/workspace-scoped instruction, so a throwaway stub is correct — add to its `setup()`:

```ts
  const scopeDeps = {
    workspaceService: { get: async () => { throw new Error('not stubbed'); } },
    projectService: { get: async () => { throw new Error('not stubbed'); } },
  };
  const service = new SessionService(base, claudeSession, '/workspace', scopeDeps);
```

Run: `npx vitest run tests/main/ipc/session-handlers.test.ts` — still passes unchanged otherwise.

- [ ] **Step 5: Wire the new constructor arg in `buildWorkspaceScopedServices`**

In `src/main/application/workspace-scoped-services.ts`, update the `sessionService` construction:

```ts
  const sessionService = new SessionService(entityService, claudeSessionPort, dataDir, {
    workspaceService: shared.workspaceService,
    projectService,
  });
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run tests/main/application/workspace-scoped-services.test.ts` — still passes.

```bash
git add src/main/application/services/session-service.ts tests/main/application/services/session-service.test.ts \
  tests/main/ipc/session-handlers.test.ts src/main/application/workspace-scoped-services.ts
git commit -m "feat: SessionService resolves project/workspace cwd via resolveScopePath"
```

---

## Task 9: `InstructionService` lazy migration

**Files:**
- Modify: `src/main/application/services/instruction-service.ts`
- Test: `tests/main/application/services/instruction-service.test.ts`

**Interfaces:**
- Consumes: `ProjectService.findOrCreateByPath` (plan 1).
- Produces: `InstructionService`'s constructor gains a 3rd param `projectService: Pick<ProjectService, 'findOrCreateByPath'>`. `get`/`list` detect `legacyRepoPath` on any returned instruction, call `findOrCreateByPath`, persist the backfilled `scopeId` via `this.base.save`, and return the migrated shape (never `legacyRepoPath` again for that entity).

- [ ] **Step 1: Write the failing tests**

In `tests/main/application/services/instruction-service.test.ts`, change the `project` fixture and `setup()`:

```ts
const project = (name = 'acme', scopeId = 'proj-1'): Instruction => ({
  urn: `urn:instruction:${name}`, kind: 'instruction', name, description: `${name} rules`,
  scopes: ['project'], scopeId, metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: `# ${name}\n`,
});

const legacyProject = (name = 'legacy-acme', repoPath = '/repos/legacy-acme'): Instruction => ({
  urn: `urn:instruction:${name}`, kind: 'instruction', name, description: `${name} rules`,
  scopes: ['project'], legacyRepoPath: repoPath, metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: `# ${name}\n`,
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeCli = new FakeClaudeCliPort();
  const projects = new Map<string, { id: string; name: string; path: string; createdAt: string }>();
  const projectService = {
    findOrCreateByPath: vi.fn(async (path: string) => {
      const existing = [...projects.values()].find((p) => p.path === path);
      if (existing) return existing;
      const created = { id: `proj-${projects.size + 1}`, name: path.split('/').pop() ?? path, path, createdAt: '' };
      projects.set(created.id, created);
      return created;
    }),
  };
  return { service: new InstructionService(base, claudeCli, projectService), repo, adapterManager, claudeCli, projectService };
};
```

(Replace `PersonalInstruction`/`ProjectInstruction` in the import line with `Instruction`; drop the now-unused `repoPath` param from the old `project()` fixture signature.) Update every existing test in the file that called `project('acme', '/repos/acme')` to call `project('acme', 'proj-1')` instead (same positional shape, just a `scopeId` value instead of a path — the assertions on `got.repoPath` become `got.scopeId`). Add two new tests:

```ts
  it('get migrates a legacy repoPath-only project instruction to a real scopeId on read', async () => {
    const { service, projectService } = setup();
    await service.save({ instruction: legacyProject('legacy-acme', '/repos/legacy-acme'), isCreate: true });
    const got = await service.get('legacy-acme');
    expect(got.scopeId).toBe('proj-1');
    expect(got.legacyRepoPath).toBeUndefined();
    expect(projectService.findOrCreateByPath).toHaveBeenCalledWith('/repos/legacy-acme');

    // Persisted, not just returned in-memory — a second read must not re-migrate.
    const reread = await service.get('legacy-acme');
    expect(reread.scopeId).toBe('proj-1');
    expect(projectService.findOrCreateByPath).toHaveBeenCalledTimes(1);
  });

  it('list migrates every legacy instruction it encounters', async () => {
    const { service } = setup();
    await service.save({ instruction: personal(), isCreate: true });
    await service.save({ instruction: legacyProject('legacy-acme', '/repos/legacy-acme'), isCreate: true });
    const list = await service.list();
    const migrated = list.find((i) => i.name === 'legacy-acme');
    expect(migrated?.scopeId).toBe('proj-1');
    expect(migrated?.legacyRepoPath).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/application/services/instruction-service.test.ts`
Expected: FAIL — `InstructionService` doesn't accept a 3rd constructor argument yet, and doesn't migrate.

- [ ] **Step 3: Implement the migration**

Read the current `src/main/application/services/instruction-service.ts` in full before editing (its exact shape may have drifted since research — this plan's earlier direct read showed a 99-line facade with `list`, `get`, `save`, `delete`, `generatePersonalDraft`). Add the constructor param:

```ts
export class InstructionService {
  constructor(
    private readonly base: EntityService,
    private readonly claudeCli: ClaudeCliPort,
    private readonly projectService: Pick<ProjectService, 'findOrCreateByPath'>,
  ) {}
```

Add a private migration helper and route `list`/`get` through it:

```ts
  private async migrateIfLegacy(instruction: Instruction): Promise<Instruction> {
    if (instruction.legacyRepoPath === undefined) return instruction;
    const project = await this.projectService.findOrCreateByPath(instruction.legacyRepoPath);
    const migrated: Instruction = { ...instruction, scopeId: project.id };
    delete migrated.legacyRepoPath;
    await this.base.save({ entity: migrated });
    return migrated;
  }

  async list(): Promise<Instruction[]> {
    const all = (await this.base.list('instruction')) as Instruction[];
    return Promise.all(all.map((i) => this.migrateIfLegacy(i)));
  }

  async get(name = 'default'): Promise<Instruction> {
    const id = name === 'default' ? personalInstructionId(name) : projectInstructionSlug(name);
    const entity = (await this.base.get(entityUrn('instruction', id))) as Instruction;
    return this.migrateIfLegacy(entity);
  }
```

(Match the exact `get`/`list` bodies to whatever Step 3's fresh read showed if they differ from this plan's earlier snapshot — the migration wrapper (`migrateIfLegacy`) is the substantive addition; `save`/`delete`/`generatePersonalDraft` are untouched.) Add the `ProjectService` type-only import and `Instruction` (drop `PersonalInstruction`/`ProjectInstruction` if the file imports them by name).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/application/services/instruction-service.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the new constructor arg**

In `src/main/application/workspace-scoped-services.ts`, update the `instructionService` construction:

```ts
  const instructionService = new InstructionService(entityService, claudeCli, projectService);
```

- [ ] **Step 6: Update the IPC test fixture**

In `tests/main/ipc/typed-handlers.test.ts`, `setupInstructionService` needs a 3rd arg too — pass a minimal stub: `{ findOrCreateByPath: vi.fn() }`.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run tests/main/ipc/typed-handlers.test.ts tests/main/application/workspace-scoped-services.test.ts` — both pass.

```bash
git add src/main/application/services/instruction-service.ts tests/main/application/services/instruction-service.test.ts \
  src/main/application/workspace-scoped-services.ts tests/main/ipc/typed-handlers.test.ts
git commit -m "feat: InstructionService lazily migrates legacy repoPath instructions to scopeId"
```

---

## Task 10: Renderer — `use-projects` hooks

**Files:**
- Create: `src/renderer/hooks/use-projects.ts`
- Test: `tests/renderer/hooks/use-projects.test.tsx`

**Interfaces:**
- Consumes: `callIpc` (existing).
- Produces: `useProjects()` (query `['project', 'list']`), `useFindOrCreateProjectByPath()` (mutation calling `project.findOrCreateByPath`, invalidates `['project', 'list']`). Consumed by Task 11.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/hooks/use-projects.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../src/renderer/lib/ipc.js';
import { useProjects, useFindOrCreateProjectByPath } from '../../../src/renderer/hooks/use-projects.js';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const project = (id = 'p1') => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' });

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('use-projects', () => {
  it('useProjects fetches via project.list', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([project()]);
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([project()]));
    expect(ipc.callIpc).toHaveBeenCalledWith('project.list', {});
  });

  it('useFindOrCreateProjectByPath calls project.findOrCreateByPath and invalidates the list', async () => {
    const spy = vi.spyOn(ipc, 'callIpc').mockResolvedValue(project());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useFindOrCreateProjectByPath(), { wrapper });
    await result.current.mutateAsync('/repos/acme');
    expect(spy).toHaveBeenCalledWith('project.findOrCreateByPath', { path: '/repos/acme' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['project', 'list'] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/hooks/use-projects.test.tsx`
Expected: FAIL — `Cannot find module '.../use-projects.js'`

- [ ] **Step 3: Implement the hooks**

Create `src/renderer/hooks/use-projects.ts`:

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { queryClient } from '../lib/query-client.js';
import type { Project } from '../../shared/project.js';

const listKey = ['project', 'list'] as const;

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: listKey,
    queryFn: () => callIpc<Project[]>('project.list', {}),
  });
}

export function useFindOrCreateProjectByPath() {
  return useMutation({
    mutationFn: (path: string) => callIpc<Project>('project.findOrCreateByPath', { path }),
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
git commit -m "feat: add react-query hooks for the Project registry"
```

---

## Task 11: Renderer — Instructions screen uses the `Project` registry

**Files:**
- Modify: `src/renderer/screens/instructions/InstructionsScreen.tsx`
- Modify: `src/renderer/lib/blank-customization.ts`
- Test: `tests/renderer/screens/instructions/instructions-screen.test.tsx`

**Interfaces:**
- Consumes: `useProjects`, `useFindOrCreateProjectByPath` (Task 10).
- Produces: `openProjectCreate` now calls `dialog.selectFolder` → `findOrCreateProjectByPath.mutateAsync(path)` → seeds an `Instruction` with `scopes: ['project'], scopeId: project.id` (no `repoPath`). `ProjectInstructionRow` resolves and displays the associated `Project`'s name/path via `scopeId`, falling back to a "projeto não encontrado" placeholder if the reference doesn't resolve (stale `scopeId` — matches the spec's "surfaced as a failure rather than silently syncing" philosophy at the service layer; the UI degrades gracefully instead of crashing).

- [ ] **Step 1: Update `blank-customization.ts`**

In `src/renderer/lib/blank-customization.ts`, change the import and return type:

```ts
import type { Agent, Instruction, Skill } from '../../shared/entity.js';
import { WORKSPACE_SOURCE } from '../../shared/entity.js';

/**
 * Build an empty entity pre-filled with sensible defaults for a "New" create
 * flow. `instruction` here means the personal singleton (name === 'default',
 * scopes === ['personal']). Project instructions are seeded via a separate
 * helper because they require a Project picked from the registry.
 */
export function blankCustomization(kind: 'skill' | 'agent' | 'instruction'): Skill | Agent | Instruction {
  const metadata = { version: '0.1.0', createdAt: '', updatedAt: '' };
  if (kind === 'agent') {
    return { urn: '', kind: 'agent', name: '', description: '', scopes: ['personal'], metadata, source: WORKSPACE_SOURCE, systemPrompt: '' };
  }
  if (kind === 'instruction') {
    return { urn: '', kind: 'instruction', name: 'default', description: '', scopes: ['personal'], metadata, source: WORKSPACE_SOURCE, content: '' };
  }
  return { urn: '', kind: 'skill', name: '', description: '', scopes: ['personal'], metadata, source: WORKSPACE_SOURCE, content: '' };
}
```

- [ ] **Step 2: Write the failing test additions**

Read `tests/renderer/screens/instructions/instructions-screen.test.tsx` first to match its existing mocking conventions (how it mocks `callIpc`/`useInstructionsList`). Add/adjust cases so that:
- The "create project instruction" flow's mock sequence is `dialog.selectFolder` → `{canceled: false, path: '/repos/acme'}` → `project.findOrCreateByPath` → `{id: 'proj-1', name: 'acme', path: '/repos/acme', createdAt: ''}` → the editor opens with an entity whose `scopeId === 'proj-1'` and no `repoPath` field.
- The project row display test asserts on the resolved `Project.path` (via a mocked `project.list` returning `[{id: 'proj-1', name: 'acme', path: '/repos/acme', createdAt: ''}]`), not `entity.repoPath`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/screens/instructions/instructions-screen.test.tsx`
Expected: FAIL

- [ ] **Step 4: Update `InstructionsScreen.tsx`**

Change the import line:

```ts
import type { Instruction } from '../../../shared/entity.js';
import { WORKSPACE_SOURCE, isPersonalInstruction, isProjectInstruction } from '../../../shared/entity.js';
import type { Project } from '../../../shared/project.js';
import { useProjects, useFindOrCreateProjectByPath } from '../../hooks/use-projects.js';
```

Replace `seedProjectInstruction`:

```ts
function seedProjectInstruction(project: Project): Instruction {
  return {
    urn: '',
    kind: 'instruction',
    name: basenameFromPath(project.path),
    description: '',
    scopes: ['project'],
    scopeId: project.id,
    metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
    source: WORKSPACE_SOURCE,
    content: `# Project instructions\n\nContext, conventions, and workflows specific to this repo.\n`,
  };
}
```

Change `EditorState`'s `entity: Instruction` (unchanged type name now that the union is flat — no edit needed there). Update the component body: add `const { data: projects = [] } = useProjects();` and `const findOrCreateProject = useFindOrCreateProjectByPath();` near the other hooks. Change `projects` local variable name collision — rename the existing `const projects = (data ?? []).filter(isProjectInstruction);` (the list of project *instructions*) to `const projectInstructions = (data ?? []).filter(isProjectInstruction);` and update its two use sites (`projects.length === 0` / `projects.map(...)` in the JSX) to `projectInstructions`.

Replace `openProjectCreate`:

```ts
  const openProjectCreate = async (): Promise<void> => {
    setPickerError(null);
    try {
      const picked = await callIpc<{ canceled: boolean; path?: string }>('dialog.selectFolder', {});
      if (picked.canceled || !picked.path) return;
      const project = await findOrCreateProject.mutateAsync(picked.path);
      setEditor({ entity: seedProjectInstruction(project), isCreate: true });
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : 'Erro ao abrir o seletor');
    }
  };
```

Update `handleDelete`'s confirm message (it read `p.repoPath` directly):

```ts
  const handleDelete = async (p: Instruction): Promise<void> => {
    const resolvedPath = projects.find((proj) => proj.id === p.scopeId)?.path ?? p.scopeId ?? '?';
    const confirmed = window.confirm(`Remover a project instruction "${p.name}" (${resolvedPath})?`);
    ...
```

(`ProjectInstruction`-typed params throughout the file become `Instruction` — `openProjectEdit(p: Instruction)`, `ProjectRowProps.project: Instruction`, etc.) Update `ProjectInstructionRow` to resolve the project by `scopeId` instead of reading `.repoPath`:

```tsx
interface ProjectRowProps {
  project: Instruction;
  resolvedPath: string | undefined;
  cursorEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function ProjectInstructionRow({ project, resolvedPath, cursorEnabled, onEdit, onDelete }: ProjectRowProps): React.ReactElement {
  const destCount = 2 + (cursorEnabled ? 1 : 0);
  return (
    <ListItem
      data-testid="project-instruction-row"
      divider
      secondaryAction={
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Editar">
            <IconButton edge="end" onClick={onEdit} aria-label="Editar" data-testid="project-instruction-edit">
              <Icon glyph={Pencil} size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remover">
            <IconButton edge="end" onClick={onDelete} aria-label="Remover" data-testid="project-instruction-delete">
              <Icon glyph={Trash2} size={16} />
            </IconButton>
          </Tooltip>
        </Stack>
      }
    >
      <ListItemText
        primary={<Box component="strong">{project.name}</Box>}
        secondary={
          <>
            <Box component="code" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
              {resolvedPath ?? 'Projeto não encontrado'}
            </Box>
            {' — '}
            {destCount} destino{destCount === 1 ? '' : 's'}
          </>
        }
      />
    </ListItem>
  );
}
```

Update the call site (in the main render, where `ProjectInstructionRow` is mapped over `projectInstructions`):

```tsx
                {projectInstructions.map((p) => (
                  <ProjectInstructionRow
                    key={p.urn}
                    project={p}
                    resolvedPath={projects.find((proj) => proj.id === p.scopeId)?.path}
                    cursorEnabled={cursorEnabled}
                    onEdit={() => openProjectEdit(p)}
                    onDelete={() => void handleDelete(p)}
                  />
                ))}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/screens/instructions/instructions-screen.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/instructions/InstructionsScreen.tsx src/renderer/lib/blank-customization.ts \
  tests/renderer/screens/instructions/instructions-screen.test.tsx
git commit -m "feat: Instructions screen creates/displays project instructions via the Project registry"
```

---

## Task 12: Compiler-driven sweep of every remaining `PersonalInstruction`/`ProjectInstruction`/`.repoPath` reference

**Files:** whatever `npm run typecheck` and `npm test` point at — do not pre-guess; the commands below are the source of truth at execution time.

**Interfaces:** none new — this task only removes stale references to types/fields Tasks 1–11 already replaced.

This is a verification gate, not new design: every fix in this task follows a pattern already fully specified in an earlier task. Do not invent new behavior here — if a fix doesn't obviously match one of the four patterns below, stop and reconcile with the relevant earlier task instead of guessing.

- [ ] **Step 1: Enumerate remaining references**

Run:

```bash
grep -rln "PersonalInstruction\|ProjectInstruction" src tests
```

For each file NOT already handled by Tasks 1–11 (cross-check against this plan's "File structure" section), open it and apply one of:

1. **Type import/usage**: `import type { ..., PersonalInstruction, ProjectInstruction, ... }` → replace both names with `Instruction` (dedupe if `Instruction` is already imported). Any `: PersonalInstruction` / `: ProjectInstruction` annotation → `: Instruction`. Any `as PersonalInstruction` / `as ProjectInstruction` cast → `as Instruction`, or drop the cast entirely if the value is already statically an `Instruction`.
2. **`.repoPath` field access on an `Instruction`-typed value in a fixture/test**: replace with `.scopeId` (test fixtures should now construct `{ scopes: ['project'], scopeId: 'proj-1', ... }` instead of `{ scopes: ['project'], repoPath: '/some/path', ... }` — see Task 4's/Task 7's fixture rewrites for the exact shape).
3. **`fake-adapter.ts` specifically** (`src/main/application/services/__fixtures__/fake-adapter.ts`): change `import type { Entity, ProjectInstruction }` to `import type { Entity, Instruction }`, and change `const project = args.entity as ProjectInstruction; ... project.repoPath` to `const project = args.entity as Instruction; ... project.scopeId ?? ''`. Any test constructing a `ProjectInstruction` fixture to exercise `FakeAdapter` now constructs `{ scopes: ['project'], scopeId: '<any-string>', ... }` — the fake doesn't resolve the id to a real path, it just threads the raw value through `projectDestinationTemplate`, so any string works.
4. **A real (non-test) call site not covered by patterns 1-3** (should not exist after Tasks 1–11, but verify): stop and check whether it's a genuine gap in an earlier task rather than applying an ad-hoc fix — e.g. if a real adapter or service somewhere still reads `.repoPath`, that means Task 7 or 8 missed a call site and should be revisited, not patched here with a one-off shim.

- [ ] **Step 2: Re-run the enumeration until empty**

Run: `grep -rln "PersonalInstruction\|ProjectInstruction" src tests`
Expected: no output (empty).

- [ ] **Step 3: Full verification**

Run, in order, stopping to fix at the first failure:

```bash
npm run typecheck
npm run lint
npm test
```

All three must exit 0. If `npm test` coverage thresholds fail because of the new `resolve-scope-path.ts`/`use-projects.ts`/etc. files, check whether they're adequately covered by this plan's own tests before assuming a threshold config change is needed — every new file in this plan ships with tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: sweep remaining PersonalInstruction/ProjectInstruction references after the scopeId migration"
```

---

## Task 13: Update reference docs

**Files:**
- Modify: `docs/reference/customization-schema.md`
- Modify: `docs/reference/architecture.md`
- Modify: `docs/reference/ipc-contract.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the Instruction schema section**

In `docs/reference/customization-schema.md`:

Change the `scopes` row (around line 74):

```markdown
| `scopes` | array | yes | At least 1 entry, no duplicates, each `personal`, `project`, or `workspace`. Per-kind: `instruction` is a discriminated union (exactly `['personal']`, `['project']`, or `['workspace']`); `skill`/`agent` are temporarily restricted to `['personal']` — see the TODO block in `entity-schema.ts`. |
```

Replace the `### instruction` section (currently lines 99-110):

```markdown
### `instruction`

Discriminated by `scopes[0]`: **Personal** is the machine-wide singleton, **Project**/**Workspace** each
carry a `scopeId` resolved against a `Project`/`Workspace` (see [Architecture](architecture.md#workspace--project)).
All variants are stored frontmatter-free.

| Variant | `name` | `scopes` | `scopeId` |
|---|---|---|---|
| Personal (singleton) | must be the literal `default` | exactly `["personal"]` | must be absent |
| Project (per `Project`) | any slug except `default` | exactly `["project"]` | required, references a `Project.id` |
| Workspace (per `Workspace`) | any slug except `default` | exactly `["workspace"]` | required, references a `Workspace.id` |

Enforced by `instructionEntitySchema` in `entity-schema.ts` (branch via `superRefine`) and by the domain
guards `personalInstructionId()` and `projectInstructionSlug()` in `src/main/domain/instruction-id.ts`.
`resolveScopePath(entity, { workspaceService, projectService })` (`src/main/application/resolve-scope-path.ts`)
maps `scopeId` to a concrete absolute path at sync/session-spawn time — the path itself is never persisted
on the entity, only the id.

A pre-existing on-disk `ProjectInstruction` (from before this scoping generalization) carries the old
`repoPath` sidecar field instead of `scopeId`; `InstructionService.get`/`.list` migrate it transparently on
first read — see the storage layout note above and `docs/reference/architecture.md`'s Workspace/Project
section.
```

Update the storage-layout bullet (around line 59) — the `meta.json` field list changes from `repoPath` to `scope`, `scopeId`:

```markdown
- **Project/Workspace** → `instructions/project/<slug>/INSTRUCTION.md` for the body, `instructions/project/<slug>/meta.json` for the sidecar (`description`, `version`, `createdAt`, `updatedAt`, `scope?`, `scopeId?`, `tags?` — plus a legacy, read-only `repoPath?` tolerated on parse for pre-migration data). Both files are written atomically; a slug dir with a body but no `meta.json` is treated as "not found" so partial writes don't poison the list.
```

Update the scope-semantics table (around line 118-121):

```markdown
| Scope | Meaning | Adapter target (typical) |
|---|---|---|
| `personal` | Applies machine-wide for the author. | `~/.claude/` (personal instruction: **both** `~/.claude/CLAUDE.md` and `~/AGENTS.md`; and — when Cursor is enabled — the plugin under `~/.cursor/plugins/ai-companion/`). |
| `project` | Applies to the `Project` the entity's `scopeId` references. | For a project instruction: `<resolved Project.path>/.claude/CLAUDE.md` + `<resolved Project.path>/AGENTS.md`. Skill/agent `project` scope is currently disallowed — a per-entity `scopeId` for skill/agent is a follow-up. |
| `workspace` | Applies to the `Workspace` the entity's `scopeId` references. | For a workspace instruction: `<resolved Workspace.rootPath>/.claude/CLAUDE.md` + `<resolved Workspace.rootPath>/AGENTS.md`. Not yet exposed in any editor UI (schema/service-level only — see the Workspace/Project spec). |
```

- [ ] **Step 2: Cross-link the Workspace/Project section**

In `docs/reference/architecture.md`, in the "Workspace / Project" subsection plan 1 added, add one sentence after the existing paragraph about `resolveScopePath` (if plan 1's doc task didn't already mention it — check first, since plan 1's Task 11 only described the composition-root rebuild, not `resolveScopePath` itself, which didn't exist yet at that point):

```markdown
`resolveScopePath(entity, { workspaceService, projectService })` (`src/main/application/resolve-scope-path.ts`)
maps a `project`/`workspace`-scoped entity's `scopeId` to a concrete absolute path at the point of use — the
Claude/Cursor adapters and `SessionService.resolveCwd` call it instead of reading a persisted path off the
entity, so a `Project`/`Workspace` renamed or repointed after entities reference it never leaves a stale
cached path behind.
```

- [ ] **Step 3: Update the IPC contract**

In `docs/reference/ipc-contract.md`, add one row to the `project.*` section plan 1 added:

```markdown
| `project.findOrCreateByPath` | `{ path: string }` | `Project` | Finds an existing project with this exact path, or creates one (name defaults to the path's basename). |
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/customization-schema.md docs/reference/architecture.md docs/reference/ipc-contract.md
git commit -m "docs: document scopeId-based instruction scoping and resolveScopePath"
```

---

## Final verification

- [ ] Run `npm test` — both `node` and `jsdom` projects pass.
- [ ] Run `npm run lint` — clean.
- [ ] Run `npm run typecheck` — clean.
- [ ] Manual smoke check: `npm run dev`, open Instructions, create a project instruction by picking a folder, confirm it appears with the right path in the list, edit and save it, then pick the **same folder again** for a second "new project instruction" and confirm it reuses the same underlying `Project` (no duplicate registry entry — check `<workspace-root>/.ai-companion/projects.json`).
- [ ] Manual smoke check: hand-edit an existing project instruction's `meta.json` to the pre-migration shape (`repoPath` instead of `scope`/`scopeId`), reload the Instructions screen, confirm it still displays correctly and `meta.json` now has `scope`/`scopeId` instead of `repoPath`.
