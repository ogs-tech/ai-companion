import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { DomainError } from '../../../../../src/main/domain/errors.js';
import { WORKSPACE_SOURCE, type Instruction, type Skill } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';

const HOMEDIR = '/home/alice';
const WORKSPACE = '/workspace';

const baseSettings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },  ui: { theme: 'system' },
  language: 'off',
};

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

const makeSkillEntity = (name: string): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill',
  name,
  description: 'desc',
  scopes: ['personal'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: '# test',
});

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
};


const build = async (names: string[]) => {
  const settingsRepo = new InMemorySettingsRepository();
  await settingsRepo.save(baseSettings);
  const entityRepository = new InMemoryEntityRepository();
  for (const n of names) await entityRepository.save(makeSkillEntity(n));
  const fs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date());
  const manager = new AdapterManager({
    settingsService: new SettingsService(settingsRepo),
    entityRepository,
    symlinkManager: new SymlinkManager(fs, clock, WORKSPACE),
    fileMaterializer: new FileMaterializer(fs, clock, WORKSPACE),
    entityDataDir: () => WORKSPACE,
    adapters: new Map([['claude', new ClaudeAdapter({ homedir: HOMEDIR, ...scopeDeps })]]),
  });
  return { manager, fs, entityRepository };
};

describe('AdapterManager.entitySyncStates', () => {
  it('reports pending before the first sync and synced after it', async () => {
    const { manager } = await build(['art1']);
    expect(await manager.entitySyncStates()).toEqual({ 'urn:skill:art1': 'pending' });

    await manager.syncAll({});
    expect(await manager.entitySyncStates()).toEqual({ 'urn:skill:art1': 'synced' });
  });

  it('flips back to pending when a destination is removed from disk', async () => {
    const { manager, fs } = await build(['art1', 'art2']);
    await manager.syncAll({});
    await fs.unlink(join(HOMEDIR, '.claude/skills/art1'));

    expect(await manager.entitySyncStates()).toEqual({ 'urn:skill:art1': 'pending', 'urn:skill:art2': 'synced' });
  });

  it('omits entities that no enabled harness materializes', async () => {
    const { manager } = await build([]);
    expect(await manager.entitySyncStates()).toEqual({});
  });
});
