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
      schemaVersion: 2,
      workspaces: [{ id: 'ws-1', name: 'Acme', rootPath: '/repos/acme', createdAt: '2026-01-01T00:00:00.000Z' }],
      activeWorkspaceId: 'ws-1',
    };
    await registry.save(file);
    expect(await registry.load()).toEqual(file);
  });

  it('save creates the parent directory if missing', async () => {
    const registry = new FsWorkspaceRegistry(join(dir, 'a', 'b', 'workspaces.json'));
    await registry.save({ schemaVersion: 2, workspaces: [], activeWorkspaceId: null });
    expect(await registry.load()).toEqual({ schemaVersion: 2, workspaces: [], activeWorkspaceId: null });
  });
});
