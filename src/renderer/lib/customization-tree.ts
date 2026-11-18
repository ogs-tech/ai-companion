import { CHANNEL_IDS, type ChannelId } from '../../shared/channel.js';
import { CUSTOMIZATION_KINDS } from '../../shared/customization-kind.js';
import type { DetectedEntity } from '../../shared/detected.js';
import {
  entityUrn,
  isWorkspaceInstruction,
  type Agent,
  type Entity,
  type Instruction,
  type Skill,
} from '../../shared/entity.js';
import type { McpServer } from '../../shared/mcp.js';
import type { PluginListItemIpc } from '../../shared/plugin-ipc-types.js';
import type { Hook } from '../hooks/use-hooks.js';
import { describeHookHandler, hookRowLabel } from './describe-hook-handler.js';
import { matchesQuery } from './control-panel-filter.js';
import type { CustomizationStatus, ItemStatus } from '../../shared/customization-status.js';

/** The state chips: everything, or one status (`installed` · `draft` · `error`). */
export type TreeFilter = 'all' | CustomizationStatus;
export type TreeGroupId = 'instruction' | 'skill' | 'agent' | 'mcp' | 'hook' | 'plugin';
export type TreeOrigin = 'local' | 'global' | 'detected';
/** What a row's trailing slot shows; `installed` is silent. */
export type RowBadge = 'error' | 'draft' | null;
/** `local` = the open workspace's own items (and what was detected in it); `global` = Início's, read-only here. */
export type TreeSectionId = 'local' | 'global';

/** Where an instruction row sits: Global's singleton, the workspace-wide set, or one folder of a multi-folder workspace. */
export type InstructionPlacement = 'personal' | 'workspace' | 'folder';

export type TreeEntity =
  /**
   * `value` undefined = a placeholder row: the level has no saved instruction yet, so the row is the
   * place to create one (and to apply a `detected` file found there). Placeholders are never counted.
   */
  | {
      kind: 'instruction';
      value: Instruction | undefined;
      placement: InstructionPlacement;
      folder?: string;
      detected?: DetectedEntity;
    }
  | { kind: 'skill'; value: Skill }
  | { kind: 'agent'; value: Agent }
  | { kind: 'mcp'; value: McpServer }
  | { kind: 'hook'; value: Hook }
  /** A plugin row expands to what it ships (`items`, search- and chip-filtered); those are never listed in the kind groups. */
  | { kind: 'plugin'; value: PluginListItemIpc; items: TreeItem[] }
  /** A detected skill/agent; detected MCP servers and hooks keep their own kind. */
  | { kind: 'detected'; value: DetectedEntity };

export interface TreeItem {
  /** Unique within the tree: the same name can exist locally and in Global, or be detected in two harnesses. */
  key: string;
  urn: string;
  name: string;
  origin: TreeOrigin;
  folderAlias?: string;
  /** From `customization.status`; absent when nothing was checked yet (a placeholder, no channel on, still loading). */
  status?: ItemStatus;
  entity: TreeEntity;
}

export interface TreeGroup {
  id: TreeGroupId;
  label: string;
  items: TreeItem[];
  /** The app's own items (detected ones are listed, not counted). */
  count: number;
  /** Every listed item, detected included. */
  rows: number;
  /** Items with status `error`: the group header's ⚠. */
  problems: number;
}

export interface TreeSection {
  id: TreeSectionId;
  groups: TreeGroup[];
  count: number;
  rows: number;
  problems: number;
}

export interface TreeTotals {
  all: number;
  global: number;
  installed: number;
  draft: number;
  error: number;
  /** Per channel, how many draft / error items have that status there — the channel sub-chips. */
  byChannel: Record<'draft' | 'error', Partial<Record<ChannelId, number>>>;
}

export interface CustomizationTree {
  /**
   * Inside a workspace: the Workspace section, then — when anything in it matches — the Global one.
   * At Início (or while the workspace loads) a single `local` section.
   */
  sections: TreeSection[];
  /** Chip counts, on the search-filtered set. */
  totals: TreeTotals;
  /** The app's own items the groups list under the current search and chip. */
  shown: number;
  /** Every row the groups list, detected included: zero means the search or chip found nothing. */
  matched: number;
  /** The app's own items with no search and no chip — what the header names. Detected ones are not counted. */
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
  /** urn → status, from `customization.status`. */
  status: Readonly<Record<string, ItemStatus>>;
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
  /** Narrows a `draft` / `error` filter to the items with that status on this channel. */
  channel?: ChannelId;
}

