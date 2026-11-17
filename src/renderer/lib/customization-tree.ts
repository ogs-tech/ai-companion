import type { ChannelId } from '../../shared/channel.js';
import type { DetectedEntity } from '../../shared/detected.js';
import { entityUrn, isWorkspaceInstruction, type Agent, type Entity, type Instruction, type Skill } from '../../shared/entity.js';
import type { McpServer } from '../../shared/mcp.js';
import type { PluginListItemIpc } from '../../shared/plugin-ipc-types.js';
import type { Hook } from '../hooks/use-hooks.js';
import { describeHookHandler, hookRowLabel } from './describe-hook-handler.js';
import { matchesQuery } from './control-panel-filter.js';
import type { ChannelProblems } from './entity-health.js';

export type TreeFilter = 'all' | 'problems' | 'disabled' | 'detected';
export type TreeGroupId = 'instruction' | 'skill' | 'agent' | 'mcp' | 'hook' | 'plugin';
export type TreeOrigin = 'local' | 'global' | 'detected';
export type RowBadge = 'problem' | 'disabled' | 'detected' | null;
/** `local` = the open workspace's own items (and what was detected in it); `global` = Início's, read-only here. */
export type TreeSectionId = 'local' | 'global';

/** Where an instruction row sits: Global's singleton, the workspace-wide set, or one folder of a multi-folder workspace. */
export type InstructionPlacement = 'personal' | 'workspace' | 'folder';

export type TreeEntity =
  /**
   * `value` undefined = a placeholder row: the level has no saved instruction yet, so the row is the
   * place to create one (and to apply a `detected` file found there). Placeholders are never counted.
   */
  | { kind: 'instruction'; value: Instruction | undefined; placement: InstructionPlacement; folder?: string; detected?: DetectedEntity }
  | { kind: 'skill'; value: Skill }
  | { kind: 'agent'; value: Agent }
  | { kind: 'mcp'; value: McpServer }
  | { kind: 'hook'; value: Hook }
  | { kind: 'plugin'; value: PluginListItemIpc }
  /** A detected skill/agent; detected MCP servers and hooks keep their own kind. */
  | { kind: 'detected'; value: DetectedEntity };

export interface TreeItem {
  /** Unique within the tree: the same name can exist locally and in Global, or be detected in two harnesses. */
  key: string;
  urn: string;
  name: string;
  origin: TreeOrigin;
  folderAlias?: string;
  state: { problems: readonly ChannelId[]; disabled: boolean };
  entity: TreeEntity;
}

export interface TreeGroup {
  id: TreeGroupId;
  label: string;
  items: TreeItem[];
  count: number;
  problems: number;
}

export interface TreeSection {
  id: TreeSectionId;
  groups: TreeGroup[];
  count: number;
  problems: number;
}

export interface TreeTotals {
  all: number;
  global: number;
  problems: number;
  disabled: number;
  detected: number;
}

export interface CustomizationTree {
  /**
   * Inside a workspace: the Workspace section, then — when anything in it matches — the Global one.
   * At Início (or while the workspace loads) a single `local` section.
   */
  sections: TreeSection[];
  /** Chip counts, on the search-filtered set. */
  totals: TreeTotals;
  /** Items the groups list under the current search and chip. */
  shown: number;
  /** Items with no search and no chip — what the header names. */
  grandTotal: number;
}

export interface TreeInput {
  skills: readonly Skill[];
  agents: readonly Agent[];
  instructions: readonly Instruction[];
  personalInstruction: Instruction | null | undefined;
  mcps: readonly McpServer[];
  hooks: readonly Hook[];
  plugins: readonly PluginListItemIpc[];
  /** Detected skills, agents and instructions (any scope; filtered here). */
  detected: readonly DetectedEntity[];
  problems: ChannelProblems;
}

export interface TreeOptions {
  isHome: boolean;
  localScope?: { scope: 'workspace'; scopeId: string };
  mcpMatchPath?: string;
  aliases: Readonly<Record<string, string>>;
  /** Workspace folders in order — one instruction row each in a multi-folder workspace. */
  folders: readonly string[];
  multi: boolean;
  query: string;
  filter: TreeFilter;
}

