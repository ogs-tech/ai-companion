import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile, access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Entity, EntityKind, Instruction, InstructionSidecar } from '../../../shared/entity.js';
import { WORKSPACE_SOURCE, parseUrn } from '../../../shared/entity.js';
import type { EntityListQuery, EntityRepository } from '../../application/ports/entity-repository.js';
import { renderEntityFile, parseEntityFile } from '../../application/entity/entity-serializer.js';
import { DomainError } from '../../domain/errors.js';

type WorkspacePathProvider = string | (() => string) | (() => Promise<string>);

const KINDS: EntityKind[] = ['skill', 'agent', 'instruction'];
const FOLDER: Record<'skill' | 'agent' | 'instruction', string> = {
  skill: 'skills',
  agent: 'agents',
  instruction: 'instructions',
};
const PERSONAL_INSTRUCTION_NAME = 'default';
const PROJECT_INSTRUCTIONS_SUBDIR = 'project';
const PROJECT_INSTRUCTION_BODY_FILE = 'INSTRUCTION.md';
const PROJECT_INSTRUCTION_META_FILE = 'meta.json';

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

function isPersonalName(name: string): boolean {
  return name === PERSONAL_INSTRUCTION_NAME;
}

export class FsEntityRepository implements EntityRepository {
  constructor(private readonly workspace: WorkspacePathProvider) {}

  private async root(): Promise<string> {
    return typeof this.workspace === 'string' ? this.workspace : this.workspace();
  }

  private async personalInstructionFile(): Promise<string> {
    return join(await this.root(), FOLDER.instruction, `${PERSONAL_INSTRUCTION_NAME}.md`);
  }

  private async projectInstructionDir(slug: string): Promise<string> {
    return join(await this.root(), FOLDER.instruction, PROJECT_INSTRUCTIONS_SUBDIR, slug);
  }

  private async projectInstructionPaths(slug: string): Promise<{ dir: string; body: string; meta: string }> {
    const dir = await this.projectInstructionDir(slug);
    return {
      dir,
      body: join(dir, PROJECT_INSTRUCTION_BODY_FILE),
      meta: join(dir, PROJECT_INSTRUCTION_META_FILE),
    };
  }

  private async fileFor(kind: EntityKind, name: string): Promise<string> {
    const root = await this.root();
    if (kind === 'skill') return join(root, FOLDER.skill, name, 'SKILL.md');
    if (kind === 'agent') return join(root, FOLDER.agent, `${name}.md`);
    if (kind === 'instruction') {
      if (isPersonalName(name)) return this.personalInstructionFile();
      return (await this.projectInstructionPaths(name)).body;
    }
    throw new DomainError('validation', `Unsupported entity kind for storage: ${kind}`);
  }

  private async legacyInstructionFile(name: string): Promise<string> {
    return join(await this.root(), 'global-instructions', `${name}.md`);
  }

  async list(query?: EntityListQuery): Promise<Entity[]> {
    const kinds = query?.kind ? [query.kind] : KINDS;
    const out: Entity[] = [];
    for (const kind of kinds) {
      if (kind !== 'skill' && kind !== 'agent' && kind !== 'instruction') continue;
      out.push(...(await this.listByKind(kind)));
    }
    return out;
  }

  private async listByKind(kind: 'skill' | 'agent' | 'instruction'): Promise<Entity[]> {
    if (kind === 'instruction') return this.listInstructions();
    const dir = join(await this.root(), FOLDER[kind]);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const out: Entity[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      let name: string | undefined;
      if (kind === 'skill') {
        if (entry.isDirectory()) name = entry.name;
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        name = entry.name.slice(0, -'.md'.length);
      }
      if (name === undefined) continue;
      const raw = await readFile(await this.fileFor(kind, name), 'utf8');
      out.push(parseEntityFile({ kind, name, raw, source: WORKSPACE_SOURCE }));
    }
    return out;
  }

  private async listInstructions(): Promise<Entity[]> {
    const out: Entity[] = [];
    // Personal singleton (with legacy fallback).
    try {
      const personal = await this.get(`urn:instruction:${PERSONAL_INSTRUCTION_NAME}`);
      out.push(personal);
    } catch (err) {
      if (!(err instanceof DomainError) || err.kind !== 'not_found') throw err;
    }
    // Project instructions live under instructions/project/<slug>/.
    const projectRoot = join(await this.root(), FOLDER.instruction, PROJECT_INSTRUCTIONS_SUBDIR);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(projectRoot, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return out;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const slug = entry.name;
      try {
        const project = await this.get(`urn:instruction:${slug}`);
        out.push(project);
      } catch (err) {
        // Skip malformed project instruction dirs (missing body or meta.json)
        // rather than failing the whole list. Health checks surface these.
        if (err instanceof DomainError && err.kind === 'not_found') continue;
        if (isEnoent(err)) continue;
        throw err;
      }
    }
    return out;
  }

