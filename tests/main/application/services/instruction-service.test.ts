import { describe, it, expect, vi } from 'vitest';
import { InstructionService } from '../../../../src/main/application/services/instruction-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../../src/shared/entity.js';
import { DomainError } from '../../../../src/main/domain/errors.js';
import { scopedRepository } from '../../helpers/scoped-repository.js';

const personal = (): Instruction => ({
  urn: 'urn:instruction:default', kind: 'instruction', name: 'default', description: '',
  scopes: ['personal'], metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: '# Instructions\n',
});

const workspace = (name = 'acme', scopeId = 'ws-1'): Instruction => ({
  urn: `urn:instruction:${name}`, kind: 'instruction', name, description: `${name} rules`,
  scopes: ['workspace'], scopeId, metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: `# ${name}\n`,
});

const setup = () => {
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(scopedRepository({ workspaceId: 'ws-1' }).scoped, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  return { service: new InstructionService(base), adapterManager };
};

describe('InstructionService', () => {
  it('saves and gets the default (personal) instruction', async () => {
    const { service } = setup();
    await service.save({ instruction: personal(), isCreate: true });
    const got = await service.get();
    expect(got.urn).toBe('urn:instruction:default');
    expect(got.content).toContain('# Instructions');
  });

  it('list returns the personal instruction followed by the open workspace\'s instructions', async () => {
    const { service } = setup();
    await service.save({ instruction: personal(), isCreate: true });
    await service.save({ instruction: workspace('acme', 'ws-1'), isCreate: true });
    await service.save({ instruction: workspace('bravo', 'ws-1'), isCreate: true });

    const list = await service.list();
    const names = list.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['default', 'acme', 'bravo']));
    expect(list.every((i) => i.kind === 'instruction')).toBe(true);
  });

  it('get(<slug>) validates the slug and returns the workspace instruction', async () => {
    const { service } = setup();
    await service.save({ instruction: workspace('acme', 'ws-1'), isCreate: true });
    const got = await service.get('acme');
    expect(got.name).toBe('acme');
    expect(got.scopeId).toBe('ws-1');
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

  it('delete("<slug>") removes a workspace instruction; removeSymlinks=false skips sync', async () => {
    const { service, adapterManager } = setup();
    const removeEntity = (adapterManager as unknown as { removeEntity: ReturnType<typeof vi.fn> }).removeEntity;
    await service.save({ instruction: workspace('acme', 'ws-1'), isCreate: true });
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

  it('resolvePath returns the personal instruction\'s canonical source file path', async () => {
    const { service } = setup();
    await service.save({ instruction: personal(), isCreate: true });
    expect(await service.resolvePath()).toBe('/in-memory/urn:instruction:default');
  });

  it('resolvePath returns a workspace instruction\'s canonical source file path', async () => {
    const { service } = setup();
    await service.save({ instruction: workspace('acme', 'ws-1'), isCreate: true });
    expect(await service.resolvePath('acme')).toBe('/in-memory/urn:instruction:acme');
  });
});
