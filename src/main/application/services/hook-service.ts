import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PluginCachePort } from '../ports/plugin-cache-port.js';
import type { FileSystemPort } from '../ports/filesystem-port.js';
import type { Scope } from '../ports/scope.js';
import type { Hook, HookHandler, ClaudeHooksField } from '../schemas/hook.js';
import { claudeHooksFieldSchema, hookHandlerSchema } from '../schemas/hook.js';
import type { HookId } from '../../domain/hook-id.js';
import { hookId } from '../../domain/hook-id.js';
import type { PluginId } from '../../domain/plugin-id.js';
import { WORKSPACE_SOURCE, pluginSource } from '../../domain/customization-source.js';
import { OperationNotAllowedForOriginError } from '../../domain/plugin-errors.js';
import { DomainError } from '../../domain/errors.js';
import type { HookEntity } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE as ENTITY_WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { DetectedEntity } from '../../../shared/detected.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { hashValue } from '../entity/merge-json.js';
import type { EntityService } from './entity-service.js';
import type { DetectionService } from './detection-service.js';

export interface SaveHookResult {
  hook: Hook;
  syncReport: SyncResult[];
}

export interface PluginDepsForHooks {
  cache: PluginCachePort;
  fs: FileSystemPort;
}

/** The per-workspace pieces HookService needs; a getter because they are rebuilt on every workspace switch. */
export interface HookCanonical {
  entities: Pick<EntityService, 'list' | 'get' | 'save' | 'delete'>;
  detection: Pick<DetectionService, 'list'>;
  /** The open workspace's id; `null` at Início. */
  workspaceId: string | null;
}

const DETECTED_PREFIX = 'detected:';

/**
 * Hooks as canonical entities (one per event/matcher/handler tuple), written to
 * every enabled harness by the entity sync. `list` also surfaces plugin hooks and
 * hooks found in harness files (read-only until imported via `detected.import`).
 * The `scope` param is Claude's settings tier: `'personal'` = Global entities,
 * `'project'` = the open workspace's.
 */
export class HookService {
  constructor(
    private readonly canonical: () => HookCanonical,
    private readonly pluginDeps?: PluginDepsForHooks,
  ) {}

  async list(scope: Scope = 'personal'): Promise<Hook[]> {
    const own = await this.listOwn(scope);
    const detected = await this.listDetected(scope);
    const plugin = this.pluginDeps ? await this.collectPluginHooks(scope) : [];
    const ids = new Set(own.map((h) => h.id));
    return [...own, ...detected, ...plugin.filter((h) => !ids.has(h.id))];
  }

  async get(input: { id: HookId; scope?: Scope }): Promise<Hook> {
    const scope = input.scope ?? 'personal';
    const found = (await this.list(scope)).find((h) => h.id === input.id);
    if (!found) throw new DomainError('not_found', `Hook not found: ${input.id}`, { id: input.id, scope });
    return found;
  }

  async save(input: {
    hook: Omit<Hook, 'id' | 'source'> & { id?: HookId };
    scope?: Scope;
  }): Promise<SaveHookResult> {
    const scope = input.scope ?? 'personal';
    const { entities, workspaceId } = this.canonical();
    const id = input.hook.id;

    if (id !== undefined) {
      this.assertNotDetected('save', id);
      await this.assertNotPluginSourced('save', id, scope);
    }
    const handler = hookHandlerSchema.parse(input.hook.handler); // throws on a bad handler
    if (scope === 'project' && workspaceId === null) {
      throw new DomainError('validation', 'No workspace is open — open a folder before saving a project hook');
    }

    const name = id ?? `hook-${randomUUID().slice(0, 8)}`;
    const urn = entityUrn('hook', name);
    const existing = id !== undefined ? ((await entities.get(urn).catch(() => undefined)) as HookEntity | undefined) : undefined;
    const entity: HookEntity = {
      urn,
      kind: 'hook',
      name,
      description: input.hook.description ?? '',
      scopes: [scope === 'personal' ? 'personal' : 'workspace'],
      ...(scope === 'project' && workspaceId !== null ? { scopeId: workspaceId } : {}),
      ...(existing?.folder !== undefined ? { folder: existing.folder } : {}),
      metadata: existing?.metadata ?? { version: '1.0.0', createdAt: '', updatedAt: '' },
      source: ENTITY_WORKSPACE_SOURCE,
      event: input.hook.event,
      ...(input.hook.matcher !== undefined ? { matcher: input.hook.matcher } : {}),
      handler: handler as Record<string, unknown>,
      enabled: existing?.enabled ?? true,
    };
    const result = await entities.save({ entity, isCreate: existing === undefined });
    return { hook: toHook(result.entity as HookEntity), syncReport: result.syncReport };
  }

  async delete(input: { id: HookId; scope?: Scope }): Promise<{ ok: true }> {
    const scope = input.scope ?? 'personal';
    this.assertNotDetected('delete', input.id);
    await this.assertNotPluginSourced('delete', input.id, scope);
    await this.canonical().entities.delete({ urn: entityUrn('hook', input.id), removeSymlinks: true });
    return { ok: true };
  }

