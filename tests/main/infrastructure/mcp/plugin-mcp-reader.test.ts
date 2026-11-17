import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginMcpReader } from '../../../../src/main/infrastructure/mcp/plugin-mcp-reader.js';
import type { PluginRoot } from '../../../../src/main/application/services/plugin-provenance.js';

describe('PluginMcpReader', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'plugin-mcp-reader-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reads each plugin .mcp.json into read-only servers', async () => {
    const dir = path.join(tmp, 'serena');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { serena: { command: 'serena-mcp' } } }),
      'utf8',
    );
    const roots: PluginRoot[] = [{ pluginId: 'serena' as never, dir, provenance: 'claude-code' }];

    const reader = new PluginMcpReader({ listRoots: async () => roots });
    const servers = await reader.read('personal');

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('serena');
    expect(servers[0]?.location).toEqual({ kind: 'plugin', pluginId: 'serena', pluginDir: dir });
    expect(servers[0]?.provenance).toBe('claude-code');
  });

  it('reads a flat .mcp.json (no mcpServers wrapper), as the github and playwright plugins ship it', async () => {
    const dir = path.join(tmp, 'playwright');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, '.mcp.json'),
      JSON.stringify({
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
        $schema: 'ignored',
      }),
      'utf8',
    );
    const reader = new PluginMcpReader({
      listRoots: async () => [{ pluginId: 'playwright' as never, dir, provenance: 'claude-code' }],
    });
    const servers = await reader.read('personal');
    expect(servers.map((s) => s.name)).toEqual(['playwright']);
  });

  it('skips plugins without a .mcp.json', async () => {
    const dir = path.join(tmp, 'noop');
    await mkdir(dir, { recursive: true });
    const reader = new PluginMcpReader({
      listRoots: async () => [{ pluginId: 'noop' as never, dir, provenance: 'workspace-managed' }],
    });
    expect(await reader.read('personal')).toEqual([]);
  });

  it('skips a plugin with malformed .mcp.json but still reads valid plugins', async () => {
    const validDir = path.join(tmp, 'valid-plugin');
    const brokenDir = path.join(tmp, 'broken-plugin');
    await mkdir(validDir, { recursive: true });
    await mkdir(brokenDir, { recursive: true });
    await writeFile(
      path.join(validDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { context7: { command: 'context7-mcp' } } }),
      'utf8',
    );
    await writeFile(path.join(brokenDir, '.mcp.json'), '{ broken', 'utf8');

    const roots: PluginRoot[] = [
      { pluginId: 'valid-plugin' as never, dir: validDir, provenance: 'claude-code' },
      { pluginId: 'broken-plugin' as never, dir: brokenDir, provenance: 'claude-code' },
    ];
    const reader = new PluginMcpReader({ listRoots: async () => roots });
    const servers = await reader.read('personal');

    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('context7');
  });

  it('lists a plugin installed in both registries once, keeping the higher tier', async () => {
    const managedDir = path.join(tmp, 'managed', 'context7');
    const claudeDir = path.join(tmp, 'claude', 'context7');
    for (const dir of [managedDir, claudeDir]) {
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { context7: { command: 'context7-mcp' } } }),
        'utf8',
      );
    }
    const reader = new PluginMcpReader({
      listRoots: async () => [
        { pluginId: 'context7' as never, dir: managedDir, provenance: 'workspace-managed' },
        { pluginId: 'context7' as never, dir: claudeDir, provenance: 'claude-code' },
      ],
    });

    const servers = await reader.read('personal');

    expect(servers).toHaveLength(1);
    expect(servers[0]?.provenance).toBe('workspace-managed');
  });

  it('keeps same-named servers shipped by two different plugins', async () => {
    const dirs = ['a', 'b'].map((id) => path.join(tmp, id));
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, '.mcp.json'), JSON.stringify({ shared: { command: 'x' } }), 'utf8');
    }
    const reader = new PluginMcpReader({
      listRoots: async () =>
        dirs.map((dir, i) => ({ pluginId: (i === 0 ? 'a' : 'b') as never, dir, provenance: 'claude-code' as const })),
    });

    expect((await reader.read('personal')).map((s) => s.pluginId)).toEqual(['a', 'b']);
  });
});
