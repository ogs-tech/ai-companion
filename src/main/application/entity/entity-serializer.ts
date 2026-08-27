import { parseMarkdown, serializeMarkdown } from '../markdown/frontmatter.js';
import { entityUrn } from '../../../shared/entity.js';
import type {
  Agent,
  Entity,
  EntityKind,
  EntityMetadata,
  EntitySource,
  Instruction,
  InstructionSidecar,
  Scope,
  Skill,
} from '../../../shared/entity.js';

const COMMON_KEYS = ['name', 'type', 'description', 'scopes', 'scopeId', 'version', 'tags', 'createdAt', 'updatedAt'];
const SKILL_KEYS = [...COMMON_KEYS, 'disable-model-invocation'];
const AGENT_KEYS = [...COMMON_KEYS, 'model', 'tools', 'deniedTools'];

function extOf(frontmatter: Record<string, unknown>, known: string[]): Record<string, unknown> | undefined {
  const ext: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!known.includes(k)) ext[k] = v;
  }
  return Object.keys(ext).length > 0 ? ext : undefined;
}

function metaFrontmatter(entity: Entity): Record<string, unknown> {
  return {
    name: entity.name,
    type: entity.kind,
    description: entity.description,
    scopes: entity.scopes,
    ...(entity.scopeId !== undefined ? { scopeId: entity.scopeId } : {}),
    version: entity.metadata.version,
    ...(entity.metadata.tags !== undefined ? { tags: entity.metadata.tags } : {}),
    createdAt: entity.metadata.createdAt,
    updatedAt: entity.metadata.updatedAt,
  };
}

function readMetadata(fm: Record<string, unknown>): EntityMetadata {
  return {
    version: typeof fm['version'] === 'string' ? fm['version'] : '0.0.0',
    ...(Array.isArray(fm['tags']) ? { tags: fm['tags'] as string[] } : {}),
    createdAt: typeof fm['createdAt'] === 'string' ? fm['createdAt'] : '',
    updatedAt: typeof fm['updatedAt'] === 'string' ? fm['updatedAt'] : '',
  };
}

function readScopes(fm: Record<string, unknown>): Scope[] {
  const raw = fm['scopes'];
  if (Array.isArray(raw)) {
    return raw.filter((s): s is Scope => s === 'personal' || s === 'project' || s === 'workspace');
  }
  return ['personal'];
}

export function renderEntityFile(entity: Entity): string {
  if (entity.kind === 'instruction') {
    // Frontmatter-free: the body is the whole file. Repo/description/metadata
    // for project instructions lives in a sidecar meta.json (not this file).
    const content = (entity as Instruction).content;
    return content.endsWith('\n') ? content : `${content}\n`;
  }
  if (entity.kind === 'skill') {
    const skill = entity as Skill;
    const fm: Record<string, unknown> = {
      ...metaFrontmatter(skill),
      ...(skill.explicitOnly ? { 'disable-model-invocation': true } : {}),
      ...(skill.ext ?? {}),
    };
    return serializeMarkdown(fm, skill.content);
  }
  if (entity.kind === 'agent') {
    const agent = entity as Agent;
    const fm: Record<string, unknown> = {
      ...metaFrontmatter(agent),
      ...(agent.model !== undefined ? { model: agent.model } : {}),
      ...(agent.tools !== undefined ? { tools: agent.tools } : {}),
      ...(agent.deniedTools !== undefined ? { deniedTools: agent.deniedTools } : {}),
      ...(agent.ext ?? {}),
    };
    return serializeMarkdown(fm, agent.systemPrompt);
  }
  throw new Error(`renderEntityFile: unsupported kind '${entity.kind}'`);
}

export interface ParseEntityFileArgs {
  kind: EntityKind;
  name: string;
  raw: string;
  source: EntitySource;
  /**
   * Only used when `kind === 'instruction'`. When present, carries the
   * repoPath (project only), description, version and timestamps that would
   * otherwise be lost to the frontmatter-free storage. Personal instructions
   * default this to zeroed values when omitted.
   */
  instructionSidecar?: InstructionSidecar;
}