const DETECTED_STATUS: ItemStatus = { status: 'draft', reason: 'detected', channels: {} };
const DISABLED_STATUS: ItemStatus = { status: 'draft', reason: 'disabled', channels: {} };

const GROUPS: ReadonlyArray<{ id: TreeGroupId; label: string }> = [
  ...CUSTOMIZATION_KINDS.map((k) => ({ id: k.kind, label: k.label })),
  { id: 'plugin', label: 'Plugins' },
];

const GROUP_ORDER = Object.fromEntries(GROUPS.map((g, i) => [g.id, i])) as Record<
  TreeGroupId,
  number
>;

const ORIGIN_ORDER: Record<TreeOrigin, number> = { local: 0, global: 1, detected: 2 };

/** What a level's instruction row is called; a folder's adds its folder tag, an extra workspace one shows its own name. */
const INSTRUCTION_LABEL = 'Instruções';

/** A candidate row before search and chip filtering. */
interface Candidate {
  item: TreeItem;
  group: TreeGroupId;
  /** Fields the search matches against. */
  haystack: ReadonlyArray<string | undefined>;
  /** The section the row is listed in when its origin alone does not say (a detected item found outside the workspace). */
  section?: TreeSectionId;
  /** Placeholder rows: shown only while nothing narrows the list (or when `alwaysMatch`), never counted. */
  placeholder?: { alwaysMatch: boolean };
  /** Keeps the row's position instead of sorting it by name (instruction rows follow their level's order). */
  order?: number;
  /** Set on an item a plugin ships: the plugin's id. It is listed under that plugin's row, not in its kind group. */
  parent?: string;
}

/** A server configured in the open workspace's own folder (`matchPath`); everything is local without one (Início). */
export function isMcpLocal(server: McpServer, matchPath: string | undefined): boolean {
  if (matchPath === undefined) return true;
  const projectScoped =
    server.scope === 'project-local' ||
    server.scope === 'project-shared' ||
    server.scope === 'detected';
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
  fields: {
    identity: string;
    urn: string;
    name: string;
    origin: TreeOrigin;
    folder?: string | undefined;
    disabled?: boolean;
    entity: TreeEntity;
  },
  input: TreeInput,
  options: TreeOptions,
): TreeItem {
  const folderAlias = aliasOf(fields.folder, options);
  // The lists already say what is off or detected, so those rows read right before the status report arrives.
  const status =
    fields.disabled === true
      ? DISABLED_STATUS
      : (input.status[fields.urn] ?? (fields.origin === 'detected' ? DETECTED_STATUS : undefined));
  return {
    key: `${fields.origin}:${folderAlias ?? ''}:${fields.identity}`,
    urn: fields.urn,
    name: fields.name,
    origin: fields.origin,
    ...(folderAlias !== undefined ? { folderAlias } : {}),
    ...(status !== undefined ? { status } : {}),
    entity: fields.entity,
  };
}

function instructionCandidates(input: TreeInput, options: TreeOptions): Candidate[] {
  const out: Candidate[] = [];
  const detectedInstruction = (
    scope: 'personal' | 'workspace',
    folder: string | undefined,
  ): DetectedEntity | undefined =>
    input.detected.find(
      (d) =>
        d.kind === 'instruction' &&
        d.scope === scope &&
        (scope === 'personal' || d.folder === folder),
    );
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
      item: makeItem(
        { identity, urn: value?.urn ?? identity, name, origin, folder, entity },
        input,
        options,
      ),
      group: 'instruction',
      haystack:
        placement === 'personal'
          ? ['instructions', value?.name, value?.description]
          : [value?.name, value?.description],
      ...(value === undefined ? { placeholder: { alwaysMatch: placement === 'personal' } } : {}),
      order,
    };
  };

  if (options.isHome) {
    out.push(
      row(
        input.personalInstruction ?? undefined,
        'personal',
        'local',
        INSTRUCTION_LABEL,
        undefined,
        0,
      ),
    );
    return out;
  }
  const local = options.localScope;
  if (local !== undefined) {
    const own = input.instructions.filter(
      (i) => isWorkspaceInstruction(i) && i.scopeId === local.scopeId,
    );
    const wide = own.filter((i) => i.folder === undefined || !options.multi);
    const [primary, ...extras] = [...wide].sort((a, b) => a.name.localeCompare(b.name));
    let order = 0;
    out.push(row(primary, 'workspace', 'local', INSTRUCTION_LABEL, undefined, order++));
    for (const extra of extras)
      out.push(row(extra, 'workspace', 'local', extra.name, undefined, order++));
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
    out.push(
      row(input.personalInstruction, 'personal', origin, INSTRUCTION_LABEL, undefined, 1000),
    );
  }
  return out;
}

