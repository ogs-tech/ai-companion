import { parseMarkdown, serializeMarkdown } from '../markdown/frontmatter.js';
import { entityUrn } from '../../../shared/entity.js';
import type {
  Agent,
  Entity,
  EntityKind,
  HookEntity,
  McpEntity,
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
    return raw.filter((s): s is Scope => s === 'personal' || s === 'workspace');
  }
  return ['personal'];
}

const MCP_KEYS = [...COMMON_KEYS, 'def', 'enabled'];
const HOOK_KEYS = [...COMMON_KEYS, 'event', 'matcher', 'handler', 'enabled'];

/** `mcp` and `hook` are pure data, so they are stored as JSON rather than Markdown + frontmatter. */
function renderJsonEntity(entity: McpEntity | HookEntity): string {
  const payload: Record<string, unknown> =
    entity.kind === 'mcp'
      ? { ...metaFrontmatter(entity), def: entity.def, enabled: entity.enabled }
      : {
          ...metaFrontmatter(entity),
          event: entity.event,
          ...(entity.matcher !== undefined ? { matcher: entity.matcher } : {}),
          handler: entity.handler,
          enabled: entity.enabled,
        };
  return `${JSON.stringify({ ...payload, ...(entity.ext ?? {}) }, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonEntity(kind: 'mcp' | 'hook', name: string, raw: string, source: EntitySource): Entity {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`parseEntityFile: ${kind} '${name}' is not a JSON object`);
  const base = {
    urn: entityUrn(kind, name),
    name,
    description: typeof parsed['description'] === 'string' ? parsed['description'] : '',
    scopes: readScopes(parsed),
    ...(typeof parsed['scopeId'] === 'string' ? { scopeId: parsed['scopeId'] } : {}),
    metadata: readMetadata(parsed),
    source,
    enabled: parsed['enabled'] !== false,
  };
  if (kind === 'mcp') {
    if (!isRecord(parsed['def'])) throw new Error(`parseEntityFile: mcp '${name}' has no 'def' object`);
    const ext = extOf(parsed, MCP_KEYS);
    const mcp: McpEntity = { ...base, kind: 'mcp', def: parsed['def'], ...(ext !== undefined ? { ext } : {}) };
    return mcp;
  }
  const event = parsed['event'];
  if (typeof event !== 'string' || !isRecord(parsed['handler'])) {
    throw new Error(`parseEntityFile: hook '${name}' needs 'event' and a 'handler' object`);
  }
  const ext = extOf(parsed, HOOK_KEYS);
  const hook: HookEntity = {
    ...base,
    kind: 'hook',
    event,
    ...(typeof parsed['matcher'] === 'string' ? { matcher: parsed['matcher'] } : {}),
    handler: parsed['handler'],
    ...(ext !== undefined ? { ext } : {}),
  };
  return hook;
}

export function renderEntityFile(entity: Entity): string {
  if (entity.kind === 'mcp' || entity.kind === 'hook') return renderJsonEntity(entity as McpEntity | HookEntity);
  if (entity.kind === 'instruction') {
    // Frontmatter-free: the body is the whole file. Description/metadata
    // for workspace instructions lives in a sidecar meta.json (not this file).
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
   * owning workspace (workspace instructions only), description, version and timestamps that would
   * otherwise be lost to the frontmatter-free storage. Personal instructions
   * default this to zeroed values when omitted.
   */
  instructionSidecar?: InstructionSidecar;
}

export function parseEntityFile(args: ParseEntityFileArgs): Entity {
  const { kind, name, raw, source, instructionSidecar } = args;
  if (kind === 'mcp' || kind === 'hook') return parseJsonEntity(kind, name, raw, source);
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
        scopes: ['workspace'],
        scopeId: sidecar.scopeId,
        metadata: meta,
        source,
        content: body,
      };
      return scoped;
    }
    throw new Error(
      `parseEntityFile: non-personal instruction '${name}' requires sidecar.scopeId`,
    );
  }
  throw new Error(`parseEntityFile: unsupported kind '${kind}'`);
}