const GROUPS: ReadonlyArray<{ id: TreeGroupId; label: string }> = [
  { id: 'instruction', label: 'Instruções' },
  { id: 'skill', label: 'Skills' },
  { id: 'agent', label: 'Agents' },
  { id: 'mcp', label: 'MCP' },
  { id: 'hook', label: 'Hooks' },
  { id: 'plugin', label: 'Plugins' },
];

const ORIGIN_ORDER: Record<TreeOrigin, number> = { local: 0, global: 1, detected: 2 };

/** What a level's instruction row is called; a folder's adds its folder tag, an extra workspace one shows its own name. */
const INSTRUCTION_LABEL = 'Instructions';

/** A candidate row before search and chip filtering. */
interface Candidate {
  item: TreeItem;
  group: TreeGroupId;
  /** Fields the search matches against. */
  haystack: ReadonlyArray<string | undefined>;
  /** Placeholder rows: shown only while nothing narrows the list (or when `alwaysMatch`), never counted. */
  placeholder?: { alwaysMatch: boolean };
  /** Keeps the row's position instead of sorting it by name (instruction rows follow their level's order). */
  order?: number;
}

/** A server configured in the open workspace's own folder (`matchPath`); everything is local without one (Início). */
export function isMcpLocal(server: McpServer, matchPath: string | undefined): boolean {
  if (matchPath === undefined) return true;
  const projectScoped = server.scope === 'project-local' || server.scope === 'project-shared' || server.scope === 'detected';
  return projectScoped && server.repoPath === matchPath;
}

function entityOrigin(entity: Entity, options: TreeOptions): TreeOrigin {
  const local = options.localScope;
  if (options.isHome || local === undefined) return 'local';
  return entity.scopes[0] === 'workspace' && entity.scopeId === local.scopeId ? 'local' : 'global';
}

function aliasOf(folder: string | undefined, options: TreeOptions): string | undefined {
  if (!options.multi || folder === undefined) return undefined;
  return options.aliases[folder];
}

function makeItem(
  fields: { identity: string; urn: string; name: string; origin: TreeOrigin; folder?: string | undefined; disabled?: boolean; entity: TreeEntity },
  input: TreeInput,
  options: TreeOptions,
): TreeItem {
  const folderAlias = aliasOf(fields.folder, options);
  return {
    key: `${fields.origin}:${folderAlias ?? ''}:${fields.identity}`,
    urn: fields.urn,
    name: fields.name,
    origin: fields.origin,
    ...(folderAlias !== undefined ? { folderAlias } : {}),
    state: {
      problems: fields.origin === 'detected' ? [] : (input.problems.get(fields.urn) ?? []),
      disabled: fields.disabled ?? false,
    },
    entity: fields.entity,
  };
}

