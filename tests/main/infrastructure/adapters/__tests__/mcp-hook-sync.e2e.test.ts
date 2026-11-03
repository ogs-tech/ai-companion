import { describe, expect, it } from 'vitest';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { MergeMaterializer } from '../../../../../src/main/application/services/merge-materializer.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { CursorAdapter } from '../../../../../src/main/infrastructure/adapters/cursor-adapter.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { Adapter } from '../../../../../src/main/application/ports/adapter.js';
import type { HookEntity, McpEntity } from '../../../../../src/shared/entity.js';
import type { Settings } from '../../../../../src/shared/settings.js';

const meta = { version: '1.0.0', createdAt: '', updatedAt: '' };
const base = { description: '', scopes: ['personal'] as ['personal'], metadata: meta, source: { kind: 'workspace' as const } };
const mcp: McpEntity = { ...base, urn: 'urn:mcp:gh', kind: 'mcp', name: 'gh', def: { command: 'gh-mcp', type: 'stdio' }, enabled: true };
const hookOk: HookEntity = { ...base, urn: 'urn:hook:a', kind: 'hook', name: 'a', event: 'PreToolUse', matcher: 'Bash', handler: { type: 'command', command: './a.sh' }, enabled: true };
const hookSkipped: HookEntity = { ...base, urn: 'urn:hook:n', kind: 'hook', name: 'n', event: 'Notification', handler: { type: 'command', command: './n.sh' }, enabled: true };

const settings: Settings = { adapters: { claude: { enabled: true }, cursor: { enabled: true } }, ui: { theme: 'system' }, language: 'off' };
const deps = { workspaceService: { get: async () => { throw new Error('unused'); } } };

async function setup(entities: Array<McpEntity | HookEntity>) {
  const fs = new InMemoryFileSystem();
  const clock = new FixedClock(new Date('2026-11-02T10:00:00.000Z'));
  const repo = new InMemorySettingsRepository();
  await repo.save(settings);
  const entityRepository = new InMemoryEntityRepository();
  for (const e of entities) await entityRepository.save(e);
  const manager = new AdapterManager({
    settingsService: new SettingsService(repo),
    entityRepository,
    symlinkManager: new SymlinkManager(fs, clock, '/workspace'),
    fileMaterializer: new FileMaterializer(fs, clock, '/workspace'),
    mergeMaterializer: new MergeMaterializer(fs, clock, '/workspace'),
    entityDataDir: () => '/workspace',
    adapters: new Map<string, Adapter>([
      ['claude', new ClaudeAdapter({ homedir: '/home/u', ...deps })],
      ['cursor', new CursorAdapter({ homedir: '/home/u', ...deps })],
    ]),
  });
  return { fs, manager };
}

describe('mcp / hook propagation to every enabled harness', () => {
  it('writes an MCP server to Claude and Cursor, dropping Claude-only `type` for Cursor', async () => {
    const { fs, manager } = await setup([mcp]);
    const report = await manager.syncEntity({ entity: mcp });
    expect(report.every((r) => r.status === 'ok')).toBe(true);
    expect(JSON.parse(await fs.readFile('/home/u/.claude.json')).mcpServers.gh).toEqual({ command: 'gh-mcp', type: 'stdio' });
    expect(JSON.parse(await fs.readFile('/home/u/.cursor/mcp.json')).mcpServers.gh).toEqual({ command: 'gh-mcp' });
  });

  it('translates a hook for Cursor and keeps Claude\'s shape', async () => {
    const { fs, manager } = await setup([hookOk]);
    await manager.syncEntity({ entity: hookOk });
    expect(JSON.parse(await fs.readFile('/home/u/.claude/settings.json')).hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: './a.sh' }] },
    ]);
    expect(JSON.parse(await fs.readFile('/home/u/.cursor/hooks.json'))).toEqual({
      version: 1,
      hooks: { preToolUse: [{ command: './a.sh', matcher: 'Shell' }] },
    });
  });

  it('skips an inexpressible hook for Cursor with a warning, still writing Claude', async () => {
    const { fs, manager } = await setup([hookSkipped]);
    const report = await manager.syncEntity({ entity: hookSkipped });
    const skipped = report.find((r) => r.adapter === 'cursor');
    expect(skipped).toMatchObject({ status: 'ok', details: { skipped: 'unsupported-by-target' } });
    expect(await fs.pathExists('/home/u/.cursor/hooks.json')).toBe(false);
    expect(await fs.pathExists('/home/u/.claude/settings.json')).toBe(true);
  });

  it('removes entries from both harnesses when the entity is disabled, keeping unrelated ones', async () => {
    const { fs, manager } = await setup([mcp]);
    fs.createFile('/home/u/.cursor/mcp.json', '{"mcpServers":{"mine":{"command":"x"}}}');
    await manager.syncEntity({ entity: mcp });
    await manager.syncEntity({ entity: { ...mcp, enabled: false } as McpEntity });
    expect(JSON.parse(await fs.readFile('/home/u/.cursor/mcp.json')).mcpServers).toEqual({ mine: { command: 'x' } });
    expect(JSON.parse(await fs.readFile('/home/u/.claude.json')).mcpServers).toEqual({});
  });
});
