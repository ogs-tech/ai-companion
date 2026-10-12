import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import type { Entity } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';
import type { Adapter } from '../../../../../src/main/application/ports/adapter.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';

export const DEFAULT_WORKSPACE_PATH = '/workspace';

export const defaultSettings: Settings = {
  adapters: {
    claude: { enabled: true },
    cursor: { enabled: false },
  },  ui: { theme: 'system' },
  language: 'off',
};

export const setupAdapterManager = async (
  adapters: Adapter[],
  settings: Settings = defaultSettings,
  workspacePath: string = DEFAULT_WORKSPACE_PATH,
) => {
  const settingsRepo = new InMemorySettingsRepository();
  await settingsRepo.save(settings);
  const settingsService = new SettingsService(settingsRepo);
  const entityRepository = new InMemoryEntityRepository();
  const registerEntity = async (entity: Entity) => {
    await entityRepository.save(entity);
  };
  const fs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date('2026-04-26T10:00:00.000Z'));
  const symlinkManager = new SymlinkManager(fs, clock, workspacePath);
  const fileMaterializer = new FileMaterializer(fs, clock, workspacePath);
  const manager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager,
    fileMaterializer,
    entityDataDir: () => workspacePath,
    adapters: new Map(adapters.map((adapter) => [adapter.adapterId, adapter])),
  });
  return {
    settingsService,
    entityRepository,
    symlinkManager,
    fileMaterializer,
    manager,
    fs,
    registerEntity,
    workspacePath,
  };
};
