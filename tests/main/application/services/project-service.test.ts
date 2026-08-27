import { describe, it, expect, vi } from 'vitest';
import { ProjectService } from '../../../../src/main/application/services/project-service.js';
import { DomainError } from '../../../../src/main/domain/errors.js';
import { InMemoryProjectRegistry } from '../../../../src/main/infrastructure/project/in-memory-project-registry.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { workspaceIndexMarkerPath, projectIndexMarkerPath } from '../../../../src/shared/brand-paths.js';

const DATA_DIR = '/home/u/.ai-companion';
const INDEX_SOURCE = workspaceIndexMarkerPath(DATA_DIR);

const setup = () => {
  const registry = new InMemoryProjectRegistry();
  const clock = new FixedClock(new Date('2026-08-22T10:00:00.000Z'));
  const create = vi.fn().mockResolvedValue({ status: 'ok' });
  const removeIfPointsToWorkspace = vi.fn().mockResolvedValue('removed');
  const symlinkManager = { create, removeIfPointsToWorkspace };
  const service = new ProjectService(registry, clock, {
    symlinkManager,
    sourcePath: INDEX_SOURCE,
    dataDir: DATA_DIR,
  });
  return { service, registry, create, removeIfPointsToWorkspace };
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

  describe('index marker symlink', () => {
    it('create symlinks <path>/.ai-companion/index.md to the workspace canonical index.md', async () => {
      const { service, create } = setup();
      await service.create({ name: 'acme', path: '/repos/acme' });
      expect(create).toHaveBeenCalledWith({
        source: INDEX_SOURCE,
        destination: projectIndexMarkerPath('/repos/acme'),
      });
    });

    it('delete removes the marker symlink, guarded to the workspace dataDir', async () => {
      const { service, removeIfPointsToWorkspace } = setup();
      const created = await service.create({ name: 'acme', path: '/repos/acme' });
      await service.delete(created.id);
      expect(removeIfPointsToWorkspace).toHaveBeenCalledWith(projectIndexMarkerPath('/repos/acme'), DATA_DIR);
    });

    it('update re-links the marker when the path changes', async () => {
      const { service, create, removeIfPointsToWorkspace } = setup();
      const created = await service.create({ name: 'acme', path: '/repos/acme' });
      create.mockClear();
      await service.update({ id: created.id, path: '/repos/acme-moved' });
      expect(removeIfPointsToWorkspace).toHaveBeenCalledWith(projectIndexMarkerPath('/repos/acme'), DATA_DIR);
      expect(create).toHaveBeenCalledWith({
        source: INDEX_SOURCE,
        destination: projectIndexMarkerPath('/repos/acme-moved'),
      });
    });

    it('update does not touch the marker when only the name changes', async () => {
      const { service, create, removeIfPointsToWorkspace } = setup();
      const created = await service.create({ name: 'acme', path: '/repos/acme' });
      create.mockClear();
      await service.update({ id: created.id, name: 'acme-renamed' });
      expect(create).not.toHaveBeenCalled();
      expect(removeIfPointsToWorkspace).not.toHaveBeenCalled();
    });

    it('create still succeeds when the marker symlink fails', async () => {
      const { service, create } = setup();
      create.mockRejectedValueOnce(new Error('EACCES'));
      const project = await service.create({ name: 'acme', path: '/repos/acme' });
      expect(project.name).toBe('acme');
    });

    it('delete still succeeds when the marker removal fails', async () => {
      const { service, removeIfPointsToWorkspace } = setup();
      const created = await service.create({ name: 'acme', path: '/repos/acme' });
      removeIfPointsToWorkspace.mockRejectedValueOnce(new Error('EACCES'));
      await expect(service.delete(created.id)).resolves.toBeUndefined();
    });
  });
});
