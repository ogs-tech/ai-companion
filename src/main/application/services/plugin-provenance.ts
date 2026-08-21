import { join } from 'node:path';
import type { PluginId } from '../../domain/plugin-id.js';
import type { PluginCachePort } from '../ports/plugin-cache-port.js';
import type { FileSystemPort } from '../ports/filesystem-port.js';
import type { Scope } from '../ports/scope.js';
import type { ClaudeCodePluginRegistryPort } from '../ports/claude-code-plugin-registry-port.js';
import type { PluginProvenance } from '../../domain/customization-source.js';

export interface ProvenanceKey {
  type: 'skill' | 'agent' | 'command';
  name: string;
}

export type ProvenanceMap = Map<string, PluginId>;

/** A single plugin-provided entity, resolved to the dir it must be read from. */
export interface PluginEntityRef {
  type: 'skill' | 'agent' | 'command';
  name: string;
  pluginId: PluginId;
  /** Root install directory of the plugin (not the type-specific subdirectory). */
  dir: string;
  provenance: PluginProvenance;
}

export interface PluginRoot {
  pluginId: PluginId;
  dir: string;
  provenance: PluginProvenance;
}

export function provenanceKey(key: ProvenanceKey): string {
  return `${key.type}/${key.name}`;
}

export interface PluginProvenanceDeps {
  cache: PluginCachePort;
  fs: FileSystemPort;
  /** Optional: when present, Claude Code plugins are discovered for the personal scope. */
  claudeCodeRegistry?: ClaudeCodePluginRegistryPort;
}

/**
 * Computes plugin provenance by scanning each installed plugin's skills/,
 * agents/ and commands/ across two registries, in tier order:
 *   1. workspace-managed (~/.ai-companion/plugins)
 *   2. claude-code       (~/.claude/plugins, personal scope only)
 * A {type/name} present in a higher tier shadows the same key in a lower tier.
 * Plugin-provided customizations are read-only; their lifecycle owns the files.
 */
export class PluginProvenanceService {
  constructor(private readonly deps?: PluginProvenanceDeps) {}

  /** Backward-compatible {type/name} → PluginId map (first/higher tier wins). */
  async forScope(scope: Scope): Promise<ProvenanceMap> {
    const map: ProvenanceMap = new Map();
    for (const ref of await this.scan(scope)) {
      map.set(provenanceKey({ type: ref.type, name: ref.name }), ref.pluginId);
    }
    return map;
  }

  /** Every plugin-provided entity, deduped by {type/name} keeping the higher tier. */
  async scan(scope: Scope): Promise<PluginEntityRef[]> {
    if (!this.deps) return [];
    const out: PluginEntityRef[] = [];
    const seen = new Set<string>();
    for (const root of await this.listRoots(scope)) {
      for (const ref of await this.scanRoot(root)) {
        const k = provenanceKey({ type: ref.type, name: ref.name });
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(ref);
      }
    }
    return out;
  }

  /** Every installed plugin's root dir for a scope (workspace-managed + claude-code). */
  async roots(scope: Scope): Promise<PluginRoot[]> {
    if (!this.deps) return [];
    return this.listRoots(scope);
  }

  private async listRoots(scope: Scope): Promise<PluginRoot[]> {
    const { cache, claudeCodeRegistry } = this.deps!;
    const roots: PluginRoot[] = [];

    // Tier 1 — workspace-managed plugins.
    try {
      const meta = await cache.readMeta(scope);
      for (const entry of meta.plugins) {
        const pid = entry.id as PluginId;
        roots.push({
          pluginId: pid,
          dir: cache.pluginDir(scope, pid),
          provenance: 'workspace-managed',
        });
      }
    } catch {
      // No workspace meta — skip this tier.
    }

    // Tier 2 — Claude Code plugins (registry scope "user" → app personal).
    if (scope === 'personal' && claudeCodeRegistry) {
      try {
        for (const d of await claudeCodeRegistry.list()) {
          roots.push({ pluginId: d.pluginId, dir: d.installPath, provenance: 'claude-code' });
        }
      } catch {
        // Registry unavailable — skip this tier.
      }
    }

    return roots;
  }

  private async scanRoot(root: PluginRoot): Promise<PluginEntityRef[]> {
    const { fs } = this.deps!;
    const refs: PluginEntityRef[] = [];
    const push = (type: PluginEntityRef['type'], name: string): void => {
      refs.push({ type, name, pluginId: root.pluginId, dir: root.dir, provenance: root.provenance });
    };

    // skills/<name>/ — each entry is a directory holding SKILL.md.
    await scanDir(fs, join(root.dir, 'skills'), (entry) => {
      if (entry.startsWith('.')) return;
      push('skill', entry);
    });
    // agents/<name>.md
    await scanDir(fs, join(root.dir, 'agents'), (entry) => {
      if (entry.startsWith('.') || !entry.endsWith('.md')) return;
      push('agent', entry.replace(/\.md$/, ''));
    });
    // commands/<name>.md
    await scanDir(fs, join(root.dir, 'commands'), (entry) => {
      if (entry.startsWith('.') || !entry.endsWith('.md')) return;
      push('command', entry.replace(/\.md$/, ''));
    });

    return refs;
  }
}

async function scanDir(
  fs: FileSystemPort,
  dir: string,
  onEntry: (entry: string) => void,
): Promise<void> {
  try {
    if (!(await fs.pathExists(dir))) return;
    for (const entry of await fs.readdir(dir)) onEntry(entry);
  } catch {
    // Dir removed since meta was written, or unreadable — skip.
  }
}
