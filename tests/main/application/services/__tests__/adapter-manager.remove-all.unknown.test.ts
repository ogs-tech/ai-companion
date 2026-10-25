import { describe, it, expect, vi } from 'vitest';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import type { Settings } from '../../../../../src/shared/settings.js';

const baseSettings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },  ui: { theme: 'system' },
  language: 'off',
};

const setup = async () => {
  const repo = new InMemorySettingsRepository();
  await repo.save(baseSettings);
  const settingsService = new SettingsService(repo);
  const entityRepository = new InMemoryEntityRepository();
  const fs = new InMemoryFileSystem();
  const sm = new SymlinkManager(fs, new FixedClock(new Date()), '/workspace');
  const fileMaterializer = new FileMaterializer(fs, new FixedClock(new Date()), '/workspace');
  const manager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager: sm,
    fileMaterializer,
    entityDataDir: () => '/workspace',
    adapters: new Map(),
  });
  const listSpy = vi.spyOn(entityRepository, 'list');
  return { manager, listSpy };
};

describe('AdapterManager.removeAdapterSymlinks — unknown adapter (AC#4)', () => {
  it('returns { removed: 0, skipped: 0, errors: [] } without calling list', async () => {
    const { manager, listSpy } = await setup();

    const result = await manager.removeAdapterSymlinks('unknown');

    expect(result).toEqual({ removed: 0, skipped: 0, errors: [] });
    expect(listSpy).not.toHaveBeenCalled();
  });
});
