import { describe, expect, it } from 'vitest';
import { CursorAdapter } from '../../../../../src/main/infrastructure/adapters/cursor-adapter.js';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import { SymlinkCollector } from '../../../../../src/main/application/services/health/symlink-collector.js';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { Adapter } from '../../../../../src/main/application/ports/adapter.js';
import type { Settings } from '../../../../../src/shared/settings.js';
import { WORKSPACE_SOURCE, type Entity, type Skill } from '../../../../../src/shared/entity.js';

const skill = {
  urn: 'urn:skill:backlog', kind: 'skill', name: 'backlog', description: 'd',
  scopes: ['personal'], metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
} as unknown as Skill;
const settings: Settings = {
  adapters: { claude: { enabled: false }, cursor: { enabled: true }, lmstudio: { enabled: false } }, ui: { theme: 'system' }, language: 'off',
};
const source = '/data/skills/backlog';
const destination = '/home/u/.cursor/skills/backlog';
const repoSkill = `${destination}/SKILL.md`;

const setup = async () => {
  const settingsRepo = new InMemorySettingsRepository();
  await settingsRepo.save(settings);
  const entityRepository = new InMemoryEntityRepository();
  await entityRepository.save(skill as Entity);
  const fs = new InMemoryFileSystem();
  await fs.writeFile(`${source}/SKILL.md`, 'canonical');
  // The user's own copy, there before the app: a real folder at the Cursor destination.
  await fs.writeFile(repoSkill, 'hand-written');
  const clock = new FixedClock(new Date('2026-11-17T10:00:00.000Z'));
  const symlinkManager = new SymlinkManager(fs, clock, '/data');
  const manager = new AdapterManager({
    settingsService: new SettingsService(settingsRepo),
    entityRepository,
    symlinkManager,
    fileMaterializer: new FileMaterializer(fs, clock, '/data'),
    entityDataDir: () => '/data',
    adapters: new Map<string, Adapter>([['cursor', new CursorAdapter({ homedir: '/home/u', workspaceService: { get: async () => { throw new Error('unused'); } } })]]),
  });
  const outcome = async () => (await new SymlinkCollector(manager, symlinkManager, clock).collect())[0]?.outcome;
  return { manager, fs, outcome };
};

describe('AdapterManager.install', () => {
  it('a sync leaves a folder the app does not own alone, and health calls it a draft (not installed)', async () => {
    const { manager, fs, outcome } = await setup();
    const [result] = await manager.syncAll({ adapterId: 'cursor' });
    expect(result?.details).toMatchObject({ skipped: 'foreign-file' });
    expect(await fs.readFile(repoSkill)).toBe('hand-written');
    expect(await outcome()).toBe('draft');
  });

  it('install moves the folder to a backup and links the canonical skill; undo puts the folder back', async () => {
    const { manager, fs, outcome } = await setup();
    const { undoToken } = await manager.install({ urn: skill.urn, adapterId: 'cursor' });
    expect((await fs.lstat(destination)).kind).toBe('symlink');
    expect(await outcome()).toBe('installed');
    const backup = '/data/_backups/20261117T100000/home/u/.cursor/skills/backlog/SKILL.md';
    expect(await fs.readFile(backup)).toBe('hand-written');

    await manager.undoInstall({ undoToken: undoToken ?? '' });
    expect((await fs.lstat(destination)).kind).toBe('directory');
    expect(await fs.readFile(repoSkill)).toBe('hand-written');
    expect(await outcome()).toBe('draft');
  });

  it('once installed, a broken link is an error, not a draft', async () => {
    const { manager, fs, outcome } = await setup();
    await manager.install({ urn: skill.urn, adapterId: 'cursor' });
    await fs.unlink(destination);
    expect(await outcome()).toBe('error');
  });

  it('install over nothing has nothing to undo', async () => {
    const { manager, fs } = await setup();
    await fs.remove(destination);
    expect(await manager.install({ urn: skill.urn, adapterId: 'cursor' })).toEqual({});
  });
});