  private async listOwn(scope: Scope): Promise<Hook[]> {
    const wanted = scope === 'personal' ? 'personal' : 'workspace';
    const all = (await this.canonical().entities.list('hook')) as HookEntity[];
    return all.filter((e) => e.scopes[0] === wanted).map(toHook);
  }

  private async listDetected(scope: Scope): Promise<Hook[]> {
    const wanted = scope === 'personal' ? 'personal' : 'workspace';
    const found = await this.canonical().detection.list({ kinds: ['hook'] });
    return found.filter((d) => d.scope === wanted).map(detectedToHook);
  }

  private assertNotDetected(operation: 'save' | 'delete', id: HookId): void {
    if (id.startsWith(DETECTED_PREFIX)) {
      throw new OperationNotAllowedForOriginError(
        `Detected hook '${id}' is read-only: import it first (detected.import)`,
        { origin: 'detected', operation },
      );
    }
  }

  private async collectPluginHooks(scope: Scope): Promise<Hook[]> {
    if (!this.pluginDeps) return [];
    const { cache, fs } = this.pluginDeps;

    let plugins: ReadonlyArray<{ id: string }> = [];
    try {
      const meta = await cache.readMeta(scope);
      plugins = meta.plugins;
    } catch {
      return [];
    }

    const out: Hook[] = [];
    for (const entry of plugins) {
      const pid = entry.id as PluginId;
      const dir = cache.pluginDir(scope, pid);
      const hooks = await readPluginHooksFile(fs, dir);
      if (!hooks) continue;
      out.push(...flattenPluginHooks(hooks, pid));
    }
    return out;
  }

  private async assertNotPluginSourced(
    operation: 'save' | 'delete',
    id: HookId,
    scope: Scope,
  ): Promise<void> {
    if (!this.pluginDeps) return;
    const pluginHooks = await this.collectPluginHooks(scope);
    if (pluginHooks.some((h) => h.id === id)) {
      throw new OperationNotAllowedForOriginError(
        `Cannot ${operation} hook '${id}' provided by a plugin`,
        { origin: 'plugin', operation },
      );
    }
  }
}

function toHook(e: HookEntity): Hook {
  return {
    id: hookId(e.name),
    event: e.event,
    ...(e.matcher !== undefined ? { matcher: e.matcher } : {}),
    ...(e.description !== '' ? { description: e.description } : {}),
    handler: e.handler as HookHandler,
    source: WORKSPACE_SOURCE,
  };
}

function detectedToHook(d: DetectedEntity): Hook {
  const preview = d.preview as { event: string; matcher?: string; handler: HookHandler };
  return {
    // Short, id-safe stand-in: the real (long) detected id travels in `source`.
    id: hookId(`${DETECTED_PREFIX}${hashValue(d.id).slice(0, 16)}`),
    event: preview.event,
    ...(preview.matcher !== undefined ? { matcher: preview.matcher } : {}),
    handler: preview.handler,
    source: {
      kind: 'detected',
      detectedId: d.id,
      harness: d.harness,
      importable: d.importable,
      ...(d.reason !== undefined ? { reason: d.reason } : {}),
    },
  };
}

function flattenPluginHooks(hooks: ClaudeHooksField, pid: PluginId): Hook[] {
  const out: Hook[] = [];
  for (const [event, blocks] of Object.entries(hooks)) {
    blocks.forEach((block, blockIdx) => {
      const matcher = block.matcher;
      const description = block.description;
      block.hooks.forEach((handler, handlerIdx) => {
        const synthetic = `${pid}:${event}:${blockIdx}:${handlerIdx}`;
        const { _sdeAiId: _omit, ...handlerOnly } = handler as HookHandler & { _sdeAiId?: string };
        void _omit;
        out.push({
          id: hookId(synthetic),
          event,
          ...(matcher !== undefined ? { matcher } : {}),
          ...(description !== undefined ? { description } : {}),
          handler: handlerOnly as HookHandler,
          source: pluginSource(pid),
        });
      });
    });
  }
  return out;
}

async function readPluginHooksFile(
  fs: FileSystemPort,
  pluginDir: string,
): Promise<ClaudeHooksField | null> {
  const candidates = [join(pluginDir, 'hooks', 'hooks.json'), join(pluginDir, 'hooks.json')];
  for (const path of candidates) {
    try {
      if (!(await fs.pathExists(path))) continue;
      const raw = await fs.readFile(path);
      const parsed = JSON.parse(raw) as { hooks?: unknown };
      const hooksField = parsed.hooks ?? parsed; // tolerate {hooks: {...}} or bare {...}
      const result = claudeHooksFieldSchema.safeParse(hooksField);
      if (result.success) return result.data;
    } catch {
      // skip unreadable / malformed file
    }
  }
  return null;
}
