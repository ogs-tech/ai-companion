import { describe, it, expect, vi } from 'vitest';
import { InstructionService } from '../../../../src/main/application/services/instruction-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../../src/shared/entity.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const personal = (): Instruction => ({
  urn: 'urn:instruction:default', kind: 'instruction', name: 'default', description: '',
  scopes: ['personal'], metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: '# Instructions\n',
});

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
  return { service: new InstructionService(base, projectService), repo, adapterManager, projectService };
};

describe('InstructionService', () => {
  it('saves and gets the default (personal) instruction', async () => {
    const { service } = setup();
    await service.save({ instruction: personal(), isCreate: true });
    const got = await service.get();
    expect(got.urn).toBe('urn:instruction:default');
    expect(got.content).toContain('# Instructions');
  });

  it('list returns the personal instruction followed by every project instruction', async () => {
    const { service } = setup();
    await service.save({ instruction: personal(), isCreate: true });
    await service.save({ instruction: project('acme', 'proj-1'), isCreate: true });
    await service.save({ instruction: project('bravo', 'proj-2'), isCreate: true });

    const list = await service.list();
    const names = list.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['default', 'acme', 'bravo']));
    expect(list.every((i) => i.kind === 'instruction')).toBe(true);
  });

  it('get(<slug>) validates the slug and returns the project instruction', async () => {
    const { service } = setup();
    await service.save({ instruction: project('acme', 'proj-1'), isCreate: true });
    const got = await service.get('acme');
    expect(got.name).toBe('acme');
    expect(got.scopeId).toBe('proj-1');
  });

  it('get rejects an invalid slug via the domain guard', async () => {
    const { service } = setup();
    await expect(service.get('Bad Name')).rejects.toBeInstanceOf(DomainError);
  });

  it('delete("default") removes the personal singleton and its symlinks', async () => {
    const { service, adapterManager } = setup();
    await service.save({ instruction: personal(), isCreate: true });
    await service.delete({ name: 'default' });
    await expect(service.get('default')).rejects.toBeInstanceOf(DomainError);
    expect((adapterManager as unknown as { removeEntity: ReturnType<typeof vi.fn> }).removeEntity).toHaveBeenCalled();
  });

  it('delete("<slug>") removes a project instruction; removeSymlinks=false skips sync', async () => {
    const { service, adapterManager } = setup();
    const removeEntity = (adapterManager as unknown as { removeEntity: ReturnType<typeof vi.fn> }).removeEntity;
    await service.save({ instruction: project('acme', 'proj-1'), isCreate: true });
    await service.delete({ name: 'acme', removeSymlinks: false });
    expect(removeEntity).not.toHaveBeenCalled();
  });

  it('delete rejects an invalid slug', async () => {
    const { service } = setup();
    await expect(service.delete({ name: 'Bad Name' })).rejects.toBeInstanceOf(DomainError);
  });

  it('save without an explicit isCreate persists the entity anyway', async () => {
    const { service } = setup();
    const saved = await service.save({ instruction: personal() });
    expect((saved.instruction as Instruction).name).toBe('default');
  });

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

  it('list migrates legacy instructions sequentially so concurrent registry writes cannot race and lose a Project (regression for the migration data-race)', async () => {
    const repo = new InMemoryEntityRepository();
    const adapterManager = {
      syncEntity: vi.fn().mockResolvedValue([]),
      removeEntity: vi.fn().mockResolvedValue([]),
    } as unknown as AdapterManager;
    const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);

    // Mirrors the REAL ProjectService.create's non-atomic read-modify-write
    // shape: findOrCreateByPath snapshots the current array, yields a
    // microtask tick (standing in for async registry I/O), then writes back
    // `[...snapshot, created]`. Two calls that both read the same snapshot
    // before either writes will race — the second write clobbers the first's
    // newly-created Project. A Map-backed stub (synchronous, no yield) can't
    // reproduce this; this one deliberately can.
    let projects: Array<{ id: string; name: string; path: string; createdAt: string }> = [];
    let counter = 0;
    const racyProjectService = {
      findOrCreateByPath: async (path: string) => {
        const snapshot = projects;
        const existing = snapshot.find((p) => p.path === path);
        if (existing) return existing;
        await Promise.resolve();
        counter += 1;
        const created = { id: `proj-${counter}`, name: path.split('/').pop() ?? path, path, createdAt: '' };
        projects = [...snapshot, created];
        return created;
      },
    };

    const service = new InstructionService(base, racyProjectService);
    await service.save({ instruction: legacyProject('legacy-a', '/repos/legacy-a'), isCreate: true });
    await service.save({ instruction: legacyProject('legacy-b', '/repos/legacy-b'), isCreate: true });
    await service.save({ instruction: legacyProject('legacy-c', '/repos/legacy-c'), isCreate: true });

    const list = await service.list();
    const migratedNames = list.filter((i) => i.name.startsWith('legacy-')).map((i) => i.name);
    expect(migratedNames).toEqual(expect.arrayContaining(['legacy-a', 'legacy-b', 'legacy-c']));
    expect(list.every((i) => i.scopeId !== undefined)).toBe(true);

    // The real assertion: every migrated Project must actually persist in the
    // registry, not just be returned in-memory to the instruction that raced
    // its way to creating it.
    expect(projects).toHaveLength(3);
  });
});
