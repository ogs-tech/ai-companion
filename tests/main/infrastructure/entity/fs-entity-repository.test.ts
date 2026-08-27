import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsEntityRepository } from '../../../../src/main/infrastructure/entity/fs-entity-repository.js';
import { WORKSPACE_SOURCE, type Skill, type Instruction } from '../../../../src/shared/entity.js';

const meta = { version: '0.1.0', createdAt: '2026-04-26T10:00:00.000Z', updatedAt: '2026-04-26T10:00:00.000Z' };

let ws: string;
beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'sde-fs-entity-')); });
afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

describe('FsEntityRepository — skill', () => {
  it('writes SKILL.md under skills/<name>/ and reads it back', async () => {
    const repo = new FsEntityRepository(ws);
    const skill: Skill = {
      urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd', scopes: ['personal'],
      metadata: meta, source: WORKSPACE_SOURCE, content: '# Demo\n',
    };
    await repo.save(skill);
    const onDisk = await readFile(join(ws, 'skills', 'demo', 'SKILL.md'), 'utf8');
    expect(onDisk).toContain('name: demo');
    const back = (await repo.get('urn:skill:demo')) as Skill;
    expect(back.content.trim()).toBe('# Demo');
  });

  it('round-trips scopes/scopeId for a project-scoped skill through disk', async () => {
    const repo = new FsEntityRepository(ws);
    const skill: Skill = {
      urn: 'urn:skill:acme', kind: 'skill', name: 'acme', description: 'd', scopes: ['project'],
      scopeId: 'proj-1', metadata: meta, source: WORKSPACE_SOURCE, content: '# Acme\n',
    };
    await repo.save(skill);
    const back = (await repo.get('urn:skill:acme')) as Skill;
    expect(back.scopes).toEqual(['project']);
    expect(back.scopeId).toBe('proj-1');
  });
});

describe('FsEntityRepository — instruction', () => {
  it('stores frontmatter-free markdown at instructions/<name>.md', async () => {
    const repo = new FsEntityRepository(ws);
    const ins: Instruction = {
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default', description: '',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: '# Hi\n',
    };
    await repo.save(ins);
    const onDisk = await readFile(join(ws, 'instructions', 'default.md'), 'utf8');
    expect(onDisk.startsWith('---')).toBe(false);
    expect(onDisk).toContain('# Hi');
  });

  it('falls back to legacy global-instructions/default.md on get', async () => {
    await mkdir(join(ws, 'global-instructions'), { recursive: true });
    await writeFile(join(ws, 'global-instructions', 'default.md'),
      ['---', 'name: default', 'type: global-instruction', '---', '# Legacy body', ''].join('\n'), 'utf8');
    const repo = new FsEntityRepository(ws);
    const ins = (await repo.get('urn:instruction:default')) as Instruction;
    expect(ins.content.trim()).toBe('# Legacy body');
  });

  it('exists() returns true when only the legacy global-instructions file exists', async () => {
    await mkdir(join(ws, 'global-instructions'), { recursive: true });
    await writeFile(join(ws, 'global-instructions', 'default.md'), '# Legacy body\n', 'utf8');
    const repo = new FsEntityRepository(ws);
    expect(await repo.exists('urn:instruction:default')).toBe(true);
  });
});

