import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFsAdapter } from '../../../../src/main/infrastructure/filesystem/node-fs-adapter.js';
import { GitIgnoreService } from '../../../../src/main/application/services/git-ignore-service.js';
import type { Settings } from '../../../../src/shared/settings.js';

async function setup(mode: 'off' | 'local' | 'gitignore' | undefined) {
  const root = await mkdtemp(join(tmpdir(), 'gitignore-'));
  await mkdir(join(root, '.git', 'info'), { recursive: true });
  const settings = { load: async () => ({ adapters: {}, ui: { theme: 'system' }, language: 'off', ...(mode ? { git: { ignoreManagedFiles: mode } } : {}) }) as unknown as Settings };
  const service = new GitIgnoreService(new NodeFsAdapter(), settings, { rootPath: root }, {
    managedPaths: async () => [`${root}/.claude/skills/foo`, '/elsewhere/x'],
  });
  return { root, service };
}

describe('GitIgnoreService', () => {
  it('defaults to local: writes only the managed paths to .git/info/exclude', async () => {
    const { root, service } = await setup(undefined);
    await service.apply();
    const exclude = await readFile(join(root, '.git/info/exclude'), 'utf8');
    expect(exclude).toContain('/.ai-companion/');
    expect(exclude).toContain('/.claude/skills/foo');
    expect(exclude).not.toContain('elsewhere');
  });

  it('is idempotent and preserves the user lines', async () => {
    const { root, service } = await setup('local');
    await writeFile(join(root, '.git/info/exclude'), 'mine\n');
    await service.apply();
    const once = await readFile(join(root, '.git/info/exclude'), 'utf8');
    await service.apply();
    expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toBe(once);
    expect(once.startsWith('mine\n')).toBe(true);
  });

  it('off removes the block and keeps the user lines', async () => {
    const { root, service } = await setup('local');
    await writeFile(join(root, '.git/info/exclude'), 'mine\n');
    await service.apply();
    const off = new GitIgnoreService(new NodeFsAdapter(), { load: async () => ({ git: { ignoreManagedFiles: 'off' } }) as unknown as Settings }, { rootPath: root }, { managedPaths: async () => [] });
    await off.apply();
    expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).toBe('mine\n');
  });

  it('gitignore mode writes .gitignore and clears info/exclude', async () => {
    const { root, service } = await setup('local');
    await service.apply();
    const g = new GitIgnoreService(new NodeFsAdapter(), { load: async () => ({ git: { ignoreManagedFiles: 'gitignore' } }) as unknown as Settings }, { rootPath: root }, { managedPaths: async () => [] });
    await g.apply();
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toContain('/.ai-companion/');
    expect(await readFile(join(root, '.git/info/exclude'), 'utf8')).not.toContain('ai-companion');
  });

  it('does nothing outside a git repo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nogit-'));
    const s = new GitIgnoreService(new NodeFsAdapter(), { load: async () => null }, { rootPath: root }, { managedPaths: async () => [] });
    await s.apply();
    await expect(readFile(join(root, '.gitignore'), 'utf8')).rejects.toThrow();
  });
});
