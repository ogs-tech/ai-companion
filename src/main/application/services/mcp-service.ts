import type { ClaudeRuntimePort } from '../ports/claude-runtime-port.js';
import type { PluginMcpReader, PluginMcpServer } from '../../infrastructure/mcp/plugin-mcp-reader.js';
import type { McpServer, McpHealth, McpServerInput } from '../../../shared/mcp.js';
import type { DetectedEntity } from '../../../shared/detected.js';
import type { McpEntity } from '../../../shared/entity.js';
import { entityUrn, WORKSPACE_SOURCE } from '../../../shared/entity.js';
import type { EntityService } from './entity-service.js';
import type { DetectionService } from './detection-service.js';
import { transportOf, mcpServerDefSchema, type McpServerDef } from '../schemas/mcp.js';
import type { SyncResult } from '../../../shared/sync-result.js';
import { mcpServerId, parseMcpServerId, type McpServerRef } from '../../domain/mcp-server-id.js';
import type { McpLocation } from '../../domain/mcp-location.js';
import { OperationNotAllowedForOriginError } from '../../domain/plugin-errors.js';
import { DomainError } from '../../domain/errors.js';
import type { ShellPort } from '../ports/shell-port.js';

/** The per-workspace pieces McpService needs; a getter because they are rebuilt on every workspace switch. */
export interface McpCanonical {
  entities: Pick<EntityService, 'list' | 'get' | 'save' | 'delete'>;
  detection: Pick<DetectionService, 'list'>;
  /** The open workspace's id; `null` at Início. */
  workspaceId: string | null;
}

export interface McpServiceDeps {
  canonical: () => McpCanonical;
  plugins: PluginMcpReader;
  runtime: ClaudeRuntimePort;
  /** Optional shell, used to open the external claude.ai auth flow. */
  shell?: ShellPort;
}

/** Where needs-auth claude.ai connectors are (re-)authenticated. */
const CLAUDE_AI_CONNECTORS_URL = 'https://claude.ai/customize/connectors';

export class McpService {
  constructor(private readonly deps: McpServiceDeps) {}

  /** Canonical servers (managed by the app, written to every harness) + plugin servers + items detected in harness files. */
  async list(): Promise<McpServer[]> {
    const { entities, detection } = this.deps.canonical();
    const [canonical, detected, plugins] = await Promise.all([
      entities.list('mcp') as Promise<McpEntity[]>,
      detection.list({ kinds: ['mcp'] }),
      this.deps.plugins.read('personal'),
    ]);
    const health = await this.buildHealthMap();

    const own = canonical.map((e) => this.entityToDto(e, health));
    const fromPlugins = plugins.map((s) => this.pluginToDto(s, health));
    // A plugin's server is listed under the plugin only: a harness-file entry of the same name is the same server.
    const pluginNames = new Set(plugins.flatMap((s) => [s.name, `plugin-${s.pluginId}-${s.name}`]));
    const found = detected.filter((d) => !pluginNames.has(d.name)).map((d) => this.detectedToDto(d, health));

    // Names already represented, so the runtime-health join doesn't double-list them as orphans.
    const claimed = new Set<string>([...canonical.map((e) => e.name), ...detected.map((d) => d.name)]);
    for (const s of plugins) {
      claimed.add(`plugin-${s.pluginId}-${s.name}`);
      claimed.add(s.name);
    }

    return [...own, ...fromPlugins, ...found, ...this.detectedOrphans(health, claimed)];
  }

  /**
   * Re-authenticates a needs-auth server by opening the external claude.ai
   * connectors page. The app cannot complete the OAuth flow itself (it has no
   * def/URL for runtime-managed connectors), so it acts as a trampoline.
   */
  async authenticate(input: { id: string }): Promise<{ ok: true }> {
    parseMcpServerId(input.id); // validate the id round-trips; throws on garbage
    const shell = this.deps.shell;
    if (shell === undefined) {
      throw new DomainError('internal', 'MCP shell port is not configured');
    }
    await shell.openExternal(CLAUDE_AI_CONNECTORS_URL);
    return { ok: true };
  }

