export type EntityKind = 'skill' | 'agent' | 'mcp' | 'instruction' | 'hook';

export type Scope = 'personal' | 'project' | 'workspace';

export type EntityProvenance = 'workspace-managed' | 'claude-code';

export type EntitySource =
  | { kind: 'workspace' }
  | { kind: 'plugin'; pluginId: string; provenance: EntityProvenance };

export const WORKSPACE_SOURCE: EntitySource = { kind: 'workspace' };

export function isPluginSource(
  source: EntitySource,
): source is { kind: 'plugin'; pluginId: string; provenance: EntityProvenance } {
  return source.kind === 'plugin';
}

export function isWorkspaceSource(source: EntitySource): source is { kind: 'workspace' } {
  return source.kind === 'workspace';
}

export interface EntityMetadata {
  version: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Entity {
  urn: string;
  kind: EntityKind;
  name: string;
  description: string;
  scopes: Scope[];
  scopeId?: string;
  metadata: EntityMetadata;
  source: EntitySource;
  ext?: Record<string, unknown>;
}

export interface Skill extends Entity {
  kind: 'skill';
  content: string;
  explicitOnly?: boolean;
}

export interface Agent extends Entity {
  kind: 'agent';
  systemPrompt: string;
  model?: string;
  tools?: string[];
  deniedTools?: string[];
}

/**
 * `name === 'default'` and `scopes === ['personal']` identify the personal
 * singleton; any other instruction carries `scopes[0] === 'project' | 'workspace'`
 * and a `scopeId` resolved against `Project.id` / `Workspace.id` (see
 * `resolveScopePath`). `legacyRepoPath` is set only on read, only for
 * pre-migration on-disk data that predates `scopeId` — see
 * `InstructionService.get`/`.list`.
 */
export interface Instruction extends Entity {
  kind: 'instruction';
  content: string;
  legacyRepoPath?: string;
}

export function isPersonalInstruction(entity: Instruction): boolean {
  return entity.scopes[0] === 'personal';
}

export function isProjectInstruction(entity: Instruction): boolean {
  return entity.scopes[0] === 'project';
}

export function isWorkspaceInstruction(entity: Instruction): boolean {
  return entity.scopes[0] === 'workspace';
}

/**
 * Sidecar metadata for instructions. Instructions are stored frontmatter-free
 * on disk so the sync target (AGENTS.md, CLAUDE.md) is a clean body — this
 * struct captures everything else (description, version, timestamps, and the
 * per-project repoPath) and lives in a separate `meta.json` for project
 * instructions. Personal instructions default this struct in memory.
 */
export interface InstructionSidecar {
  description: string;
  version: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  /** Current shape (post scopeId migration). */
  scope?: 'project' | 'workspace';
  scopeId?: string;
  /** Legacy shape — read-only. Never written again after the scopeId migration lands. */
  repoPath?: string;
}

export function entityUrn(kind: EntityKind, name: string): string {
  return `urn:${kind}:${name}`;
}

export function parseUrn(urn: string): { kind: EntityKind; name: string } {
  const match = /^urn:([a-z]+):(.+)$/.exec(urn);
  const kind = match?.[1];
  const name = match?.[2];
  if (kind === undefined || name === undefined) {
    throw new Error(`Invalid URN: ${urn}`);
  }
  return { kind: kind as EntityKind, name };
}
