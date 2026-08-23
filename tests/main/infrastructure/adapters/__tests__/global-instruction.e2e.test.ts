import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import type { Adapter } from '../../../../../src/main/application/ports/adapter.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';

const HOMEDIR = '/Users/alice';
const WORKSPACE = '/workspace';

const globalInstruction = (): Instruction => ({
  urn: 'urn:instruction:default',
  kind: 'instruction',
  name: 'default',
  description: 'global instruction',
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: `# default\n`,
});

const baseSettings = (
  overrides: Partial<Settings['adapters']> = {},
): Settings => ({
  adapters: {
    claude: { enabled: true },
    cursor: { enabled: false },
    ...overrides,
  },  ui: { theme: 'system' },
  language: 'off',
});

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

const setup = async () => {
  const settingsRepo = new InMemorySettingsRepository();
  await settingsRepo.save(baseSettings());
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
    adapters: new Map<string, Adapter>([
      [claudeAdapter.adapterId, claudeAdapter],
    ]),
  });
  return { adapterManager, entityRepository, fs };
};

describe('global-instruction — end-to-end syncEntity to the Claude adapter', () => {
  it('syncEntity creates a Claude symlink at <homedir>/.claude/CLAUDE.md → <workspace>/instructions/default.md', async () => {
    const { adapterManager, entityRepository, fs } = await setup();
    const entity = globalInstruction();
    await entityRepository.save(entity);

    const syncReport = await adapterManager.syncEntity({ entity });

    const claudeOk = syncReport.find(
      (r) => r.adapter === 'claude' && r.status === 'ok' && r.destination === '/Users/alice/.claude/CLAUDE.md',
    );
    expect(claudeOk).toBeDefined();

    const destination = '/Users/alice/.claude/CLAUDE.md';
    const stat = await fs.lstat(destination);
    expect(stat.kind).toBe('symlink');
    const target = await fs.readlink(destination);
    expect(target).toBe('/workspace/instructions/default.md');
    expect(isAbsolute(destination)).toBe(true);
    expect(isAbsolute(target)).toBe(true);
  });

  it('syncEntity with preexisting file at ~/.claude/CLAUDE.md produces conflict + backup', async () => {
    const { adapterManager, entityRepository, fs } = await setup();
    const entity = globalInstruction();
    await entityRepository.save(entity);

    const preexistingPath = '/Users/alice/.claude/CLAUDE.md';
    fs.createFile(preexistingPath, 'prior content');

    const syncReport = await adapterManager.syncEntity({ entity });

    const claudeResult = syncReport.find(
      (r) => r.adapter === 'claude' && r.destination === preexistingPath,
    );
    expect(claudeResult).toBeDefined();
    expect(claudeResult!.status).toBe('conflict');
    expect(claudeResult!.details?.action).toBe('overwritten');

    const backupPath = claudeResult!.details?.backupPath;
    expect(backupPath).toBeDefined();
    expect(backupPath!.startsWith('/workspace/_backups/')).toBe(true);

    const stat = await fs.lstat(preexistingPath);
    expect(stat.kind).toBe('symlink');
    const target = await fs.readlink(preexistingPath);
    expect(target).toBe('/workspace/instructions/default.md');

    const backedUp = await fs.lstat(backupPath!);
    expect(backedUp.kind).toBe('file');
  });

  it('all destinations returned for the global-instruction entity are absolute', async () => {
    const { adapterManager, entityRepository } = await setup();
    const entity = globalInstruction();
    await entityRepository.save(entity);

    const syncReport = await adapterManager.syncEntity({ entity });

    const allDestinations = syncReport
      .map((r) => r.destination)
      .filter((d): d is string => d !== null);

    expect(allDestinations.length).toBeGreaterThan(0);
    for (const d of allDestinations) {
      expect(isAbsolute(d)).toBe(true);
    }
  });
});
