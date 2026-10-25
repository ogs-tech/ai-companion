import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WorkspaceModelMigration } from '../../../../src/main/application/services/workspace-model-migration.js';
import { NodeFsAdapter } from '../../../../src/main/infrastructure/filesystem/node-fs-adapter.js';
import { FsWorkspaceRegistry } from '../../../../src/main/infrastructure/workspace/fs-workspace-registry.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { parseMarkdown } from '../../../../src/main/application/markdown/frontmatter.js';
import type { WorkspaceRegistryFile } from '../../../../src/shared/workspace.js';

let root: string;
let home: string;
let global: string;

beforeEach(async () => {
  // realpath: macOS tmpdir is behind a /var → /private/var symlink, and the
  // migration stores real paths.
  root = await realpath(await mkdtemp(join(tmpdir(), 'ws-migration-')));
  home = join(root, 'home');
  global = join(home, '.ai-companion');
  await mkdir(global, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const dataDir = (folder: string): string => join(folder, '.ai-companion');

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function folder(name: string): Promise<string> {
  const path = join(root, 'repos', name);
  await mkdir(path, { recursive: true });
  return path;
}

interface LegacyWorkspace {
  id: string;
  name: string;
  rootPath: string;
  isDefault: boolean;
}

async function legacyRegistry(workspaces: LegacyWorkspace[] = [], activeWorkspaceId = 'default'): Promise<void> {
  const all = [{ id: 'default', name: 'Default', rootPath: home, isDefault: true }, ...workspaces];
  await write(
    join(global, 'workspaces.json'),
    JSON.stringify({ workspaces: all.map((w) => ({ ...w, createdAt: '2026-01-01T00:00:00.000Z' })), activeWorkspaceId }),
  );
}

async function projects(inDataDir: string, list: Array<{ id: string; name: string; path: string }>): Promise<void> {
  await write(
    join(inDataDir, 'projects.json'),
    JSON.stringify({ projects: list.map((p) => ({ ...p, createdAt: '2026-02-02T00:00:00.000Z' })) }),
  );
}

function skillFile(name: string, scope: string, scopeId?: string): string {
  const scopeIdLine = scopeId === undefined ? '' : `scopeId: ${scopeId}\n`;
  return `---\nname: ${name}\ntype: skill\ndescription: d\nscopes:\n  - ${scope}\n${scopeIdLine}version: 0.1.0\n---\nbody of ${name}\n`;
}

async function skill(inDataDir: string, name: string, scope: string, scopeId?: string): Promise<void> {
  await write(join(inDataDir, 'skills', name, 'SKILL.md'), skillFile(name, scope, scopeId));
}

async function agent(inDataDir: string, name: string, scope: string, scopeId?: string): Promise<void> {
  const scopeIdLine = scopeId === undefined ? '' : `scopeId: ${scopeId}\n`;
  await write(
    join(inDataDir, 'agents', `${name}.md`),
    `---\nname: ${name}\ntype: agent\ndescription: d\nscopes:\n  - ${scope}\n${scopeIdLine}version: 0.1.0\n---\nprompt\n`,
  );
}

async function instruction(inDataDir: string, slug: string, meta: Record<string, unknown>): Promise<void> {
  const dir = join(inDataDir, 'instructions', 'project', slug);
  await write(join(dir, 'INSTRUCTION.md'), `# ${slug}\n`);
  await write(join(dir, 'meta.json'), JSON.stringify({ description: '', version: '0.1.0', createdAt: '', updatedAt: '', ...meta }));
}

async function frontmatter(path: string): Promise<Record<string, unknown>> {
  return parseMarkdown<Record<string, unknown>>(await readFile(path, 'utf8')).frontmatter;
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

async function registry(): Promise<WorkspaceRegistryFile> {
  return (await json(join(global, 'workspaces.json'))) as unknown as WorkspaceRegistryFile;
}

function migration(fs = new NodeFsAdapter()) {
  const bootstrap = {
    create: vi.fn(async (dir: string) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.md'), '# managed\n', 'utf8');
    }),
  };
  const run = new WorkspaceModelMigration({
    fs,
    registry: new FsWorkspaceRegistry(join(global, 'workspaces.json')),
    bootstrap,
    clock: new FixedClock(new Date('2026-10-12T12:00:00.000Z')),
    homedir: home,
    globalDataDir: global,
  });
  return { run: () => run.run(), bootstrap };
}

describe('WorkspaceModelMigration', () => {
  it('writes an empty v2 registry on a fresh install', async () => {
    const result = await migration().run();
    expect(result.migrated).toBe(false);
    expect(await registry()).toEqual({ schemaVersion: 2, workspaces: [], activeWorkspaceId: null });
  });

  it('turns a project into a workspace that keeps its id and name, and lands at Início', async () => {
    const acme = await folder('acme');
    await legacyRegistry();
    await projects(global, [{ id: 'p-acme', name: 'Acme', path: acme }]);

    const result = await migration().run();

    expect(result.migrated).toBe(true);
    const file = await registry();
    expect(file.schemaVersion).toBe(2);
    expect(file.activeWorkspaceId).toBeNull();
    expect(file.workspaces).toEqual([{ id: 'p-acme', name: 'Acme', rootPath: acme, createdAt: '2026-02-02T00:00:00.000Z' }]);
    expect(await exists(join(global, 'projects.json'))).toBe(false);
    expect(await exists(join(result.backupDir ?? '', global.slice(1), 'projects.json'))).toBe(true);
  });

  it('keeps an existing workspace (without isDefault) and stays on it when it was active', async () => {
    const bravo = await folder('bravo');
    await legacyRegistry([{ id: 'w-bravo', name: 'Bravo', rootPath: bravo, isDefault: false }], 'w-bravo');

    await migration().run();

    const file = await registry();
    expect(file.workspaces).toEqual([{ id: 'w-bravo', name: 'Bravo', rootPath: bravo, createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect(file.activeWorkspaceId).toBe('w-bravo');
  });

  it('dedupes by real path: two projects on one folder, and a project on an existing workspace root', async () => {
    const acme = await folder('acme');
    const bravo = await folder('bravo');
    await symlink(acme, join(root, 'acme-link'));
    await legacyRegistry([{ id: 'w-bravo', name: 'Bravo', rootPath: bravo, isDefault: false }]);
    await projects(global, [
      { id: 'p-1', name: 'Acme', path: acme },
      { id: 'p-2', name: 'Acme via link', path: join(root, 'acme-link') },
    ]);
    await projects(dataDir(bravo), [{ id: 'p-root', name: 'Bravo root', path: `${bravo}/` }]);
    await skill(global, 'linked', 'project', 'p-2');
    await skill(dataDir(bravo), 'rooted', 'project', 'p-root');

    await migration().run();

    const file = await registry();
    expect(file.workspaces.map((w) => w.id).sort()).toEqual(['p-1', 'w-bravo']);
    expect((await frontmatter(join(dataDir(acme), 'skills', 'linked', 'SKILL.md')))['scopeId']).toBe('p-1');
    expect(await frontmatter(join(dataDir(bravo), 'skills', 'rooted', 'SKILL.md'))).toMatchObject({
      scopes: ['workspace'],
      scopeId: 'w-bravo',
    });
  });

  it('drops a project at the home folder — its entities become Global', async () => {
    await legacyRegistry();
    await projects(global, [{ id: 'p-home', name: 'Home', path: home }]);
    await skill(global, 'homey', 'project', 'p-home');

    await migration().run();

    expect((await registry()).workspaces).toEqual([]);
    const fm = await frontmatter(join(global, 'skills', 'homey', 'SKILL.md'));
    expect(fm['scopes']).toEqual(['personal']);
    expect(fm['scopeId']).toBeUndefined();
  });

  it('moves project-scoped skills and agents into their workspace, rescoped', async () => {
    const acme = await folder('acme');
    await legacyRegistry();
    await projects(global, [{ id: 'p-acme', name: 'Acme', path: acme }]);
    await skill(global, 'deploy', 'project', 'p-acme');
    await agent(global, 'reviewer', 'project', 'p-acme');

    const result = await migration().run();

    expect(await exists(join(global, 'skills', 'deploy'))).toBe(false);
    expect(await exists(join(global, 'agents', 'reviewer.md'))).toBe(false);
    expect(await frontmatter(join(dataDir(acme), 'skills', 'deploy', 'SKILL.md'))).toMatchObject({
      scopes: ['workspace'],
      scopeId: 'p-acme',
    });
    expect(await frontmatter(join(dataDir(acme), 'agents', 'reviewer.md'))).toMatchObject({
      scopes: ['workspace'],
      scopeId: 'p-acme',
    });
    expect(await readFile(join(dataDir(acme), 'index.md'), 'utf8')).toBe('# managed\n');
    expect(result.touchedWorkspaceIds).toEqual(['p-acme']);
  });

  it('moves project instructions, renaming a slug that collides in the target', async () => {
    const acme = await folder('acme');
    await legacyRegistry([{ id: 'w-acme', name: 'Acme', rootPath: acme, isDefault: false }]);
    await projects(global, [{ id: 'p-acme', name: 'Acme', path: acme }]);
    await instruction(global, 'acme', { scope: 'project', scopeId: 'p-acme' });
    await instruction(dataDir(acme), 'acme', { scope: 'workspace', scopeId: 'w-acme' });

    const result = await migration().run();

    expect(await exists(join(global, 'instructions', 'project', 'acme'))).toBe(false);
    expect(await json(join(dataDir(acme), 'instructions', 'project', 'acme', 'meta.json'))).toMatchObject({
      scope: 'workspace',
      scopeId: 'w-acme',
    });
    expect(await json(join(dataDir(acme), 'instructions', 'project', 'acme-2', 'meta.json'))).toMatchObject({
      scope: 'workspace',
      scopeId: 'w-acme',
    });
    expect(result.log.some((entry) => entry.message.includes("'acme' to 'acme-2'"))).toBe(true);
  });

  it('rescopes a legacy repoPath-only instruction by its folder, creating the workspace', async () => {
    const legacy = await folder('legacy');
    await legacyRegistry();
    await instruction(global, 'legacy', { repoPath: legacy });

    await migration().run();

    const [created] = (await registry()).workspaces;
    expect(created).toMatchObject({ name: 'legacy', rootPath: legacy });
    const meta = await json(join(dataDir(legacy), 'instructions', 'project', 'legacy', 'meta.json'));
    expect(meta).toMatchObject({ scope: 'workspace', scopeId: created?.id });
    expect(meta['repoPath']).toBeUndefined();
  });

  it("turns the old default workspace's workspace-scoped entities into Global ones", async () => {
    await legacyRegistry();
    await skill(global, 'everywhere', 'workspace', 'default');

    await migration().run();

    const fm = await frontmatter(join(global, 'skills', 'everywhere', 'SKILL.md'));
    expect(fm['scopes']).toEqual(['personal']);
    expect(fm['scopeId']).toBeUndefined();
  });

  it('moves stray personal entities to Global; on a name collision Global wins and the stray is logged', async () => {
    const bravo = await folder('bravo');
    await legacyRegistry([{ id: 'w-bravo', name: 'Bravo', rootPath: bravo, isDefault: false }]);
    await skill(global, 'shared', 'personal');
    await write(join(global, 'skills', 'shared', 'SKILL.md'), skillFile('shared', 'personal').replace('body of shared', 'global body'));
    await skill(dataDir(bravo), 'shared', 'personal');
    await skill(dataDir(bravo), 'unique', 'personal');

    const result = await migration().run();

    expect(await readFile(join(global, 'skills', 'shared', 'SKILL.md'), 'utf8')).toContain('global body');
    expect(await exists(join(global, 'skills', 'unique', 'SKILL.md'))).toBe(true);
    expect(await exists(join(dataDir(bravo), 'skills'))).toBe(true);
    expect(await readdir(join(dataDir(bravo), 'skills'))).toEqual([]);
    expect(result.log.some((entry) => entry.step === '6' && entry.message.includes('collision'))).toBe(true);
    expect(await exists(join(result.backupDir ?? '', dataDir(bravo).slice(1), 'skills', 'shared', 'SKILL.md'))).toBe(true);
  });

  it('moves an entity whose project is gone to the backup and logs it', async () => {
    await legacyRegistry();
    await projects(global, []);
    await skill(global, 'orphan', 'project', 'p-gone');

    const result = await migration().run();

    expect(await exists(join(global, 'skills', 'orphan'))).toBe(false);
    expect(await exists(join(result.backupDir ?? '', global.slice(1), 'skills', 'orphan', 'SKILL.md'))).toBe(true);
    expect(result.log.some((entry) => entry.message.includes('p-gone'))).toBe(true);
    expect(await json(join(result.backupDir ?? '', 'log.json'))).toEqual(result.log);
  });

  it('skips a corrupt projects.json and carries on', async () => {
    const bravo = await folder('bravo');
    await legacyRegistry([{ id: 'w-bravo', name: 'Bravo', rootPath: bravo, isDefault: false }]);
    await write(join(dataDir(bravo), 'projects.json'), '{not json');

    const result = await migration().run();

    expect((await registry()).schemaVersion).toBe(2);
    expect(result.log.some((entry) => entry.message.includes('unreadable projects.json'))).toBe(true);
  });

  it('removes a project index marker symlink into the parent data dir, leaving a real one alone', async () => {
    const acme = await folder('acme');
    const bravo = await folder('bravo');
    await legacyRegistry();
    await projects(global, [
      { id: 'p-acme', name: 'Acme', path: acme },
      { id: 'p-bravo', name: 'Bravo', path: bravo },
    ]);
    await write(join(global, 'index.md'), '# canonical\n');
    await mkdir(dataDir(acme), { recursive: true });
    await symlink(join(global, 'index.md'), join(dataDir(acme), 'index.md'));
    await write(join(dataDir(bravo), 'index.md'), '# real file\n');

    await migration().run();

    expect((await lstat(join(dataDir(acme), 'index.md')).catch(() => null))?.isSymbolicLink() ?? false).toBe(false);
    expect(await readFile(join(dataDir(bravo), 'index.md'), 'utf8')).toBe('# real file\n');
  });

  it('a failure mid-way leaves the registry unmigrated, and a re-run converges', async () => {
    const acme = await folder('acme');
    const bravo = await folder('bravo');
    await legacyRegistry();
    await projects(global, [
      { id: 'p-acme', name: 'Acme', path: acme },
      { id: 'p-bravo', name: 'Bravo', path: bravo },
    ]);
    await skill(global, 'first', 'project', 'p-acme');
    await skill(global, 'second', 'project', 'p-bravo');

    const flaky = new NodeFsAdapter();
    const rename = flaky.rename.bind(flaky);
    let calls = 0;
    flaky.rename = async (from, to) => {
      calls += 1;
      if (calls === 2) throw new Error('disk hiccup');
      return rename(from, to);
    };
    await expect(migration(flaky).run()).rejects.toMatchObject({ kind: 'io' });
    expect((await registry()).schemaVersion).toBeUndefined();

    await migration().run();

    const file = await registry();
    expect(file.schemaVersion).toBe(2);
    expect(file.workspaces.map((w) => w.id).sort()).toEqual(['p-acme', 'p-bravo']);
    expect((await frontmatter(join(dataDir(acme), 'skills', 'first', 'SKILL.md')))['scopeId']).toBe('p-acme');
    expect((await frontmatter(join(dataDir(bravo), 'skills', 'second', 'SKILL.md')))['scopeId']).toBe('p-bravo');
  });

  it('a second run is a no-op', async () => {
    const acme = await folder('acme');
    await legacyRegistry();
    await projects(global, [{ id: 'p-acme', name: 'Acme', path: acme }]);
    await migration().run();
    const before = await registry();

    const second = await migration().run();

    expect(second).toEqual({ migrated: false, touchedWorkspaceIds: [], log: [] });
    expect(await registry()).toEqual(before);
  });
});
