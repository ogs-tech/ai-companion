import { describe, it, expect, vi } from 'vitest';
import { InstructionService } from '../../../../src/main/application/services/instruction-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeCliPort } from '../../../../src/main/application/services/__fixtures__/fake-claude-cli-port.js';
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

  it('generatePersonalDraft returns the claude CLI text as content', async () => {
    const { service, claudeCli } = setup();
    claudeCli.seedResponse('# Global instructions\n\nBe concise.\n');
    const result = await service.generatePersonalDraft('I like short replies');
    expect(result.content).toBe('# Global instructions\n\nBe concise.\n');
    expect(claudeCli.lastPrompt).toContain('I like short replies');
  });

  it('generatePersonalDraft forwards onEvent through to the claude CLI port', async () => {
    const { service, claudeCli } = setup();
    claudeCli.seedResponse('draft');
    const onEvent = vi.fn();
    await service.generatePersonalDraft(undefined, onEvent);
    expect(claudeCli.lastOnEvent).toBe(onEvent);
  });

  it('generatePersonalDraft wraps a claude CLI failure as an io DomainError', async () => {
    const { service, claudeCli } = setup();
    claudeCli.failNext(new Error('claude CLI not found in PATH'));
    const err = await service.generatePersonalDraft().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('io');
    expect((err as DomainError).message).toContain('claude CLI not found in PATH');
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
});
