import { describe, expect, it } from 'vitest';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import { GENERATED_FILE_MARKER } from '../../../../../src/main/application/entity/agents-file.js';
import type { Adapter, AdapterDestination } from '../../../../../src/main/application/ports/adapter.js';
import type { Settings } from '../../../../../src/shared/settings.js';
import { WORKSPACE_SOURCE, type Entity, type Skill } from '../../../../../src/shared/entity.js';

// Minimal adapter that emits ONE write destination carrying content. Registered
// under adapterId 'cursor' below so `enabledAdapters` (which reads settings.adapters
// by the adapter's own id) includes it.
class WriteOnlyAdapter implements Adapter {
  readonly adapterId = 'cursor';
  constructor(private readonly destination: string, private readonly content: string) {}
  resolveEntityDestinations(): AdapterDestination[] {
    return [{ scope: 'workspace', destination: this.destination, strategy: 'write', content: this.content }];
  }
}

const settings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: true } },  ui: { theme: 'system' }, language: 'off',
};

const skill: Skill = {
  urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd', scopes: ['workspace'],
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'b',
};

const setup = async () => {
  const settingsRepo = new InMemorySettingsRepository();
  await settingsRepo.save(settings);
  const settingsService = new SettingsService(settingsRepo);
  const entityRepository = new InMemoryEntityRepository();
  await entityRepository.save(skill as Entity);
  const fs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date('2026-07-02T10:00:00.000Z'));
  const content = `${GENERATED_FILE_MARKER}\n\nhello\n`;
  const manager = new AdapterManager({
    settingsService, entityRepository,
    symlinkManager: new SymlinkManager(fs, clock, '/workspace'),
    fileMaterializer: new FileMaterializer(fs, clock, '/workspace'),
    entityDataDir: () => '/workspace',
    adapters: new Map<string, Adapter>([['cursor', new WriteOnlyAdapter('/repos/app/AGENTS.md', content)]]),
  });
  return { manager, fs, content };
};

describe('AdapterManager write-strategy sync', () => {
  it('materializes a write destination via syncAll', async () => {
    const { manager, fs, content } = await setup();
    const results = await manager.syncAll({ adapterId: 'cursor' });
    expect(results.some((r) => r.destination === '/repos/app/AGENTS.md' && r.status === 'ok')).toBe(true);
    expect(await fs.readFile('/repos/app/AGENTS.md')).toBe(content);
  });

  it('removeAll deletes the owned generated file', async () => {
    const { manager, fs } = await setup();
    await manager.syncAll({ adapterId: 'cursor' });
    await manager.removeAll({ adapterId: 'cursor' });
    expect(await fs.pathExists('/repos/app/AGENTS.md')).toBe(false);
  });
});