function pluginOrigin(plugin: PluginListItemIpc | undefined, options: TreeOptions): TreeOrigin {
  return options.isHome || options.localScope === undefined || plugin?.scope === 'project'
    ? 'local'
    : 'global';
}

function candidates(input: TreeInput, options: TreeOptions): Candidate[] {
  const out: Candidate[] = instructionCandidates(input, options);
  const pluginsById = new Map(input.plugins.map((p) => [p.id, p]));
  /** A plugin item: placed where its plugin is, and off (`draft · desativado`) while the plugin is off. */
  const fromPlugin = (pluginId: string): { origin: TreeOrigin; disabled: boolean } => {
    const plugin = pluginsById.get(pluginId);
    return { origin: pluginOrigin(plugin, options), disabled: plugin?.enabled === false };
  };
  /** Nests a plugin's item under its row; one whose plugin is not listed stays in its kind group rather than vanish. */
  const parentOf = (
    source: Entity['source'] | McpServer['source'] | Hook['source'],
  ): { parent: string } | Record<string, never> =>
    source.kind === 'plugin' && pluginsById.has(source.pluginId) ? { parent: source.pluginId } : {};

  const entityRows = (kind: 'skill' | 'agent', list: ReadonlyArray<Skill | Agent>): void => {
    for (const value of list) {
      const urn = entityUrn(kind, value.name);
      const entity = (kind === 'skill' ? { kind, value } : { kind, value }) as TreeEntity;
      const plugin =
        value.source.kind === 'plugin'
          ? fromPlugin(value.source.pluginId)
          : { origin: entityOrigin(value, options) };
      out.push({
        item: makeItem(
          {
            // Two plugins may ship a same-named item (same urn): the plugin keeps their rows apart.
            identity: value.source.kind === 'plugin' ? `${value.source.pluginId}:${urn}` : urn,
            urn,
            name: value.name,
            folder: value.folder,
            entity,
            ...plugin,
          },
          input,
          options,
        ),
        group: kind,
        ...parentOf(value.source),
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
        {
          identity: `detected:${d.id}`,
          urn: entityUrn(d.kind, d.name),
          name: d.name,
          origin: 'detected',
          folder: d.folder,
          entity: { kind: 'detected', value: d },
        },
        input,
        options,
      ),
      group: d.kind,
      haystack: [d.name, d.description],
    });
  }

  for (const server of input.mcps) {
    const local = isMcpLocal(server, options.mcpMatchPath);
    const origin: TreeOrigin =
      server.source.kind === 'detected' ? 'detected' : local ? 'local' : 'global';
    const urn = entityUrn('mcp', server.name);
    // Only the user's own servers can be turned off; a detected one (e.g. a claude.ai connector) reports
    // `enabled: false` just because the app does not manage it.
    const own = { origin, disabled: server.source.kind === 'workspace' && !server.enabled };
    out.push({
      item: makeItem(
        {
          identity: `mcp:${server.id}`,
          urn,
          name: server.name,
          entity: { kind: 'mcp', value: server },
          ...(server.source.kind === 'plugin' ? fromPlugin(server.source.pluginId) : own),
        },
        input,
        options,
      ),
      group: 'mcp',
      ...parentOf(server.source),
      // One found in the user's own config (`~/.claude.json`, `~/.cursor/mcp.json`) applies to every workspace.
      ...(origin === 'detected' && !local ? { section: 'global' as const } : {}),
      haystack: [server.name],
    });
  }

  // Hooks have no workspace scoping: all of them are Global's, read from inside a workspace.
  const hookOrigin: TreeOrigin =
    options.isHome || options.localScope === undefined ? 'local' : 'global';
  for (const value of input.hooks) {
    const urn = entityUrn('hook', value.id);
    const own = {
      origin: value.source.kind === 'detected' ? ('detected' as const) : hookOrigin,
      disabled: value.enabled === false,
    };
    out.push({
      item: makeItem(
        {
          identity: urn,
          urn,
          name: hookRowLabel(value),
          entity: { kind: 'hook', value },
          ...(value.source.kind === 'plugin' ? fromPlugin(value.source.pluginId) : own),
        },
        input,
        options,
      ),
      group: 'hook',
      ...parentOf(value.source),
      haystack: [describeHookHandler(value.handler), value.event],
    });
  }

  for (const value of input.plugins) {
    // Plugins are not an Entity kind, but the status report names them `urn:plugin:<id>` (children roll up in main).
    const urn = `urn:plugin:${value.id}`;
    const entity: TreeEntity = { kind: 'plugin', value, items: [] };
    out.push({
      item: makeItem(
        {
          identity: urn,
          urn,
          name: value.id,
          origin: pluginOrigin(value, options),
          disabled: !value.enabled,
          entity,
        },
        input,
        options,
      ),
      group: 'plugin',
      haystack: [value.id],
    });
  }
  return out;
}

