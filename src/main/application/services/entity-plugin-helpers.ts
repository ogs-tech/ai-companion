import { join } from 'node:path';
import type { PluginProvenanceService } from './plugin-provenance.js';
import type { FileSystemPort } from '../ports/filesystem-port.js';
import type { Scope } from '../ports/scope.js';
import { provenanceKey } from './plugin-provenance.js';
import { OperationNotAllowedForOriginError } from '../../domain/plugin-errors.js';
import type { Entity, EntitySource } from '../../../shared/entity.js';
import { parseEntityFile } from '../entity/entity-serializer.js';

export interface EntityPluginDeps {
  provenance: PluginProvenanceService;
  fs: FileSystemPort;
}

/**
 * Reads every plugin-provided entity of one kind for a scope, building each
 * as a canonical {@link Entity} via {@link parseEntityFile}. Each entity is
 * read from the dir resolved by the provenance scan, so the source registry
 * is transparent here. Files that are unreadable or unparseable are skipped
 * (and logged) — a single bad plugin entity must not break the whole read-only
 * list (plugin files are owned by their plugin's lifecycle).
 *
 * `spec.type` reads another provenance ref type as `spec.kind` (plugin `commands/*.md`
 * become Skills); `spec.explicitOnly` marks them slash-command-only, as a command file
 * carries no `disable-model-invocation` of its own.
 */
export async function collectPluginEntities(
  deps: EntityPluginDeps,
  spec: { kind: 'skill' | 'agent'; type?: 'skill' | 'agent' | 'command'; explicitOnly?: boolean; relPath: (name: string) => string },
  scope: Scope,
): Promise<Entity[]> {
  const refs = await deps.provenance.scan(scope);
  const out: Entity[] = [];
  for (const ref of refs) {
    if (ref.type !== (spec.type ?? spec.kind)) continue;
    const file = join(ref.dir, spec.relPath(ref.name));
    try {
      const raw = await deps.fs.readFile(file);
      const source: EntitySource = { kind: 'plugin', pluginId: ref.pluginId, provenance: ref.provenance };
      const entity = parseEntityFile({ kind: spec.kind, name: ref.name, raw, source });
      out.push(spec.explicitOnly === true ? ({ ...entity, explicitOnly: true } as Entity) : entity);
    } catch (err) {
      console.warn('[plugin-entities] skipped unreadable plugin file', file, err);
    }
  }
  return out;
}

/**
 * Throws OperationNotAllowedForOriginError if a workspace entity of this
 * kind/name is actually provided (shadowed) by an installed plugin, making
 * save/delete illegal. No-op when provenance deps are not configured.
 */
export async function assertEntityNotPluginSourced(
  deps: EntityPluginDeps | undefined,
  args: { kind: 'skill' | 'agent'; operation: 'save' | 'delete'; name: string; scope: Scope },
): Promise<void> {
  if (!deps) return;
  const map = await deps.provenance.forScope(args.scope);
  const pid = map.get(provenanceKey({ type: args.kind, name: args.name }));
  if (pid != null) {
    throw new OperationNotAllowedForOriginError(
      `Cannot ${args.operation} ${args.kind} '${args.name}' provided by plugin '${pid}'`,
      { origin: 'plugin', operation: args.operation },
    );
  }
}
