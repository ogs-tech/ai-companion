import { describe, it, expect } from 'vitest';
import { ProjectService } from '../../../../src/main/application/services/project-service.js';
import { DomainError } from '../../../../src/main/domain/errors.js';
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

  it('create rejects a relative path with a validation DomainError', async () => {
    const { service } = setup();
    const err = await service.create({ name: 'acme', path: 'repos/acme' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('validation');
    expect(await service.list()).toEqual([]);
  });

  it('create accepts an absolute path', async () => {
    const { service } = setup();
    const project = await service.create({ name: 'acme', path: '/repos/acme' });
    expect(project.path).toBe('/repos/acme');
  });

  it('findOrCreateByPath rejects a relative path with a validation DomainError', async () => {
    const { service } = setup();
    const err = await service.findOrCreateByPath('repos/acme').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('validation');
  });

  it('findOrCreateByPath accepts an absolute path', async () => {
    const { service } = setup();
    const project = await service.findOrCreateByPath('/repos/acme');
    expect(project.path).toBe('/repos/acme');
  });

  it('update rejects a relative path with a validation DomainError, leaving the project unchanged', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'acme', path: '/repos/acme' });
    const err = await service.update({ id: created.id, path: 'repos/elsewhere' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('validation');
    expect(await service.get(created.id)).toEqual(created);
  });

  it('update accepts an absolute path', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'acme', path: '/repos/acme' });
    const updated = await service.update({ id: created.id, path: '/repos/acme-moved' });
    expect(updated.path).toBe('/repos/acme-moved');
  });
});