  async get(id: string): Promise<McpServer | undefined> {
    const ref = parseMcpServerId(id);
    return (await this.list()).find((s) => s.id === mcpServerId(ref));
  }

  async save(input: { server: McpServerInput; isCreate?: boolean }): Promise<{ ok: true; syncReport: SyncResult[] }> {
    const { server } = input;
    if (server.name.trim().length === 0) {
      throw new DomainError('validation', 'MCP server name must not be empty');
    }
    const def = mcpServerDefSchema.parse(server.def); // throws validation on bad def
    const { entities, workspaceId } = this.deps.canonical();
    const scope = this.inputScope(server);
    if (scope === 'workspace' && workspaceId === null) {
      throw new DomainError('validation', 'No workspace is open — open a folder before saving a workspace MCP server');
    }
    const urn = entityUrn('mcp', server.name);
    const existing = input.isCreate === true ? undefined : await entities.get(urn).catch(() => undefined);
    const entity: McpEntity = {
      urn,
      kind: 'mcp',
      name: server.name,
      description: existing?.description ?? '',
      scopes: [scope],
      ...(scope === 'workspace' && workspaceId !== null ? { scopeId: workspaceId } : {}),
      ...(scope === 'workspace' && server.repoPath !== undefined ? { folder: server.repoPath } : {}),
      metadata: existing?.metadata ?? { version: '1.0.0', createdAt: '', updatedAt: '' },
      source: WORKSPACE_SOURCE,
      def: def as Record<string, unknown>,
      enabled: (existing as McpEntity | undefined)?.enabled ?? true,
    };
    const result = await entities.save({ entity, isCreate: existing === undefined });
    return { ok: true, syncReport: result.syncReport };
  }

  async delete(input: { id: string }): Promise<{ ok: true }> {
    const ref = this.canonicalRef(input.id, 'delete');
    await this.deps.canonical().entities.delete({ urn: entityUrn('mcp', ref.name), removeSymlinks: true });
    return { ok: true };
  }

  async setEnabled(input: { id: string; enabled: boolean }): Promise<{ ok: true; syncReport: SyncResult[] }> {
    const ref = this.canonicalRef(input.id, 'save');
    const { entities } = this.deps.canonical();
    const current = (await entities.get(entityUrn('mcp', ref.name))) as McpEntity;
    const result = await entities.save({ entity: { ...current, enabled: input.enabled } as McpEntity });
    return { ok: true, syncReport: result.syncReport };
  }

  /** Plugin and detected rows are read-only; everything else is a canonical server addressed by name. */
  private canonicalRef(id: string, operation: 'save' | 'delete'): { name: string } {
    const ref = parseMcpServerId(id);
    if (ref.location.kind === 'plugin') {
      throw new OperationNotAllowedForOriginError(
        `Cannot ${operation === 'delete' ? 'delete' : 'toggle'} MCP server '${ref.name}' provided by plugin '${ref.location.pluginId}'`,
        { origin: 'plugin', operation },
      );
    }
    if (ref.location.kind === 'detected') {
      throw new OperationNotAllowedForOriginError(
        `Detected MCP server '${ref.name}' is read-only: import it first (detected.import)`,
        { origin: 'detected', operation },
      );
    }
    return { name: ref.name };
  }

  private inputScope(server: McpServerInput): 'personal' | 'workspace' {
    const ALLOWED = new Set(['global', 'project-local', 'project-shared']);
    if (!ALLOWED.has(server.scope)) {
      throw new DomainError('validation', `Invalid MCP scope '${String(server.scope)}'`);
    }
    return server.scope === 'global' ? 'personal' : 'workspace';
  }

