import type { PluginId } from './plugin-id.js';

export type PluginProvenance = 'workspace-managed' | 'claude-code';

export type CustomizationSource =
  | { kind: 'workspace' }
  | { kind: 'plugin'; pluginId: PluginId; provenance: PluginProvenance }
  /** Found in a harness's own files; read-only until imported (`detected.import`). */
  | { kind: 'detected'; detectedId: string; harness: 'claude' | 'cursor'; importable: boolean; reason?: string };

export const WORKSPACE_SOURCE: CustomizationSource = { kind: 'workspace' };

export function pluginSource(
  pluginId: PluginId,
  provenance: PluginProvenance = 'workspace-managed',
): CustomizationSource {
  return { kind: 'plugin', pluginId, provenance };
}

export function isPluginSource(
  source: CustomizationSource,
): source is { kind: 'plugin'; pluginId: PluginId; provenance: PluginProvenance } {
  return source.kind === 'plugin';
}

export function isWorkspaceSource(
  source: CustomizationSource,
): source is { kind: 'workspace' } {
  return source.kind === 'workspace';
}
