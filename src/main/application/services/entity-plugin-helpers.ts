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
      out.push(await readPluginEntity(deps, spec, ref, file));
    } catch (err) {
      console.warn('[plugin-entities] skipped unreadable plugin file', file, err);
    }
  }
  return out;
}

type PluginRef = Awaited<ReturnType<PluginProvenanceService['scan']>>[number];
type CollectSpec = Parameters<typeof collectPluginEntities>[1];

async function readPluginEntity(deps: EntityPluginDeps, spec: CollectSpec, ref: PluginRef, file: string): Promise<Entity> {
  const raw = await deps.fs.readFile(file);
  const source: EntitySource = { kind: 'plugin', pluginId: ref.pluginId, provenance: ref.provenance };
  const entity = parseEntityFile({ kind: spec.kind, name: ref.name, raw, source });
  return spec.explicitOnly === true ? ({ ...entity, explicitOnly: true } as Entity) : entity;
}

/** Where each plugin-provided entity lives; shared by the lists and the Diagnósticos scan. */
export const PLUGIN_SKILL_SPEC: CollectSpec = { kind: 'skill', relPath: (name) => `skills/${name}/SKILL.md` };
export const PLUGIN_COMMAND_SPEC: CollectSpec = { kind: 'skill', type: 'command', explicitOnly: true, relPath: (name) => `commands/${name}.md` };
export const PLUGIN_AGENT_SPEC: CollectSpec = { kind: 'agent', relPath: (name) => `agents/${name}.md` };

export interface PluginEntityFailure {
  pluginId: string;
  file: string;
  reason: string;
}

/** Every plugin skill / agent / command file that cannot be read, for Diagnósticos (the lists only skip them). */
export async function findUnreadablePluginEntities(
  deps: EntityPluginDeps,
  specs: ReadonlyArray<CollectSpec>,
  scope: Scope,
): Promise<PluginEntityFailure[]> {
  const refs = await deps.provenance.scan(scope);
  const failures: PluginEntityFailure[] = [];
  for (const spec of specs) {
    for (const ref of refs) {
      if (ref.type !== (spec.type ?? spec.kind)) continue;
      const file = join(ref.dir, spec.relPath(ref.name));
      try {
        await readPluginEntity(deps, spec, ref, file);
      } catch (err) {
        failures.push({ pluginId: String(ref.pluginId), file, reason: (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? 'unreadable' });
      }
    }
  }
  return failures;
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
