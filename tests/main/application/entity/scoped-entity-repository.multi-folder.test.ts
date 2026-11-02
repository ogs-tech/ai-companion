import { describe, it, expect } from 'vitest';
import { ScopedEntityRepository } from '../../../../src/main/application/entity/scoped-entity-repository.js';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../src/shared/entity.js';

const skill = (name: string, over: Partial<Skill> = {}): Skill => ({
  urn: `urn:skill:${name}`, kind: 'skill', name, description: 'd', scopes: ['workspace'], scopeId: 'ws',
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'c', ...over,
});

const setup = () => {
  const web = new InMemoryEntityRepository();
  const api = new InMemoryEntityRepository();
  const shared = new InMemoryEntityRepository();
  const scoped = new ScopedEntityRepository(
    { repository: new InMemoryEntityRepository(), dataDir: '/g' },
    {
      repository: web, dataDir: '/r/web/.ai-companion', workspaceId: 'ws',
      folders: [
        { folder: '/r/web', repository: web, dataDir: '/r/web/.ai-companion' },
        { folder: '/r/api', repository: api, dataDir: '/r/api/.ai-companion' },
      ],
      shared: { repository: shared, dataDir: '/h/ws/data' },
    },
  );
  return { scoped, web, api, shared };
};

describe('ScopedEntityRepository — multi-folder', () => {
  it('routes a save by entity.folder, and an entity without folder to the shared set', async () => {
    const { scoped, web, api, shared } = setup();
    await scoped.save(skill('a', { folder: '/r/api' }));
    await scoped.save(skill('b', { folder: '/r/web' }));
    await scoped.save(skill('c'));
    expect(await api.exists('urn:skill:a')).toBe(true);
    expect(await web.exists('urn:skill:b')).toBe(true);
    expect(await shared.exists('urn:skill:c')).toBe(true);
  });

  it('tags listed entities with their folder; shared ones stay untagged', async () => {
    const { scoped } = setup();
    await scoped.save(skill('a', { folder: '/r/api' }));
    await scoped.save(skill('c'));
    const byName = Object.fromEntries((await scoped.list()).map((e) => [e.name, e.folder]));
    expect(byName).toEqual({ a: '/r/api', c: undefined });
    expect((await scoped.get('urn:skill:a')).folder).toBe('/r/api');
  });

  it('an edit that lost its folder goes back to where the entity lives, not the shared set', async () => {
    const { scoped, api, shared } = setup();
    await scoped.save(skill('a', { folder: '/r/api' }));
    await scoped.save(skill('a', { description: 'edited' }));
    expect((await api.get('urn:skill:a')).description).toBe('edited');
    expect(await shared.exists('urn:skill:a')).toBe(false);
  });

  it('names are unique across every store', async () => {
    const { scoped } = setup();
    await scoped.save(skill('a', { folder: '/r/api' }));
    expect(await scoped.exists('urn:skill:a')).toBe(true);
  });

  it('dataDirFor follows the entity folder, and refuses a folder outside the workspace', () => {
    const { scoped } = setup();
    expect(scoped.dataDirFor({ scopes: ['workspace'], folder: '/r/api' })).toBe('/r/api/.ai-companion');
    expect(scoped.dataDirFor({ scopes: ['workspace'] })).toBe('/h/ws/data');
    expect(() => scoped.dataDirFor({ scopes: ['workspace'], folder: '/elsewhere' })).toThrow(/not a folder/);
  });

  it('deletes from whichever store holds the urn', async () => {
    const { scoped, api } = setup();
    await scoped.save(skill('a', { folder: '/r/api' }));
    await scoped.delete('urn:skill:a');
    expect(await api.exists('urn:skill:a')).toBe(false);
  });
});
