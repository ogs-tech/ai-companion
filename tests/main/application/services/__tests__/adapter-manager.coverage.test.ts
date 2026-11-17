import { describe, expect, it } from 'vitest';
import { setupAdapterManager, defaultSettings } from './adapter-manager.helpers.js';
import { buildHandlers, type IpcDeps } from '../../../../../src/main/ipc/registry.js';
import type { Adapter, AdapterDestination } from '../../../../../src/main/application/ports/adapter.js';
import { WORKSPACE_SOURCE, type Entity, type EntityKind } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';

/** Writes every kind to `/home/.<id>/<kind>s/<name>`: symlinks for skills/agents/instructions, a generated file for mcp. */
class KindAdapter implements Adapter {
  constructor(readonly adapterId: string) {}
  resolveEntityDestinations({ entity }: { entity: Entity }): AdapterDestination[] {
    const destination = `/home/.${this.adapterId}/${entity.kind}s/${entity.name}`;
    if (entity.kind === 'mcp') {
      return [{ scope: 'personal', destination, strategy: 'write', content: `# ${entity.name}\n`, ownershipMarker: '# ' }];
    }
    return [{ scope: 'personal', destination, strategy: 'symlink' }];
  }
}

const entity = (kind: EntityKind, name: string, over: Partial<Entity> = {}): Entity =>
  ({
    urn: `urn:${kind}:${name}`, kind, name, description: 'd', scopes: ['personal'], enabled: true,
    metadata: { version: '1.0.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE,
    ...(kind === 'skill' || kind === 'instruction' ? { content: 'x' } : {}),
    ...(kind === 'mcp' ? { def: { command: 'x' } } : {}),
    ...over,
  }) as Entity;

const settings = (over: { claude?: boolean; cursor?: boolean; readsClaudeConfig?: boolean } = {}): Settings => ({
  ...defaultSettings,
  adapters: {
    claude: { enabled: over.claude ?? true },
    cursor: { enabled: over.cursor ?? true, ...(over.readsClaudeConfig !== undefined ? { readsClaudeConfig: over.readsClaudeConfig } : {}) },
    lmstudio: { enabled: false },
  },
});

async function setup(s: Settings = settings(), entities: Entity[] = [entity('skill', 'tdd')]) {
  const ctx = await setupAdapterManager([new KindAdapter('claude'), new KindAdapter('cursor')], s);
  for (const e of entities) {
    await ctx.registerEntity(e);
    ctx.fs.createFile(`/workspace/${e.kind}s/${e.name}/SKILL.md`, '# x');
  }
  const kindOf = async (path: string) => (await ctx.fs.lstat(path)).kind;
  return { ...ctx, kindOf };
}

describe('AdapterManager — coverage', () => {
  it('writes a skill to Claude only while Cursor reads Claude', async () => {
    const { manager, kindOf } = await setup();
    await manager.syncAll({});
    expect(await kindOf('/home/.claude/skills/tdd')).toBe('symlink');
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('none');
    expect((await manager.planDestinations()).map((p) => p.adapterId)).toEqual(['claude']);
    expect(await manager.planCoverage()).toEqual([
      { adapterId: 'cursor', entityUrn: 'urn:skill:tdd', coveredBy: 'claude', destination: '/home/.claude/skills/tdd' },
    ]);
  });

  it('writes MCP and instructions to both channels', async () => {
    const { manager, kindOf, fs } = await setup(settings(), [entity('mcp', 'github'), entity('instruction', 'default')]);
    await manager.syncAll({});
    expect(await kindOf('/home/.claude/instructions/default')).toBe('symlink');
    expect(await kindOf('/home/.cursor/instructions/default')).toBe('symlink');
    expect(await fs.pathExists('/home/.claude/mcps/github')).toBe(true);
    expect(await fs.pathExists('/home/.cursor/mcps/github')).toBe(true);
    expect(await manager.planCoverage()).toEqual([]);
  });

  it('gives Cursor its own copy when readsClaudeConfig is off', async () => {
    const { manager, kindOf } = await setup(settings({ readsClaudeConfig: false }));
    await manager.syncAll({});
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('symlink');
    expect(await manager.planCoverage()).toEqual([]);
  });

  it('gives Cursor its own copy when Claude is off', async () => {
    const { manager, kindOf } = await setup(settings({ claude: false }));
    await manager.syncAll({});
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('symlink');
    expect(await kindOf('/home/.claude/skills/tdd')).toBe('none');
  });

  it('syncEntity follows the same coverage', async () => {
    const { manager, kindOf } = await setup();
    await manager.syncEntity({ entity: entity('skill', 'tdd') });
    expect(await kindOf('/home/.claude/skills/tdd')).toBe('symlink');
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('none');
  });

  it('removes the app-owned covered copy and never a user file (Review Focus 2)', async () => {
    const { manager, kindOf, fs } = await setup(settings(), [entity('skill', 'tdd'), entity('skill', 'mine')]);
    await fs.symlink({ target: '/workspace/skills/tdd', path: '/home/.cursor/skills/tdd' });
    fs.createFile('/home/.cursor/skills/mine', 'my own skill');
    await manager.syncAll({});
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('none');
    expect(await fs.readFile('/home/.cursor/skills/mine')).toBe('my own skill');
  });

  it('a disabled skill has no destinations and no coverage (Review Focus 3)', async () => {
    const { manager, kindOf } = await setup(settings(), [entity('skill', 'tdd', { enabled: false })]);
    await manager.syncAll({});
    expect(await kindOf('/home/.claude/skills/tdd')).toBe('none');
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('none');
    expect(await manager.planDestinations()).toEqual([]);
    expect(await manager.planCoverage()).toEqual([]);
  });

  it('turning Claude off writes Cursor its own copy on the same call (Review Focus 1)', async () => {
    const { manager, settingsService, kindOf } = await setup();
    await manager.syncAll({});
    const handlers = buildHandlers({ adapterManager: manager, settingsService } as unknown as IpcDeps);
    await handlers['adapter.setEnabled']!({ adapterId: 'claude', enabled: false });
    expect(await kindOf('/home/.claude/skills/tdd')).toBe('none');
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('symlink');
  });

  it('adapter.setReadsClaudeConfig persists the switch and resyncs', async () => {
    const { manager, settingsService, kindOf } = await setup();
    await manager.syncAll({});
    const handlers = buildHandlers({ adapterManager: manager, settingsService } as unknown as IpcDeps);
    await handlers['adapter.setReadsClaudeConfig']!({ enabled: false });
    expect((await settingsService.load())?.adapters.cursor.readsClaudeConfig).toBe(false);
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('symlink');
    await handlers['adapter.setReadsClaudeConfig']!({ enabled: true });
    expect(await kindOf('/home/.cursor/skills/tdd')).toBe('none');
  });
});
