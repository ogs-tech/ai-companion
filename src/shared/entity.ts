export type EntityKind = 'skill' | 'agent' | 'mcp' | 'instruction' | 'hook';

/** `personal` = Global (`~/.ai-companion`); `workspace` = one open folder, identified by `scopeId`. */
export type Scope = 'personal' | 'workspace';

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
 * singleton; any other instruction carries `scopes[0] === 'workspace'` and a
 * `scopeId` resolved against `Workspace.id` (see `resolveScopePath`).
 */
export interface Instruction extends Entity {
  kind: 'instruction';
  content: string;
}

export function isPersonalInstruction(entity: Instruction): boolean {
  return entity.scopes[0] === 'personal';
}

export function isWorkspaceInstruction(entity: Instruction): boolean {
  return entity.scopes[0] === 'workspace';
}

/**
 * Sidecar metadata for instructions. Instructions are stored frontmatter-free
 * on disk so the sync target (AGENTS.md, CLAUDE.md) is a clean body — this
 * struct captures everything else (description, version, timestamps, and the
 * owning workspace) and lives in a separate `meta.json` for workspace
 * instructions. Personal instructions default this struct in memory.
 */
export interface InstructionSidecar {
  description: string;
  version: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  /** Present on every workspace instruction; absent on the personal singleton. */
  scope?: 'workspace';
  scopeId?: string;
}

export interface EntityChangedEvent {
  kind: EntityKind;
  urn: string;
}

/** Push channel main→renderer, fired when a workspace's file watcher re-syncs an entity edited outside the app's own save() flow (see `docs/reference/ipc-contract.md#push-channels-exception-to-requestresponse`). */
export const ENTITY_CHANGED_CHANNEL = 'entity:changed' as const;

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
