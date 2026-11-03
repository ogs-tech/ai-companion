import { describe, expect, it } from 'vitest';
import { MergeMaterializer } from '../../../../src/main/application/services/merge-materializer.js';
import type { MergeTarget } from '../../../../src/main/application/ports/adapter.js';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';

const WS = '/workspace';
const FILE = '/home/u/.cursor/mcp.json';

const make = () => {
  const fs = new InMemoryFileSystem();
  const materializer = new MergeMaterializer(fs, new FixedClock(new Date('2026-11-02T10:00:00.000Z')), WS);
  return { fs, materializer };
};

const server = (name: string, value: unknown): MergeTarget => ({
  shape: 'object-key',
  path: ['mcpServers'],
  key: name,
  value,
});

const hook = (command: string, matcher?: string): MergeTarget => ({
  shape: 'array-item',
  path: ['hooks', 'preToolUse'],
  identity: { matcher, command },
  value: { ...(matcher !== undefined ? { matcher } : {}), command },
});

describe('MergeMaterializer.apply (object-key)', () => {
  it('creates the file and container when missing', async () => {
    const { fs, materializer } = make();
    const result = await materializer.apply({ file: FILE, target: server('gh', { command: 'gh-mcp' }) });
    expect(result.status).toBe('ok');
    expect(JSON.parse(await fs.readFile(FILE))).toEqual({ mcpServers: { gh: { command: 'gh-mcp' } } });
  });

  it('keeps unrelated keys and the file indentation byte-for-byte', async () => {
    const { fs, materializer } = make();
    const original = '{\n    "theme": "dark",\n    "mcpServers": {\n        "mine": {"command": "x"}\n    }\n}\n';
    fs.createFile(FILE, original);
    await materializer.apply({ file: FILE, target: server('gh', { command: 'gh-mcp' }) });
    const after = await fs.readFile(FILE);
    expect(after.startsWith('{\n    "theme": "dark",')).toBe(true);
    expect(after.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(after);
    expect(parsed.theme).toBe('dark');
    expect(parsed.mcpServers.mine).toEqual({ command: 'x' });
    expect(parsed.mcpServers.gh).toEqual({ command: 'gh-mcp' });
  });

  it('is a no-op (no write, no backup) when the entry already matches', async () => {
    const { fs, materializer } = make();
    fs.createFile(FILE, '{"mcpServers":{"gh":{"command":"gh-mcp"}}}');
    const result = await materializer.apply({ file: FILE, target: server('gh', { command: 'gh-mcp' }) });
    expect(result).toEqual({ status: 'ok' });
    expect(await fs.pathExists('/workspace/_backups')).toBe(false);
  });

  it('updates a managed entry without reporting a conflict', async () => {
    const { fs, materializer } = make();
    await materializer.apply({ file: FILE, target: server('gh', { command: 'v1' }) });
    const result = await materializer.apply({ file: FILE, target: server('gh', { command: 'v2' }) });
    expect(result.status).toBe('ok');
    expect(JSON.parse(await fs.readFile(FILE)).mcpServers.gh).toEqual({ command: 'v2' });
  });

  it('treats a same-named unmanaged entry as foreign: backs up and reports conflict', async () => {
    const { fs, materializer } = make();
    fs.createFile(FILE, '{"mcpServers":{"gh":{"command":"hand-written"}}}');
    const result = await materializer.apply({ file: FILE, target: server('gh', { command: 'gh-mcp' }) });
    expect(result.status).toBe('conflict');
    expect(await fs.readFile(result.details!.backupPath!)).toContain('hand-written');
    expect(JSON.parse(await fs.readFile(FILE)).mcpServers.gh).toEqual({ command: 'gh-mcp' });
  });

  it('reports drift when a managed entry was hand-edited, and backs up', async () => {
    const { fs, materializer } = make();
    await materializer.apply({ file: FILE, target: server('gh', { command: 'v1' }) });
    fs.createFile(FILE, '{"mcpServers":{"gh":{"command":"edited"}}}');
    const result = await materializer.apply({ file: FILE, target: server('gh', { command: 'v2' }) });
    expect(result.status).toBe('conflict');
    expect(await fs.readFile(result.details!.backupPath!)).toContain('edited');
  });

  it('refuses invalid JSON and leaves the file untouched', async () => {
    const { fs, materializer } = make();
    fs.createFile(FILE, '{ // comment\n}');
    await expect(materializer.apply({ file: FILE, target: server('gh', { command: 'x' }) })).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(await fs.readFile(FILE)).toBe('{ // comment\n}');
  });

  it('refuses when the container has the wrong type', async () => {
    const { fs, materializer } = make();
    fs.createFile(FILE, '{"mcpServers":[]}');
    await expect(materializer.apply({ file: FILE, target: server('gh', {}) })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('writes the seed only when the file is new', async () => {
    const { fs, materializer } = make();
    await materializer.apply({ file: '/h/hooks.json', target: hook('a.sh'), seed: { version: 1 } });
    expect(JSON.parse(await fs.readFile('/h/hooks.json')).version).toBe(1);
    fs.createFile('/h/other.json', '{"hooks":{}}');
    await materializer.apply({ file: '/h/other.json', target: hook('a.sh'), seed: { version: 1 } });
    expect(JSON.parse(await fs.readFile('/h/other.json')).version).toBeUndefined();
  });
});

describe('MergeMaterializer.apply (array-item)', () => {
  it('appends next to existing items and replaces its own by identity', async () => {
    const { fs, materializer } = make();
    fs.createFile('/h/hooks.json', '{"hooks":{"preToolUse":[{"command":"user.sh"}]}}');
    await materializer.apply({ file: '/h/hooks.json', target: hook('a.sh', 'Shell') });
    const second: MergeTarget = {
      ...hook('a.sh', 'Shell'),
      value: { matcher: 'Shell', command: 'a.sh', timeout: 5 },
    } as MergeTarget;
    await materializer.apply({ file: '/h/hooks.json', target: second });
    const list = JSON.parse(await fs.readFile('/h/hooks.json')).hooks.preToolUse;
    expect(list).toEqual([{ command: 'user.sh' }, { matcher: 'Shell', command: 'a.sh', timeout: 5 }]);
  });
});

describe('MergeMaterializer.remove', () => {
  it('removes only managed entries and drops the emptied array', async () => {
    const { fs, materializer } = make();
    await materializer.apply({ file: '/h/hooks.json', target: hook('a.sh') });
    expect(await materializer.remove({ file: '/h/hooks.json', target: hook('a.sh') })).toEqual({ removed: true });
    expect(JSON.parse(await fs.readFile('/h/hooks.json')).hooks).toEqual({});
  });

  it('never removes an unmanaged entry', async () => {
    const { fs, materializer } = make();
    fs.createFile(FILE, '{"mcpServers":{"gh":{"command":"mine"}}}');
    expect(await materializer.remove({ file: FILE, target: server('gh', { command: 'mine' }) })).toEqual({ removed: false });
    expect(JSON.parse(await fs.readFile(FILE)).mcpServers.gh).toEqual({ command: 'mine' });
  });

  it('is a no-op for a missing file', async () => {
    const { materializer } = make();
    expect(await materializer.remove({ file: FILE, target: server('gh', {}) })).toEqual({ removed: false });
  });
});

describe('MergeMaterializer.validate', () => {
  it('distinguishes missing / ok / drift / foreign', async () => {
    const { fs, materializer } = make();
    const target = server('gh', { command: 'v1' });
    expect(await materializer.validate({ file: FILE, target })).toBe('missing');
    await materializer.apply({ file: FILE, target });
    expect(await materializer.validate({ file: FILE, target })).toBe('ok');
    fs.createFile(FILE, '{"mcpServers":{"gh":{"command":"edited"}}}');
    expect(await materializer.validate({ file: FILE, target })).toBe('drift');
    fs.createFile('/other.json', '{"mcpServers":{"gh":{"command":"edited"}}}');
    expect(await materializer.validate({ file: '/other.json', target })).toBe('foreign');
  });
});