function instructionCandidates(input: TreeInput, options: TreeOptions): Candidate[] {
  const out: Candidate[] = [];
  const detectedInstruction = (scope: 'personal' | 'workspace', folder: string | undefined): DetectedEntity | undefined =>
    input.detected.find((d) => d.kind === 'instruction' && d.scope === scope && (scope === 'personal' || d.folder === folder));
  const row = (
    value: Instruction | undefined,
    placement: InstructionPlacement,
    origin: TreeOrigin,
    name: string,
    folder: string | undefined,
    order: number,
  ): Candidate => {
    const scope = placement === 'personal' ? 'personal' : 'workspace';
    const detected = value === undefined ? detectedInstruction(scope, folder) : undefined;
    const entity: TreeEntity = {
      kind: 'instruction',
      value,
      placement,
      ...(folder !== undefined ? { folder } : {}),
      ...(detected !== undefined ? { detected } : {}),
    };
    const identity = value?.urn ?? `instruction-slot:${placement}:${folder ?? ''}`;
    return {
      item: makeItem({ identity, urn: value?.urn ?? identity, name, origin, folder, entity }, input, options),
      group: 'instruction',
      haystack: placement === 'personal' ? ['instructions', value?.name, value?.description] : [value?.name, value?.description],
      ...(value === undefined ? { placeholder: { alwaysMatch: placement === 'personal' } } : {}),
      order,
    };
  };

  if (options.isHome) {
    out.push(row(input.personalInstruction ?? undefined, 'personal', 'local', INSTRUCTION_LABEL, undefined, 0));
    return out;
  }
  const local = options.localScope;
  if (local !== undefined) {
    const own = input.instructions.filter((i) => isWorkspaceInstruction(i) && i.scopeId === local.scopeId);
    const wide = own.filter((i) => i.folder === undefined || !options.multi);
    const [primary, ...extras] = [...wide].sort((a, b) => a.name.localeCompare(b.name));
    let order = 0;
    out.push(row(primary, 'workspace', 'local', INSTRUCTION_LABEL, undefined, order++));
    for (const extra of extras) out.push(row(extra, 'workspace', 'local', extra.name, undefined, order++));
    if (options.multi) {
      for (const folder of options.folders) {
        const saved = own.find((i) => i.folder === folder);
        out.push(row(saved, 'folder', 'local', INSTRUCTION_LABEL, folder, order++));
      }
    }
  }
  // Inside a workspace Global's singleton is a read-only row, so only a saved one shows.
  if (input.personalInstruction != null) {
    const origin: TreeOrigin = local === undefined ? 'local' : 'global';
    out.push(row(input.personalInstruction, 'personal', origin, INSTRUCTION_LABEL, undefined, 1000));
  }
  return out;
}

function candidates(input: TreeInput, options: TreeOptions): Candidate[] {
  const out: Candidate[] = instructionCandidates(input, options);

  const entityRows = (kind: 'skill' | 'agent', list: ReadonlyArray<Skill | Agent>): void => {
    for (const value of list) {
      if (value.source.kind === 'plugin') continue;
      const urn = entityUrn(kind, value.name);
      const entity = (kind === 'skill' ? { kind, value } : { kind, value }) as TreeEntity;
      out.push({
        item: makeItem({ identity: urn, urn, name: value.name, origin: entityOrigin(value, options), folder: value.folder, entity }, input, options),
        group: kind,
        haystack: [value.name, value.description],
      });
    }
  };
  entityRows('skill', input.skills);
  entityRows('agent', input.agents);

  const detectedScope = options.isHome ? 'personal' : 'workspace';
  for (const d of input.detected) {
    if ((d.kind !== 'skill' && d.kind !== 'agent') || d.scope !== detectedScope) continue;
    out.push({
      item: makeItem(
        { identity: `detected:${d.id}`, urn: entityUrn(d.kind, d.name), name: d.name, origin: 'detected', folder: d.folder, entity: { kind: 'detected', value: d } },
        input,
        options,
      ),
      group: d.kind,
      haystack: [d.name, d.description],
    });
  }

  for (const server of input.mcps) {
    if (server.source.kind === 'plugin') continue;
    const origin: TreeOrigin = server.source.kind === 'detected' ? 'detected' : isMcpLocal(server, options.mcpMatchPath) ? 'local' : 'global';
    const urn = entityUrn('mcp', server.name);
    out.push({
      // Only the user's own servers can be turned off; a detected one (e.g. a claude.ai connector) reports
      // `enabled: false` just because the app does not manage it.
      item: makeItem(
        { identity: `mcp:${server.id}`, urn, name: server.name, origin, disabled: server.source.kind === 'workspace' && !server.enabled, entity: { kind: 'mcp', value: server } },
        input,
        options,
      ),
      group: 'mcp',
      haystack: [server.name],
    });
  }

  // Hooks have no workspace scoping: all of them are Global's, read from inside a workspace.
  const hookOrigin: TreeOrigin = options.isHome || options.localScope === undefined ? 'local' : 'global';
  for (const value of input.hooks) {
    if (value.source.kind === 'plugin') continue;
    const urn = entityUrn('hook', value.id);
    out.push({
      item: makeItem(
        {
          identity: urn,
          urn,
          name: hookRowLabel(value),
          origin: value.source.kind === 'detected' ? 'detected' : hookOrigin,
          disabled: value.enabled === false,
          entity: { kind: 'hook', value },
        },
        input,
        options,
      ),
      group: 'hook',
      haystack: [describeHookHandler(value.handler), value.event],
    });
  }

  for (const value of input.plugins) {
    // Plugins are not an Entity kind, but health checks name them `urn:plugin:<id>` (see `rollUpToPlugins`).
    const urn = `urn:plugin:${value.id}`;
    const origin: TreeOrigin = options.isHome || options.localScope === undefined || value.scope === 'project' ? 'local' : 'global';
    out.push({
      item: makeItem({ identity: urn, urn, name: value.id, origin, disabled: !value.enabled, entity: { kind: 'plugin', value } }, input, options),
      group: 'plugin',
      haystack: [value.id],
    });
  }
  return out;
}

