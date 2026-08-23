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
import {
  WORKSPACE_SOURCE,
  type Instruction,
  type Skill,
} from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';

const HOMEDIR = '/Users/alice';
const WORKSPACE = '/workspace';

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };

const skillPersonal: Skill = {
  urn: 'urn:skill:review',
  kind: 'skill',
  name: 'review',
  description: 'desc',
  scopes: ['personal'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: '# review',
};

const projectInstruction: Instruction = {
  urn: 'urn:instruction:acme',
  kind: 'instruction',
  name: 'acme',
  description: 'acme rules',
  scopes: ['project'],
  metadata: meta,
  source: WORKSPACE_SOURCE,
  content: '# acme',
  scopeId: 'acme',
};

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
};

const buildSettings = (): Settings => ({
  adapters: {
    claude: { enabled: true },
    cursor: { enabled: false },
  },
  ui: { theme: 'system' },
  language: 'off',
});

const setup = async (settings: Settings) => {
  const settingsRepo = new InMemorySettingsRepository();
  await settingsRepo.save(settings);
  const settingsService = new SettingsService(settingsRepo);
  const entityRepository = new InMemoryEntityRepository();
  const fs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date('2026-04-26T10:00:00.000Z'));
  const symlinkManager = new SymlinkManager(fs, clock, WORKSPACE);
  const fileMaterializer = new FileMaterializer(fs, clock, WORKSPACE);
  const claudeAdapter = new ClaudeAdapter({ homedir: HOMEDIR, ...scopeDeps });
  const adapterManager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager,
    fileMaterializer,
    workspacePath: WORKSPACE,
    adapters: new Map([[claudeAdapter.adapterId, claudeAdapter]]),
  });
  return { adapterManager, entityRepository, fs, settingsService };
};

describe('ClaudeAdapter — end-to-end via AdapterManager.syncEntity', () => {
  it('syncEntity(skill, scope=personal) creates symlink at <homedir>/.claude/skills/<slug> resolving to <workspace>/skills/<slug>', async () => {
    const { adapterManager, entityRepository, fs } = await setup(buildSettings());
    await entityRepository.save(skillPersonal);

    const syncReport = await adapterManager.syncEntity({ entity: skillPersonal });

    expect(syncReport).toHaveLength(1);
    expect(syncReport[0]).toMatchObject({ adapter: 'claude', status: 'ok' });

    const destination = '/Users/alice/.claude/skills/review';
    const stat = await fs.lstat(destination);
    expect(stat.kind).toBe('symlink');
    const target = await fs.readlink(destination);
    expect(target).toBe('/workspace/skills/review');
  });

  it('syncEntity(project instruction) creates 2 symlinks under entity.repoPath resolving to the workspace body', async () => {
    const { adapterManager, entityRepository, fs } = await setup(buildSettings());
    await entityRepository.save(projectInstruction);

    const syncReport = await adapterManager.syncEntity({ entity: projectInstruction });

    const okResults = syncReport.filter((r) => r.adapter === 'claude' && r.status === 'ok');
    expect(okResults).toHaveLength(2);

    const expectedTarget = '/workspace/instructions/project/acme/INSTRUCTION.md';
    for (const dest of [
      '/repos/acme/.claude/CLAUDE.md',
      '/repos/acme/AGENTS.md',
    ]) {
      const stat = await fs.lstat(dest);
      expect(stat.kind).toBe('symlink');
      const target = await fs.readlink(dest);
      expect(target).toBe(expectedTarget);
    }
  });

  it('re-sync without changes is idempotent: no new backups, symlink target unchanged', async () => {
    const { adapterManager, entityRepository, fs } = await setup(buildSettings());
    await entityRepository.save(skillPersonal);
    await adapterManager.syncEntity({ entity: skillPersonal });

    const destination = '/Users/alice/.claude/skills/review';
    const targetBefore = await fs.readlink(destination);
    const backupsBefore = await fs.pathExists('/workspace/_backups');

    const syncReport = await adapterManager.syncEntity({ entity: skillPersonal });

    expect(syncReport).toHaveLength(1);
    expect(syncReport[0]).toMatchObject({ adapter: 'claude', status: 'ok' });
    expect(syncReport[0]?.details).toBeUndefined();

    const targetAfter = await fs.readlink(destination);
    expect(targetAfter).toBe(targetBefore);

    const backupsAfter = await fs.pathExists('/workspace/_backups');
    expect(backupsAfter).toBe(backupsBefore);
  });
});
