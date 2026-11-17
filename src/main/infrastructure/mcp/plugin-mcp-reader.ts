import fs from 'node:fs/promises';
import path from 'node:path';
import type { Scope } from '../../application/ports/scope.js';
import type { PluginRoot } from '../../application/services/plugin-provenance.js';
import type { PluginProvenance } from '../../domain/customization-source.js';
import { mcpServerDefSchema, type McpServerDef } from '../../application/schemas/mcp.js';

export interface PluginMcpServer {
  location: { kind: 'plugin'; pluginId: string; pluginDir: string };
  name: string;
  def: McpServerDef;
  pluginId: string;
  provenance: PluginProvenance;
}

export interface PluginMcpReaderDeps {
  listRoots: (scope: Scope) => Promise<PluginRoot[]>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A plugin's `.mcp.json` comes in two shapes Claude Code both accepts: wrapped (`{ "mcpServers": { name: def } }`)
 * or flat (`{ name: def }`, e.g. the official `github` and `playwright` plugins). Flat entries that are not a
 * server def are dropped by the schema check in {@link PluginMcpReader.read}.
 */
function serversOf(json: unknown): Record<string, unknown> {
  if (!isObject(json)) return {};
  return isObject(json['mcpServers']) ? json['mcpServers'] : json;
}

export class PluginMcpReader {
  constructor(private readonly deps: PluginMcpReaderDeps) {}

  /**
   * Roots come in tier order (app-managed, then Claude Code), so the same plugin installed in both registries is read
   * twice: its servers are deduped by {plugin/name} keeping the first (higher) tier, as `PluginProvenanceService.scan`
   * does for skills and agents. Two plugins shipping a same-named server each keep theirs.
   */
  async read(scope: Scope): Promise<PluginMcpServer[]> {
    const out: PluginMcpServer[] = [];
    const seen = new Set<string>();
    for (const root of await this.deps.listRoots(scope)) {
      const file = path.join(root.dir, '.mcp.json');
      let raw: string;
      try {
        raw = await fs.readFile(file, 'utf8');
      } catch {
        continue; // no .mcp.json for this plugin
      }
      let servers: Record<string, unknown>;
      try {
        servers = serversOf(JSON.parse(raw));
      } catch {
        continue; // malformed plugin file — skip whole plugin
      }
      for (const [name, def] of Object.entries(servers)) {
        const parsed = mcpServerDefSchema.safeParse(def);
        if (!parsed.success) continue;
        const key = `${String(root.pluginId)}/${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          location: { kind: 'plugin', pluginId: String(root.pluginId), pluginDir: root.dir },
          name,
          def: parsed.data,
          pluginId: String(root.pluginId),
          provenance: root.provenance,
        });
      }
    }
    return out;
  }
}