  async get(urn: string): Promise<Entity> {
    const { kind, name } = parseUrn(urn);
    if (kind === 'instruction') return this.getInstruction(name, urn);
    const path = await this.fileFor(kind, name);
    try {
      const raw = await readFile(path, 'utf8');
      return parseEntityFile({ kind, name, raw, source: WORKSPACE_SOURCE });
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Entity not found: ${urn}`);
      throw err;
    }
  }

  private async getInstruction(name: string, urn: string): Promise<Entity> {
    if (isPersonalName(name)) {
      const path = await this.personalInstructionFile();
      try {
        const raw = await readFile(path, 'utf8');
        return parseEntityFile({ kind: 'instruction', name, raw, source: WORKSPACE_SOURCE });
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
      // Legacy fallback: global-instructions/default.md
      try {
        const raw = await readFile(await this.legacyInstructionFile(name), 'utf8');
        return parseEntityFile({ kind: 'instruction', name, raw, source: WORKSPACE_SOURCE });
      } catch (err) {
        if (isEnoent(err)) throw new DomainError('not_found', `Entity not found: ${urn}`);
        throw err;
      }
    }
    // Project instruction: read both body and meta.json.
    const paths = await this.projectInstructionPaths(name);
    let raw: string;
    let sidecarRaw: string;
    try {
      raw = await readFile(paths.body, 'utf8');
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Entity not found: ${urn}`);
      throw err;
    }
    try {
      sidecarRaw = await readFile(paths.meta, 'utf8');
    } catch (err) {
      if (isEnoent(err)) {
        throw new DomainError('not_found', `Project instruction meta.json missing for ${urn}`);
      }
      throw err;
    }
    const sidecar = parseSidecar(sidecarRaw, urn);
    return parseEntityFile({
      kind: 'instruction',
      name,
      raw,
      source: WORKSPACE_SOURCE,
      instructionSidecar: sidecar,
    });
  }

  async save(entity: Entity): Promise<Entity> {
    if (entity.kind === 'instruction') return this.saveInstruction(entity as Instruction);
    const path = await this.fileFor(entity.kind, entity.name);
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    const content = renderEntityFile(entity);
    await writeFileAtomic(path, content);
    return entity;
  }

  private async saveInstruction(entity: Instruction): Promise<Instruction> {
    const isPersonal = entity.scopes[0] === 'personal';
    if (isPersonal) {
      const path = await this.personalInstructionFile();
      await mkdir(dirname(path), { recursive: true });
      const body = renderEntityFile(entity);
      await writeFileAtomic(path, body);
      return entity;
    }
    // Project/workspace: write body + meta.json atomically-per-file.
    const paths = await this.projectInstructionPaths(entity.name);
    await mkdir(paths.dir, { recursive: true });
    const body = renderEntityFile(entity);
    const scope = entity.scopes[0];
    const sidecar: InstructionSidecar = {
      description: entity.description,
      version: entity.metadata.version,
      ...(entity.metadata.tags !== undefined ? { tags: entity.metadata.tags } : {}),
      createdAt: entity.metadata.createdAt,
      updatedAt: entity.metadata.updatedAt,
      ...(scope === 'project' || scope === 'workspace' ? { scope } : {}),
      ...(entity.scopeId !== undefined ? { scopeId: entity.scopeId } : {}),
    };
    await writeFileAtomic(paths.body, body);
    await writeFileAtomic(paths.meta, `${JSON.stringify(sidecar, null, 2)}\n`);
    return entity;
  }

  async delete(urn: string): Promise<void> {
    const { kind, name } = parseUrn(urn);
    const root = await this.root();
    if (kind === 'skill') {
      const dir = join(root, FOLDER.skill, name);
      try {
        await access(dir);
      } catch (err) {
        if (isEnoent(err)) throw new DomainError('not_found', `Entity not found: ${urn}`);
        throw err;
      }
      await rm(dir, { recursive: true, force: true });
      return;
    }
    if (kind === 'instruction') {
      if (isPersonalName(name)) {
        try {
          await unlink(await this.personalInstructionFile());
        } catch (err) {
          if (isEnoent(err)) throw new DomainError('not_found', `Entity not found: ${urn}`);
          throw err;
        }
        return;
      }
      const paths = await this.projectInstructionPaths(name);
      try {
        await access(paths.dir);
      } catch (err) {
        if (isEnoent(err)) throw new DomainError('not_found', `Entity not found: ${urn}`);
        throw err;
      }
      await rm(paths.dir, { recursive: true, force: true });
      return;
    }
    try {
      await unlink(await this.fileFor(kind, name));
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Entity not found: ${urn}`);
      throw err;
    }
  }

  async exists(urn: string): Promise<boolean> {
    const { kind, name } = parseUrn(urn);
    if (kind === 'instruction') {
      if (isPersonalName(name)) {
        try {
          await access(await this.personalInstructionFile());
          return true;
        } catch (err) {
          if (!isEnoent(err)) throw err;
        }
        try {
          await access(await this.legacyInstructionFile(name));
          return true;
        } catch (err) {
          if (!isEnoent(err)) throw err;
          return false;
        }
      }
      const paths = await this.projectInstructionPaths(name);
      try {
        await access(paths.body);
        return true;
      } catch (err) {
        if (!isEnoent(err)) throw err;
        return false;
      }
    }
    try {
      await access(await this.fileFor(kind, name));
      return true;
    } catch (err) {
      if (!isEnoent(err)) throw err;
      return false;
    }
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function parseSidecar(raw: string, urn: string): InstructionSidecar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainError('validation', `Invalid meta.json for ${urn}: not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DomainError('validation', `Invalid meta.json for ${urn}: expected object`);
  }
  const obj = parsed as Record<string, unknown>;
  const str = (key: string, def = ''): string =>
    typeof obj[key] === 'string' ? (obj[key] as string) : def;
  const scopeRaw = obj['scope'];
  const sidecar: InstructionSidecar = {
    description: str('description'),
    version: str('version', '0.0.0'),
    createdAt: str('createdAt'),
    updatedAt: str('updatedAt'),
    ...(Array.isArray(obj['tags']) ? { tags: obj['tags'] as string[] } : {}),
    ...(scopeRaw === 'project' || scopeRaw === 'workspace' ? { scope: scopeRaw } : {}),
    ...(typeof obj['scopeId'] === 'string' ? { scopeId: obj['scopeId'] } : {}),
    ...(typeof obj['repoPath'] === 'string' ? { repoPath: obj['repoPath'] } : {}),
  };
  return sidecar;
}