export function parseEntityFile(args: ParseEntityFileArgs): Entity {
  const { kind, name, raw, source, instructionSidecar } = args;
  const { frontmatter, body } = parseMarkdown<Record<string, unknown>>(raw);

  const base = {
    urn: entityUrn(kind, name),
    kind,
    name,
    description: typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '',
    scopes: readScopes(frontmatter),
    ...(typeof frontmatter['scopeId'] === 'string' ? { scopeId: frontmatter['scopeId'] } : {}),
    metadata: readMetadata(frontmatter),
    source,
  };

  if (kind === 'skill') {
    const skillExt = extOf(frontmatter, SKILL_KEYS);
    const skill: Skill = {
      ...base,
      kind: 'skill',
      content: body,
      ...(frontmatter['disable-model-invocation'] === true ? { explicitOnly: true } : {}),
      ...(skillExt !== undefined ? { ext: skillExt } : {}),
    };
    return skill;
  }
  if (kind === 'agent') {
    const agentExt = extOf(frontmatter, AGENT_KEYS);
    const agent: Agent = {
      ...base,
      kind: 'agent',
      systemPrompt: body,
      ...(typeof frontmatter['model'] === 'string' ? { model: frontmatter['model'] } : {}),
      ...(Array.isArray(frontmatter['tools']) ? { tools: frontmatter['tools'] as string[] } : {}),
      ...(Array.isArray(frontmatter['deniedTools']) ? { deniedTools: frontmatter['deniedTools'] as string[] } : {}),
      ...(agentExt !== undefined ? { ext: agentExt } : {}),
    };
    return agent;
  }
  if (kind === 'instruction') {
    // Instruction is frontmatter-free on disk — sidecar carries the rest.
    // parseMarkdown strips any legacy frontmatter and returns just the body.
    const sidecar: InstructionSidecar = instructionSidecar ?? {
      description: '',
      version: '0.0.0',
      createdAt: '',
      updatedAt: '',
    };
    const meta: EntityMetadata = {
      version: sidecar.version,
      ...(sidecar.tags !== undefined ? { tags: sidecar.tags } : {}),
      createdAt: sidecar.createdAt,
      updatedAt: sidecar.updatedAt,
    };
    if (name === 'default') {
      const personal: Instruction = {
        urn: entityUrn('instruction', name),
        kind: 'instruction',
        name: 'default',
        description: sidecar.description,
        scopes: ['personal'],
        metadata: meta,
        source,
        content: body,
      };
      return personal;
    }
    if (sidecar.scopeId !== undefined && sidecar.scopeId !== '') {
      const scoped: Instruction = {
        urn: entityUrn('instruction', name),
        kind: 'instruction',
        name,
        description: sidecar.description,
        scopes: [sidecar.scope ?? 'project'],
        scopeId: sidecar.scopeId,
        metadata: meta,
        source,
        content: body,
      };
      return scoped;
    }
    if (sidecar.repoPath !== undefined && sidecar.repoPath !== '') {
      // Pre-migration shape: no scopeId persisted yet. InstructionService
      // lazily finds-or-creates a matching Project and re-saves with a real
      // scopeId — see InstructionService.get/.list.
      const legacy: Instruction = {
        urn: entityUrn('instruction', name),
        kind: 'instruction',
        name,
        description: sidecar.description,
        scopes: ['project'],
        legacyRepoPath: sidecar.repoPath,
        metadata: meta,
        source,
        content: body,
      };
      return legacy;
    }
    throw new Error(
      `parseEntityFile: non-personal instruction '${name}' requires sidecar.scopeId (or legacy sidecar.repoPath)`,
    );
  }
  throw new Error(`parseEntityFile: unsupported kind '${kind}'`);
}
