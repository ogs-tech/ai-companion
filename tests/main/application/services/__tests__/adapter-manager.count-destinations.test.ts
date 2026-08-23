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
import { WORKSPACE_SOURCE, type Skill } from '../../../../../src/shared/entity.js';
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
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

describe('AdapterManager.countDestinations (AC#17)', () => {
  it('counts only symlinks pointing to workspace', async () => {
    const settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.save(baseSettings);
    const settingsService = new SettingsService(settingsRepo);
    const entityRepository = new InMemoryEntityRepository();
    await entityRepository.save(makeSkillEntity('art1'));
    await entityRepository.save(makeSkillEntity('art2'));

    const fs = new InMemoryFileSystem();
    const dest1 = join(HOMEDIR, '.claude/skills/art1');
    const dest2 = join(HOMEDIR, '.claude/skills/art2');
    await fs.symlink({ target: join(WORKSPACE, 'skills/art1/SKILL.md'), path: dest1 });
    await fs.symlink({ target: join(WORKSPACE, 'skills/art2/SKILL.md'), path: dest2 });

    const sm = new SymlinkManager(fs, new FixedClock(new Date()), WORKSPACE);
    const fileMaterializer = new FileMaterializer(fs, new FixedClock(new Date()), WORKSPACE);
    const claudeAdapter = new ClaudeAdapter({ homedir: HOMEDIR, ...scopeDeps });
    const manager = new AdapterManager({
      settingsService,
      entityRepository,
      symlinkManager: sm,
      fileMaterializer,
      workspacePath: WORKSPACE,
      adapters: new Map([['claude', claudeAdapter]]),
    });

    const count = await manager.countDestinations('claude');
    expect(count).toBe(2);
  });
});