  private entityToDto(e: McpEntity, health: Map<string, McpHealth>): McpServer {
    const personal = e.scopes[0] === 'personal';
    const location: McpLocation = personal ? { kind: 'global' } : { kind: 'project-shared', repoPath: e.folder ?? '' };
    const found = health.get(e.name);
    return {
      id: mcpServerId({ location, name: e.name }),
      name: e.name,
      transport: transportOf(e.def as McpServerDef),
      def: e.def,
      scope: personal ? 'global' : 'project-shared',
      ...(!personal && e.folder !== undefined ? { repoPath: e.folder } : {}),
      source: { kind: 'workspace' },
      enabled: e.enabled,
      ...(found !== undefined ? { health: found } : {}),
    };
  }

  private detectedToDto(d: DetectedEntity, health: Map<string, McpHealth>): McpServer {
    const def = (d.preview['def'] ?? {}) as Record<string, unknown>;
    const parsed = mcpServerDefSchema.safeParse(def);
    const found = health.get(d.name);
    return {
      // Harness-qualified so the same server found in Claude and Cursor gets two distinct row ids.
      id: mcpServerId({ location: { kind: 'detected' }, name: `${d.harness}/${d.scope}/${d.name}` }),
      name: d.name,
      ...(parsed.success ? { transport: transportOf(parsed.data) } : {}),
      def,
      scope: 'detected',
      ...(d.folder !== undefined ? { repoPath: d.folder } : {}),
      source: {
        kind: 'detected',
        detectedId: d.id,
        harness: d.harness,
        importable: d.importable,
        ...(d.reason !== undefined ? { reason: d.reason } : {}),
      },
      enabled: true,
      ...(found !== undefined ? { health: found } : {}),
    };
  }

  private pluginToDto(s: PluginMcpServer, health: Map<string, McpHealth>): McpServer {
    const ref: McpServerRef = { location: s.location, name: s.name };
    const runtimeName = `plugin-${s.pluginId}-${s.name}`;
    const found = health.get(runtimeName) ?? health.get(s.name);
    return {
      id: mcpServerId(ref),
      name: s.name,
      transport: transportOf(s.def),
      def: s.def as Record<string, unknown>,
      scope: 'plugin',
      source: { kind: 'plugin', pluginId: s.pluginId, provenance: s.provenance },
      enabled: true,
      ...(found !== undefined ? { health: found } : {}),
    };
  }

  /**
   * Servers the Claude Code runtime knows about (via logs / needs-auth cache)
   * that have a health problem AND no broker-readable config. Surfaced read-only
   * so failures — notably needs-auth claude.ai connectors — are visible and the
   * user can act on them; healthy orphans are intentionally omitted to avoid noise.
   */
  private detectedOrphans(health: Map<string, McpHealth>, claimed: Set<string>): McpServer[] {
    const out: McpServer[] = [];
    for (const [name, h] of health) {
      if (h.state !== 'error' && h.state !== 'needs-auth') continue;
      if (claimed.has(name)) continue;
      out.push(this.detectedDto(name, h));
    }
    return out;
  }

  private detectedDto(name: string, health: McpHealth): McpServer {
    const ref: McpServerRef = { location: { kind: 'detected' }, name };
    return {
      id: mcpServerId(ref),
      name,
      def: {},
      scope: 'detected',
      source: { kind: 'detected' },
      enabled: false,
      health,
    };
  }

  private async buildHealthMap(): Promise<Map<string, McpHealth>> {
    const [logs, alerts] = await Promise.all([
      this.deps.runtime.readMcpRuntimeLogs(),
      this.deps.runtime.readMcpAuthAlerts(),
    ]);
    // Keyed by bare server name: runtime logs are name-only, so health is matched by name alone.
    // Two servers with the same name in different scopes (e.g. global + project-local) will share
    // the same health entry — an acceptable limitation given the runtime's flat namespace.
    const map = new Map<string, McpHealth>();
    for (const log of logs) {
      map.set(log.server, {
        state: log.state,
        ...(log.detail !== undefined ? { detail: log.detail } : {}),
      });
    }
    // Auth-needed wins over an otherwise-ok status.
    for (const alert of alerts) map.set(alert.name, { state: 'needs-auth' });
    return map;
  }
}
