import { CHANNEL_IDS, channelSupports, type ChannelId } from '../../shared/channel.js';
import type { HealthCheck, Severity } from '../../shared/health.js';

export type MatrixGroupId = 'instruction' | 'skill' | 'agent' | 'mcp' | 'hook' | 'plugin';

/** The Customizações tree's order and names. */
const GROUPS: readonly { id: MatrixGroupId; label: string; kindLabel: string }[] = [
  { id: 'instruction', label: 'Instruções', kindLabel: 'Instrução' },
  { id: 'skill', label: 'Skills', kindLabel: 'Skill' },
  { id: 'agent', label: 'Agents', kindLabel: 'Agent' },
  { id: 'mcp', label: 'MCP', kindLabel: 'MCP' },
  { id: 'hook', label: 'Hooks', kindLabel: 'Hook' },
  { id: 'plugin', label: 'Plugins', kindLabel: 'Plugin' },
];

export const KIND_LABEL: Record<MatrixGroupId, string> = Object.fromEntries(GROUPS.map((g) => [g.id, g.kindLabel])) as Record<
  MatrixGroupId,
  string
>;

export interface MatrixCell {
  channel: ChannelId;
  /** Worst of `checks` (and, on a plugin row, of its servers' cells); `null` = nothing checked there. */
  severity: Severity | null;
  /** This row's own checks for the channel. */
  checks: HealthCheck[];
}

export interface MatrixRow {
  /** Unique within the matrix: a plugin's server is keyed under its plugin. */
  key: string;
  urn: string;
  name: string;
  group: MatrixGroupId;
  severity: Severity;
  cells: MatrixCell[];
  /** A plugin's MCP servers, listed indented under it; empty otherwise. */
  children: MatrixRow[];
}

export interface DiagnosticsMatrix {
  channels: ChannelId[];
  /** Only groups with rows, in tree order. */
  groups: { id: MatrixGroupId; label: string; rows: MatrixRow[] }[];
  /** Checks about no customization (a collector that failed). */
  general: HealthCheck[];
  /** Top-level rows not connected everywhere, errors first. */
  problems: MatrixRow[];
  /** Problem rows plus general checks, by state. */
  counts: { error: number; warning: number };
}

export interface MatrixInput {
  checks: readonly HealthCheck[];
  adapters: Readonly<Partial<Record<ChannelId, { enabled: boolean }>>>;
  /** Keep only rows whose urn — or one of whose servers' urns — is listed (the ⚠ deep link). */
  only?: readonly string[];
}

const RANK: Record<Severity, number> = { ok: 0, warning: 1, error: 2 };

export function worst(severities: readonly (Severity | null)[]): Severity | null {
  let out: Severity | null = null;
  for (const s of severities) if (s !== null && (out === null || RANK[s] > RANK[out])) out = s;
  return out;
}

function parse(urn: string): { group: MatrixGroupId; name: string } | null {
  const match = /^urn:([a-z]+):(.+)$/.exec(urn);
  if (match === null) return null;
  const group = GROUPS.find((g) => g.id === match[1]);
  return group === undefined ? null : { group: group.id, name: match[2] as string };
}

/** The plugin a Claude MCP check belongs to: Claude names a plugin's server `plugin:<pluginId>:<server>`. */
function pluginOf(check: HealthCheck): string | null {
  if (check.entityUrn?.startsWith('urn:mcp:') !== true || check.target === undefined) return null;
  const match = /^plugin:([^:]+):/.exec(check.target);
  return match === null ? null : (match[1] as string);
}

function buildRow(key: string, urn: string, checks: readonly HealthCheck[], channels: readonly ChannelId[], children: MatrixRow[] = []): MatrixRow | null {
  const parsed = parse(urn);
  if (parsed === null) return null;
  const cells = channels.map((channel): MatrixCell => {
    const mine = checks.filter((c) => c.channel === channel);
    const childCells = children.map((child) => child.cells.find((c) => c.channel === channel)?.severity ?? null);
    return { channel, severity: worst([...mine.map((c) => c.severity), ...childCells]), checks: mine };
  });
  return { key, urn, ...parsed, severity: worst(cells.map((c) => c.severity)) ?? 'ok', cells, children };
}

const byName = (a: MatrixRow, b: MatrixRow): number => a.name.localeCompare(b.name);

/**
 * The Diagnóstico matrix: one row per customization a check is about (every synced destination has a check, ok
 * ones included), one column per channel that is on and receives customizations — plus any channel a check names,
 * so no check is dropped. A channel reading another's file already carries that file's verdict (coverage, main).
 */
export function buildDiagnosticsMatrix({ checks, adapters, only }: MatrixInput): DiagnosticsMatrix {
  const named = new Set(checks.flatMap((c) => (c.entityUrn !== undefined && c.channel !== undefined ? [c.channel] : [])));
  const channels = CHANNEL_IDS.filter((id) => named.has(id) || (channelSupports(id, 'manage') && adapters[id]?.enabled === true));

  const general = checks.filter((c) => c.entityUrn === undefined && c.severity !== 'ok');
  const byUrn = new Map<string, HealthCheck[]>();
  const servers = new Map<string, Map<string, HealthCheck[]>>(); // plugin id → server urn → checks
  for (const check of checks) {
    if (check.entityUrn === undefined) continue;
    const plugin = pluginOf(check);
    if (plugin !== null) {
      const mine = servers.get(plugin) ?? new Map<string, HealthCheck[]>();
      mine.set(check.entityUrn, [...(mine.get(check.entityUrn) ?? []), check]);
      servers.set(plugin, mine);
      continue;
    }
    byUrn.set(check.entityUrn, [...(byUrn.get(check.entityUrn) ?? []), check]);
  }
  for (const plugin of servers.keys()) if (!byUrn.has(`urn:plugin:${plugin}`)) byUrn.set(`urn:plugin:${plugin}`, []);

  const rows: MatrixRow[] = [];
  for (const [urn, own] of byUrn) {
    const plugin = urn.startsWith('urn:plugin:') ? urn.slice('urn:plugin:'.length) : null;
    const children = [...(plugin === null ? [] : (servers.get(plugin) ?? new Map<string, HealthCheck[]>()))]
      .flatMap(([serverUrn, serverChecks]) => {
        const child = buildRow(`${urn}>${serverUrn}`, serverUrn, serverChecks, channels);
        return child === null ? [] : [child];
      })
      .sort(byName);
    const row = buildRow(urn, urn, own, channels, children);
    if (row === null) continue;
    if (only !== undefined && !only.includes(row.urn) && !row.children.some((c) => only.includes(c.urn))) continue;
    rows.push(row);
  }

  const groups = GROUPS.flatMap((g) => {
    const mine = rows.filter((r) => r.group === g.id).sort(byName);
    return mine.length === 0 ? [] : [{ id: g.id, label: g.label, rows: mine }];
  });
  const problems = groups
    .flatMap((g) => g.rows)
    .filter((r) => r.severity !== 'ok')
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || byName(a, b));
  const shownGeneral = only === undefined ? general : [];
  const count = (s: Severity): number => problems.filter((r) => r.severity === s).length + shownGeneral.filter((c) => c.severity === s).length;
  return { channels, groups, general: shownGeneral, problems, counts: { error: count('error'), warning: count('warning') } };
}
