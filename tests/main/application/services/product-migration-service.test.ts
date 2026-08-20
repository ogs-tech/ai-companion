import { describe, expect, it, vi } from 'vitest';
import { ProductMigrationService } from '../../../../src/main/application/services/product-migration-service.js';
import type { WritableFileSystemPort } from '../../../../src/main/application/ports/writable-filesystem-port.js';
import {
  cursorPluginPath,
  legacyCursorPluginPath,
  legacyWorkspacePath,
  workspacePath,
} from '../../../../src/shared/brand-paths.js';

function buildFs(exists: Set<string>): WritableFileSystemPort {
  return {
    pathExists: vi.fn(async (p: string) => exists.has(p)),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async (from: string, to: string) => {
      exists.delete(from);
      exists.add(to);
    }),
  } as unknown as WritableFileSystemPort;
}

describe('ProductMigrationService', () => {
  it('renames the legacy workspace when the new path is absent', async () => {
    const home = '/home/u';
    const legacy = legacyWorkspacePath(home);
    const target = workspacePath(home);
    const fs = buildFs(new Set([legacy]));
    const service = new ProductMigrationService(fs);

    const result = await service.migrate(home);

    expect(result.workspacePath).toBe(target);
    expect(fs.rename).toHaveBeenCalledWith(legacy, target);
  });

  it('renames the legacy Cursor plugin directory when needed', async () => {
    const home = '/home/u';
    const legacyPlugin = legacyCursorPluginPath(home);
    const targetPlugin = cursorPluginPath(home);
    const fs = buildFs(new Set([legacyPlugin]));
    const service = new ProductMigrationService(fs);

    await service.migrate(home);

    expect(fs.rename).toHaveBeenCalledWith(legacyPlugin, targetPlugin);
  });

  it('does not rename when the new workspace already exists', async () => {
    const home = '/home/u';
    const legacy = legacyWorkspacePath(home);
    const target = workspacePath(home);
    const fs = buildFs(new Set([legacy, target]));
    const service = new ProductMigrationService(fs);

    await service.migrate(home);

    expect(fs.rename).not.toHaveBeenCalledWith(legacy, target);
  });
});
