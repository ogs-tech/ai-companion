import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { InMemoryEntityRepository } from '../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { SymlinkManager } from '../../../../src/main/application/services/symlink-manager.js';
import { FileMaterializer } from '../../../../src/main/application/services/file-materializer.js';
import { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { SettingsService } from '../../../../src/main/application/services/settings-service.js';
import { ClaudeAdapter } from '../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../src/shared/entity.js';
import type { Settings } from '../../../../src/shared/settings.js';

const HOMEDIR = '/home/alice';
const WORKSPACE = '/workspace';

const baseSettings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },  ui: { theme: 'system' },
  language: 'off',
};

const skillPersonal: Skill = {
  urn: 'urn:skill:my-skill',
  kind: 'skill',
  name: 'my-skill',
  description: 'desc',
  scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: '# skill',
};

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

describe('disable-claude-external-symlink e2e (AC#13)', () => {
  it('external symlink is skipped and remains after removeAdapterSymlinks', async () => {
    const settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.save(baseSettings);
    const settingsService = new SettingsService(settingsRepo);
    const entityRepository = new InMemoryEntityRepository();
    await entityRepository.save(skillPersonal);

    const fs = new InMemoryFileSystem();
    const dest = join(HOMEDIR, '.claude/skills/my-skill');
    await fs.symlink({ target: '/tmp/external-target', path: dest });

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

    const result = await manager.removeAdapterSymlinks('claude');

    expect(result.skipped).toBe(1);
    expect(result.removed).toBe(0);
    const entry = await fs.lstat(dest);
    expect(entry.kind).toBe('symlink');
  });
});