function passesFilter(item: TreeItem, filter: TreeFilter, channel: ChannelId | undefined): boolean {
  if (filter === 'all') return true;
  if (item.status?.status !== filter) return false;
  return channel === undefined || item.status.channels[channel]?.status === filter;
}

function totalsOf(items: readonly TreeItem[]): TreeTotals {
  const byChannel: TreeTotals['byChannel'] = { draft: {}, error: {} };
  for (const { status } of items) {
    if (status === undefined || status.status === 'installed') continue;
    const counts = byChannel[status.status];
    for (const [channel, c] of Object.entries(status.channels) as Array<
      [ChannelId, NonNullable<ItemStatus['channels'][ChannelId]>]
    >) {
      if (c.status === status.status) counts[channel] = (counts[channel] ?? 0) + 1;
    }
  }
  const count = (s: CustomizationStatus): number =>
    items.filter((i) => i.status?.status === s).length;
  return {
    all: items.length,
    global: items.filter((i) => i.origin === 'global').length,
    installed: count('installed'),
    draft: count('draft'),
    error: count('error'),
    byChannel,
  };
}

function compare(a: Candidate, b: Candidate): number {
  if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
  return (
    ORIGIN_ORDER[a.item.origin] - ORIGIN_ORDER[b.item.origin] ||
    a.item.name.localeCompare(b.item.name)
  );
}

/**
 * Every list the Customizações panel shows, as scope sections › type groups › items with origin, state and counts.
 * Search first (the chips count on its result), then the chip, then grouping and sorting.
 */