describe('FsEntityRepository — list & delete', () => {
  it('lists skills and agents, and get on a missing urn rejects not_found', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save({ urn: 'urn:skill:a', kind: 'skill', name: 'a', description: 'd',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: 'b' } as Skill);
    expect((await repo.list({ kind: 'skill' })).map((e) => e.name)).toEqual(['a']);
    await repo.delete('urn:skill:a');
    await expect(repo.get('urn:skill:a')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('rejects delete of a missing skill with not_found', async () => {
    const repo = new FsEntityRepository(ws);
    await expect(repo.delete('urn:skill:missing')).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('FsEntityRepository — project instruction storage', () => {
  const projectInstruction = (name = 'acme', scopeId = 'proj-1'): Instruction => ({
    urn: `urn:instruction:${name}`,
    kind: 'instruction',
    name,
    description: `${name} rules`,
    scopes: ['project'],
    scopeId,
    metadata: meta,
    source: WORKSPACE_SOURCE,
    content: `# ${name}\n\nProject-only rules.\n`,
  });

  it('save writes body under project/<slug>/INSTRUCTION.md and meta.json with scope+scopeId', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save(projectInstruction('acme', 'proj-1'));

    const body = await readFile(join(ws, 'instructions', 'project', 'acme', 'INSTRUCTION.md'), 'utf8');
    expect(body.startsWith('---')).toBe(false);
    expect(body).toContain('Project-only rules.');

    const metaJson = JSON.parse(
      await readFile(join(ws, 'instructions', 'project', 'acme', 'meta.json'), 'utf8'),
    );
    expect(metaJson).toMatchObject({
      description: 'acme rules',
      version: '0.1.0',
      scope: 'project',
      scopeId: 'proj-1',
    });
    expect(metaJson.repoPath).toBeUndefined();
  });

  it('get rehydrates scopeId, description and version from meta.json', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save(projectInstruction('bravo', 'proj-2'));
    const back = (await repo.get('urn:instruction:bravo')) as Instruction;
    expect(back.name).toBe('bravo');
    expect(back.scopeId).toBe('proj-2');
    expect(back.scopes).toEqual(['project']);
    expect(back.description).toBe('bravo rules');
    expect(back.metadata.version).toBe('0.1.0');
    expect(back.content).toContain('Project-only rules.');
  });

  it('get surfaces a legacy repoPath-only meta.json as legacyRepoPath with no scopeId', async () => {
    const dir = join(ws, 'instructions', 'project', 'legacy-acme');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'INSTRUCTION.md'), '# Legacy project rules\n', 'utf8');
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({
        description: 'legacy rules', version: '0.1.0', createdAt: '', updatedAt: '',
        repoPath: '/repos/legacy-acme',
      }, null, 2)}\n`,
      'utf8',
    );
    const repo = new FsEntityRepository(ws);
    const back = (await repo.get('urn:instruction:legacy-acme')) as Instruction;
    expect(back.scopeId).toBeUndefined();
    expect(back.legacyRepoPath).toBe('/repos/legacy-acme');
  });

  it('get rejects with not_found when the body is present but meta.json is missing', async () => {
    await mkdir(join(ws, 'instructions', 'project', 'ghost'), { recursive: true });
    await writeFile(join(ws, 'instructions', 'project', 'ghost', 'INSTRUCTION.md'), '# body\n', 'utf8');
    const repo = new FsEntityRepository(ws);
    await expect(repo.get('urn:instruction:ghost')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('get rejects with validation when meta.json is malformed', async () => {
    await mkdir(join(ws, 'instructions', 'project', 'malformed'), { recursive: true });
    await writeFile(
      join(ws, 'instructions', 'project', 'malformed', 'INSTRUCTION.md'),
      '# body\n',
      'utf8',
    );
    await writeFile(
      join(ws, 'instructions', 'project', 'malformed', 'meta.json'),
      '{not json',
      'utf8',
    );
    const repo = new FsEntityRepository(ws);
    await expect(repo.get('urn:instruction:malformed')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('list returns personal singleton followed by every project instruction (skipping malformed ones)', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save({
      urn: 'urn:instruction:default', kind: 'instruction', name: 'default', description: '',
      scopes: ['personal'], metadata: meta, source: WORKSPACE_SOURCE, content: '# personal\n',
    } as Instruction);
    await repo.save(projectInstruction('acme', '/repos/acme'));
    await repo.save(projectInstruction('bravo', '/repos/bravo'));

    // Malformed project instruction (body but no meta.json) must be tolerated:
    // list should skip it instead of throwing.
    await mkdir(join(ws, 'instructions', 'project', 'ghost'), { recursive: true });
    await writeFile(join(ws, 'instructions', 'project', 'ghost', 'INSTRUCTION.md'), '# ghost\n', 'utf8');

    const list = await repo.list({ kind: 'instruction' });
    const names = list.map((i) => i.name).sort();
    expect(names).toEqual(['acme', 'bravo', 'default']);
  });

  it('delete removes the entire project slug directory', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save(projectInstruction('acme', '/repos/acme'));
    await repo.delete('urn:instruction:acme');
    await expect(repo.get('urn:instruction:acme')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(repo.exists('urn:instruction:acme')).resolves.toBe(false);
  });

  it('delete of a missing project instruction rejects with not_found', async () => {
    const repo = new FsEntityRepository(ws);
    await expect(repo.delete('urn:instruction:ghost')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('exists returns true for a saved project instruction and false otherwise', async () => {
    const repo = new FsEntityRepository(ws);
    await repo.save(projectInstruction('acme', '/repos/acme'));
    expect(await repo.exists('urn:instruction:acme')).toBe(true);
    expect(await repo.exists('urn:instruction:ghost')).toBe(false);
  });
});
