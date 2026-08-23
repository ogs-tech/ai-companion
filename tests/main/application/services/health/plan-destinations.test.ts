import { describe, expect, it } from 'vitest';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import type { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import type { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import type { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import type { Adapter } from '../../../../../src/main/application/ports/adapter.js';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FakeAdapter } from '../../../../../src/main/application/services/__fixtures__/fake-adapter.js';
import { getDefaults, type Settings } from '../../../../../src/shared/settings.js';
import { WORKSPACE_SOURCE, type Instruction, type Skill } from '../../../../../src/shared/entity.js';

const FROZEN = '2026-06-05T10:00:00.000Z';

const skill = (name: string): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill',
  name,
  description: name,
  scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: FROZEN, updatedAt: FROZEN },
  source: WORKSPACE_SOURCE,
  content: 'body',
});

const instruction = (): Instruction => ({
  urn: 'urn:instruction:default',
  kind: 'instruction',
  name: 'default',
  description: '',
  scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: FROZEN, updatedAt: FROZEN },
  source: WORKSPACE_SOURCE,
  content: 'body',
});

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

const settingsWith = (over: Partial<Settings> = {}): Settings => ({
  ...getDefaults(),
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },
  ...over,
});

const setup = async () => {
  const entityRepository = new InMemoryEntityRepository();
  await entityRepository.save(skill('alpha'));

  const settings = settingsWith();
  const settingsService = {
    load: () => Promise.resolve(settings),
    getDefaults: () => getDefaults(),
  } as unknown as SettingsService;

  const adapter: Adapter = new FakeAdapter('claude', '/home/.claude/skills/alpha');

  const manager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager: {} as SymlinkManager,
    fileMaterializer: {} as FileMaterializer,
    adapters: new Map<string, Adapter>([['claude', adapter]]),
    workspacePath: '/ws',
  });
  return { manager };
};

const setupInstruction = async () => {
  const entityRepository = new InMemoryEntityRepository();
  await entityRepository.save(instruction());

  const settings = settingsWith();
  const settingsService = {
    load: () => Promise.resolve(settings),
    getDefaults: () => getDefaults(),
  } as unknown as SettingsService;

  const adapter: Adapter = new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps });

  const manager = new AdapterManager({
    settingsService,
    entityRepository,
    symlinkManager: {} as SymlinkManager,
    fileMaterializer: {} as FileMaterializer,
    adapters: new Map<string, Adapter>([['claude', adapter]]),
    workspacePath: '/ws',
  });
  return { manager };
};

describe('AdapterManager.planDestinations', () => {
  it('resolves expected (source, destination) pairs for enabled adapters', async () => {
    const { manager } = await setup();
    const plan = await manager.planDestinations();

    expect(plan).toEqual([
      {
        adapterId: 'claude',
        source: '/ws/skills/alpha',
        destination: '/home/.claude/skills/alpha',
        scope: 'personal',
      },
    ]);
  });

  it('plans BOTH CLAUDE.md and AGENTS.md for a single instruction (2-destination fan-out)', async () => {
    const { manager } = await setupInstruction();
    const plan = await manager.planDestinations();

    // The one instruction entity fans out to two planned symlinks, both sourced
    // from the single instruction file in the workspace.
    expect(plan).toHaveLength(2);
    expect(plan.every((p) => p.source === '/ws/instructions/default.md')).toBe(true);
    const destinations = plan.map((p) => p.destination).sort();
    expect(destinations).toEqual(['/home/u/.claude/CLAUDE.md', '/home/u/AGENTS.md']);
  });
});
