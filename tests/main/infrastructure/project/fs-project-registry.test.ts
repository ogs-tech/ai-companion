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