function passesFilter(item: TreeItem, filter: TreeFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'problems':
      return item.state.problems.length > 0;
    case 'disabled':
      return item.state.disabled;
    case 'detected':
      return item.origin === 'detected';
  }
}

function totalsOf(items: readonly TreeItem[]): TreeTotals {
  return {
    all: items.length,
    global: items.filter((i) => i.origin === 'global').length,
    problems: items.filter((i) => i.state.problems.length > 0).length,
    disabled: items.filter((i) => i.state.disabled).length,
    detected: items.filter((i) => i.origin === 'detected').length,
  };
}

function compare(a: Candidate, b: Candidate): number {
  if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
  return ORIGIN_ORDER[a.item.origin] - ORIGIN_ORDER[b.item.origin] || a.item.name.localeCompare(b.item.name);
}

/**
 * Every list the Customizações panel shows, as scope sections › type groups › items with origin, state and counts.
 * Search first (the chips count on its result), then the chip, then grouping and sorting.
 */
export function buildCustomizationTree(input: TreeInput, options: TreeOptions): CustomizationTree {
  const all = candidates(input, options);
  const narrowing = options.query.trim() !== '' || options.filter !== 'all';
  const counted = (c: Candidate): boolean => c.placeholder === undefined;

  const searched = all.filter((c) =>
    c.placeholder !== undefined
      ? options.filter === 'all' && (options.query.trim() === '' || (c.placeholder.alwaysMatch && matchesQuery(options.query, ...c.haystack)))
      : matchesQuery(options.query, ...c.haystack),
  );
  const totals = totalsOf(searched.filter(counted).map((c) => c.item));
  const visible = searched.filter((c) => c.placeholder !== undefined || passesFilter(c.item, options.filter));

  const section = (id: TreeSectionId, members: readonly Candidate[]): TreeSection => {
    const groups: TreeGroup[] = [];
    for (const { id: groupId, label } of GROUPS) {
      const inGroup = members.filter((c) => c.group === groupId).sort(compare);
      // Skills and Agents stay in the scope's own section as the place to create, while nothing narrows the list.
      const keepEmpty = id === 'local' && !narrowing && (groupId === 'skill' || groupId === 'agent');
      if (inGroup.length === 0 && !keepEmpty) continue;
      const countedItems = inGroup.filter(counted).map((c) => c.item);
      groups.push({
        id: groupId,
        label,
        items: inGroup.map((c) => c.item),
        count: countedItems.length,
        problems: countedItems.filter((i) => i.state.problems.length > 0).length,
      });
    }
    return { id, groups, count: groups.reduce((sum, g) => sum + g.count, 0), problems: groups.reduce((sum, g) => sum + g.problems, 0) };
  };
  const sections = [section('local', visible.filter((c) => c.item.origin !== 'global'))];
  const global = section('global', visible.filter((c) => c.item.origin === 'global'));
  if (global.groups.length > 0) sections.push(global);
  return {
    sections,
    totals,
    shown: sections.reduce((sum, s) => sum + s.count, 0),
    grandTotal: all.filter(counted).length,
  };
}

/** The one trailing tag a row shows: Problem > Disabled > Detected. A Global row needs none: its section says it. */
export function rowBadge(item: TreeItem): RowBadge {
  if (item.state.problems.length > 0) return 'problem';
  if (item.state.disabled) return 'disabled';
  if (item.origin === 'detected') return 'detected';
  return null;
}
