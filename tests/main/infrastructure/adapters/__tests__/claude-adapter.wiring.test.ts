import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';

const HOMEDIR = '/Users/alice';
const WORKSPACE = '/workspace';

const skillPersonal: Skill = {
  urn: 'urn:skill:review',
  kind: 'skill',
  name: 'review',
  description: 'desc',
  scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: '# review',
};

const buildSettings = (claudeEnabled: boolean): Settings => ({
  adapters: {
    claude: { enabled: claudeEnabled },
    cursor: { enabled: false },
  },  ui: { theme: 'system' },
  language: 'off',
});

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

const setup = async (settings: Settings) => {
  const settingsRepo = new InMemorySettingsRepository();
  await settingsRepo.save(settings);
  const settingsService = new SettingsService(settingsRepo);
  const entityRepository = new InMemoryEntityRepository();
  const fs = new InMemoryFileSystem();
  fs.createFile('/workspace/skills/review/SKILL.md', '# review');
  const clock = new FixedClock(new Date('2026-04-26T10:00:00.000Z'));
  const symlinkManager = new SymlinkManager(fs, clock, WORKSPACE);
  const fileMaterializer = new FileMaterializer(fs, clock, WORKSPACE);
  const claudeAdapter = new ClaudeAdapter({ homedir: HOMEDIR, ...scopeDeps });
  const manager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager,
    fileMaterializer,
    workspacePath: WORKSPACE,
    adapters: new Map([[claudeAdapter.adapterId, claudeAdapter]]),
  });
  await entityRepository.save(skillPersonal);
  return { manager, fs };
};

describe('ClaudeAdapter — wiring with AdapterManager', () => {
  it('produces a SyncResult with adapter:"claude", status:"ok" when enabled', async () => {
    const { manager } = await setup(buildSettings(true));

    const results = await manager.syncAll({});

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      adapter: 'claude',
      status: 'ok',
      destination: '/Users/alice/.claude/skills/review',
    });
  });

  it('produces zero SyncResults with adapter:"claude" when disabled', async () => {
    const { manager } = await setup(buildSettings(false));

    const results = await manager.syncAll({});

    const claudeResults = results.filter((r) => r.adapter === 'claude');
    expect(claudeResults).toHaveLength(0);
  });
});