export function buildCustomizationTree(input: TreeInput, options: TreeOptions): CustomizationTree {
  const all = candidates(input, options);
  const narrowing = options.query.trim() !== '' || options.filter !== 'all';
  const counted = (c: Candidate): boolean => c.placeholder === undefined;
  const owned = (item: TreeItem): boolean => item.origin !== 'detected';
  const isPluginRow = (c: Candidate): boolean => c.item.entity.kind === 'plugin';

  const ownMatch = (c: Candidate): boolean =>
    c.placeholder !== undefined
      ? options.filter === 'all' &&
        (options.query.trim() === '' ||
          (c.placeholder.alwaysMatch && matchesQuery(options.query, ...c.haystack)))
      : matchesQuery(options.query, ...c.haystack);
  // A plugin that matches brings everything it ships; one that doesn't still shows when something it ships matches.
  const matchedPlugins = new Set(
    all.filter((c) => isPluginRow(c) && ownMatch(c)).map((c) => c.item.name),
  );
  const searchedChildren = all.filter(
    (c) => c.parent !== undefined && (ownMatch(c) || matchedPlugins.has(c.parent)),
  );
  const searchedParents = new Set(searchedChildren.map((c) => c.parent));
  const searched = [
    ...all.filter(
      (c) =>
        c.parent === undefined &&
        (ownMatch(c) || (isPluginRow(c) && searchedParents.has(c.item.name))),
    ),
    ...searchedChildren,
  ];
  // A plugin row's status is its items' rolled up in main: when an item it ships carries that status, the item
  // is the one counted, or `N com erro` would say 2 for one broken MCP.
  const rolledUp = new Set(
    all.flatMap((c) =>
      c.parent !== undefined && c.item.status !== undefined
        ? [`${c.parent}:${c.item.status.status}`]
        : [],
    ),
  );
  const forCounting = (item: TreeItem): TreeItem => {
    if (item.entity.kind !== 'plugin' || item.status === undefined) return item;
    if (!rolledUp.has(`${item.name}:${item.status.status}`)) return item;
    const { status: _rolledUp, ...rest } = item;
    return rest;
  };
  const totals = totalsOf(searched.filter(counted).map((c) => forCounting(c.item)));

  const childrenOf = new Map<string, Candidate[]>();
  for (const c of searchedChildren) {
    if (c.parent === undefined || !passesFilter(c.item, options.filter, options.channel)) continue;
    childrenOf.set(c.parent, [...(childrenOf.get(c.parent) ?? []), c]);
  }
  const visible = searched
    .filter((c) => c.parent === undefined)
    .filter(
      (c) =>
        c.placeholder !== undefined ||
        passesFilter(c.item, options.filter, options.channel) ||
        (isPluginRow(c) && childrenOf.has(c.item.name)),
    )
    .map((c): Candidate => {
      if (c.item.entity.kind !== 'plugin') return c;
      const items = (childrenOf.get(c.item.name) ?? [])
        .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || compare(a, b))
        .map((k) => k.item);
      return { ...c, item: { ...c.item, entity: { ...c.item.entity, items } } };
    });

  const section = (id: TreeSectionId, members: readonly Candidate[]): TreeSection => {
    const groups: TreeGroup[] = [];
    for (const { id: groupId, label } of GROUPS) {
      const inGroup = members.filter((c) => c.group === groupId).sort(compare);
      // Skills and Agents stay in the scope's own section as the place to create, while nothing narrows the list.
      const keepEmpty =
        id === 'local' && !narrowing && (groupId === 'skill' || groupId === 'agent');
      if (inGroup.length === 0 && !keepEmpty) continue;
      // A plugin's nested items count in its group, so the header totals still add up.
      const countedItems = inGroup
        .filter(counted)
        .flatMap((c) =>
          c.item.entity.kind === 'plugin' ? [c.item, ...c.item.entity.items] : [c.item],
        );
      groups.push({
        id: groupId,
        label,
        items: inGroup.map((c) => c.item),
        count: countedItems.filter(owned).length,
        rows: countedItems.length,
        problems: countedItems.map(forCounting).filter((i) => i.status?.status === 'error').length,
      });
    }
    return {
      id,
      groups,
      count: groups.reduce((sum, g) => sum + g.count, 0),
      rows: groups.reduce((sum, g) => sum + g.rows, 0),
      problems: groups.reduce((sum, g) => sum + g.problems, 0),
    };
  };
  const sectionOf = (c: Candidate): TreeSectionId =>
    c.section ?? (c.item.origin === 'global' ? 'global' : 'local');
  const sections = [
    section(
      'local',
      visible.filter((c) => sectionOf(c) === 'local'),
    ),
  ];
  const global = section(
    'global',
    visible.filter((c) => sectionOf(c) === 'global'),
  );
  if (global.groups.length > 0) sections.push(global);
  return {
    sections,
    totals,
    shown: sections.reduce((sum, s) => sum + s.count, 0),
    matched: sections.reduce((sum, s) => sum + s.rows, 0),
    grandTotal: all.filter((c) => counted(c) && owned(c.item)).length,
  };
}

/** The one trailing tag a row shows: its status when it isn't `installed`. A Global row needs none: its section says it. */
export function rowBadge(item: TreeItem): RowBadge {
  const status = item.status?.status;
  return status === 'error' || status === 'draft' ? status : null;
}

/** The channels where an item has `status` (registry order), e.g. where an error or a conflict is. */
export function channelsWith(item: TreeItem, status: CustomizationStatus): ChannelId[] {
  const channels = item.status?.channels ?? {};
  return CHANNEL_IDS.filter((id) => channels[id]?.status === status);
}

export function isDisabled(item: TreeItem): boolean {
  return item.status?.reason === 'disabled';
}
