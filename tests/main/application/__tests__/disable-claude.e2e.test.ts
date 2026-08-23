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
import { WORKSPACE_SOURCE, type Agent, type Skill } from '../../../../src/shared/entity.js';
import type { Settings } from '../../../../src/shared/settings.js';

const HOMEDIR = '/home/alice';
const WORKSPACE = '/workspace';

const baseSettings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },  ui: { theme: 'system' },
  language: 'off',
};

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

const skillPersonal: Skill = {
  urn: 'urn:skill:my-skill',
  kind: 'skill',
  name: 'my-skill',
  description: 'desc',
  scopes: ['personal'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: '# skill',
};

const agentPersonal: Agent = {
  urn: 'urn:agent:my-agent',
  kind: 'agent',
  name: 'my-agent',
  description: 'desc',
  scopes: ['personal'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  systemPrompt: '# agent',
};

const skillRealFile: Skill = {
  urn: 'urn:skill:real-skill',
  kind: 'skill',
  name: 'real-skill',
  description: 'desc',
  scopes: ['personal'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: '# real skill',
};

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

describe('disable-claude e2e (AC#10)', () => {
  it('removes workspace symlinks and skips real file', async () => {
    const settingsRepo = new InMemorySettingsRepository();
    await settingsRepo.save(baseSettings);
    const settingsService = new SettingsService(settingsRepo);
    const entityRepository = new InMemoryEntityRepository();
    await entityRepository.save(skillPersonal);
    await entityRepository.save(agentPersonal);
    await entityRepository.save(skillRealFile);

    const fs = new InMemoryFileSystem();
    const symlinkPersonalSkill = join(HOMEDIR, '.claude/skills/my-skill');
    const symlinkPersonalAgent = join(HOMEDIR, '.claude/agents/my-agent.md');
    const realFile = join(HOMEDIR, '.claude/skills/real-skill');

    await fs.symlink({ target: join(WORKSPACE, 'skills/my-skill'), path: symlinkPersonalSkill });
    await fs.symlink({ target: join(WORKSPACE, 'agents/my-agent.md'), path: symlinkPersonalAgent });
    fs.createFile(realFile, 'real content');

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

    expect(result.removed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(0);

    const realEntry = await fs.lstat(realFile);
    expect(realEntry.kind).toBe('file');
  });
});
