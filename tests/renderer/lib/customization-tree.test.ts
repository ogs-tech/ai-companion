import { describe, expect, it } from 'vitest';
import {
  buildCustomizationTree,
  channelsWith,
  isDisabled,
  rowBadge,
  type TreeInput,
  type TreeItem,
  type TreeOptions,
} from '../../../src/renderer/lib/customization-tree.js';
import type { ChannelId } from '../../../src/shared/channel.js';
import type { ItemStatus } from '../../../src/shared/customization-status.js';
import type { Agent, Entity, Instruction, Skill } from '../../../src/shared/entity.js';
import type { McpServer } from '../../../src/shared/mcp.js';
import type { Hook } from '../../../src/renderer/hooks/use-hooks.js';
import type { PluginListItemIpc } from '../../../src/shared/plugin-ipc-types.js';
import type { DetectedEntity } from '../../../src/shared/detected.js';

const META = { version: '1.0.0', createdAt: '2026-01-01', updatedAt: '2026-01-01' };

type ScopeArg = { ws?: string; folder?: string; plugin?: string };

function base(kind: Entity['kind'], name: string, opts: ScopeArg = {}): Entity {
  return {
    urn: `urn:${kind}:${name}`,
    kind,
    enabled: true,
    name,
    description: `${name} description`,
    scopes: opts.ws !== undefined ? ['workspace'] : ['personal'],
    ...(opts.ws !== undefined ? { scopeId: opts.ws } : {}),
    ...(opts.folder !== undefined ? { folder: opts.folder } : {}),
    metadata: META,
    source:
      opts.plugin !== undefined
        ? { kind: 'plugin', pluginId: opts.plugin, provenance: 'workspace-managed' }
        : { kind: 'workspace' },
  };
}
const skill = (name: string, opts?: ScopeArg): Skill => ({
  ...base('skill', name, opts),
  kind: 'skill',
  content: '',
});
const agent = (name: string, opts?: ScopeArg): Agent => ({
  ...base('agent', name, opts),
  kind: 'agent',
  systemPrompt: '',
});
const instruction = (name: string, opts?: ScopeArg): Instruction => ({
  ...base('instruction', name, opts),
  kind: 'instruction',
  content: '',
});

function mcp(
  name: string,
  opts: { enabled?: boolean; repoPath?: string; detected?: boolean; plugin?: string } = {},
): McpServer {
  return {
    id: `${name}-${opts.repoPath ?? 'global'}`,
    name,
    def: {},
    scope: opts.detected
      ? 'detected'
      : opts.repoPath !== undefined
        ? 'project-shared'
        : opts.plugin !== undefined
          ? 'plugin'
          : 'global',
    ...(opts.repoPath !== undefined ? { repoPath: opts.repoPath } : {}),
    source: opts.detected
      ? { kind: 'detected', detectedId: `d-${name}`, harness: 'claude', importable: true }
      : opts.plugin !== undefined
        ? { kind: 'plugin', pluginId: opts.plugin, provenance: 'workspace-managed' }
        : { kind: 'workspace' },
    enabled: opts.enabled ?? true,
  } as McpServer;
}

function hook(id: string, opts: { enabled?: boolean } = {}): Hook {
  return {
    id,
    event: 'PreToolUse',
    handler: { type: 'command', command: `./${id}.sh` },
    source: { kind: 'workspace' },
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  };
}

function plugin(
  id: string,
  opts: { scope?: 'personal' | 'project'; enabled?: boolean } = {},
): PluginListItemIpc {
  return {
    id,
    origin: 'imported',
    scope: opts.scope ?? 'personal',
    enabled: opts.enabled ?? true,
    installedAt: '2026-01-01',
  };
}

function detected(
  name: string,
  opts: {
    kind?: 'skill' | 'agent' | 'instruction';
    scope?: 'personal' | 'workspace';
    folder?: string;
    harness?: 'claude' | 'cursor';
  } = {},
): DetectedEntity {
  return {
    id: `det-${opts.harness ?? 'claude'}-${name}`,
    kind: opts.kind ?? 'skill',
    name,
    description: '',
    harness: opts.harness ?? 'claude',
    scope: opts.scope ?? 'workspace',
    ...(opts.folder !== undefined ? { folder: opts.folder } : {}),
    path: `/x/${name}`,
    importable: true,
    preview: {},
  };
}

const NONE: Record<string, ItemStatus> = {};
const err = (...channels: ChannelId[]): ItemStatus => ({
  status: 'error',
  channels: Object.fromEntries(channels.map((c) => [c, { status: 'error' }])),
});
const detectedIn = (...channels: ChannelId[]): ItemStatus => ({
  status: 'draft',
  reason: 'detected',
  channels: Object.fromEntries(channels.map((c) => [c, { status: 'draft', reason: 'detected' }])),
});
const ok: ItemStatus = { status: 'installed', channels: { claude: { status: 'installed' } } };

function input(partial: Partial<TreeInput> = {}): TreeInput {
  return {
    skills: [],
    agents: [],
    instructions: [],
    personalInstruction: null,
    mcps: [],
    hooks: [],
    plugins: [],
    detected: [],
    status: NONE,
    ...partial,
  };
}

const WS: TreeOptions = {
  isHome: false,
  localScope: { scope: 'workspace', scopeId: 'ws1' },
  mcpMatchPath: '/r/app',
  aliases: {},
  folders: [],
  multi: false,
  query: '',
  filter: 'all',
};
const HOME: TreeOptions = {
  isHome: true,
  aliases: {},
  folders: [],
  multi: false,
  query: '',
  filter: 'all',
};

type Tree = ReturnType<typeof buildCustomizationTree>;
const section = (tree: Tree, id: 'local' | 'global') => tree.sections.find((s) => s.id === id);
const groupIds = (tree: Tree, id: 'local' | 'global' = 'local') =>
  section(tree, id)?.groups.map((g) => g.id);
/** A group of the local section, or of `sectionId`. */
const group = (tree: Tree, id: string, sectionId: 'local' | 'global' = 'local') =>
  section(tree, sectionId)?.groups.find((g) => g.id === id);
const names = (tree: Tree, id: string, sectionId: 'local' | 'global' = 'local') =>
  group(tree, id, sectionId)?.items.map((i) => i.name);

describe('buildCustomizationTree', () => {
  it('groups by type in fixed order', () => {
    const tree = buildCustomizationTree(
      input({
        skills: [skill('s', { ws: 'ws1' })],
        agents: [agent('a', { ws: 'ws1' })],
        instructions: [instruction('i', { ws: 'ws1' })],
        mcps: [mcp('m', { repoPath: '/r/app' })],
        hooks: [hook('h')],
        plugins: [plugin('p', { scope: 'project' })],
      }),
      HOME,
    );
    expect(tree.sections.map((s) => s.id)).toEqual(['local']);
    expect(groupIds(tree)).toEqual(['instruction', 'skill', 'agent', 'mcp', 'hook', 'plugin']);
    expect(section(tree, 'local')?.groups.map((g) => g.label)).toEqual([
      'Instruções',
      'Skills',
      'Agents',
      'MCP',
      'Hooks',
      'Plugins',
    ]);
  });

  it('splits a workspace into a Workspace section and a read-only Global section', () => {
    const tree = buildCustomizationTree(
      input({
        skills: [
          skill('tdd'),
          skill('review-pr', { ws: 'ws1' }),
          skill('commit-msg', { ws: 'ws1' }),
        ],
        hooks: [hook('h')],
      }),
      WS,
    );
    expect(tree.sections.map((s) => s.id)).toEqual(['local', 'global']);
    expect(names(tree, 'skill')).toEqual(['commit-msg', 'review-pr']);
    expect(names(tree, 'skill', 'global')).toEqual(['tdd']);
    // Hooks have no workspace scoping: inside a workspace they are all Global's.
    expect(groupIds(tree, 'global')).toEqual(['skill', 'hook']);
    expect(section(tree, 'global')).toMatchObject({ count: 2 });
    expect(section(tree, 'local')).toMatchObject({ count: 2 });
    expect(tree.totals.global).toBe(2);
  });

  it('omits the Global section when nothing in it matches, and never keeps its empty groups', () => {
    const tree = buildCustomizationTree(input({ skills: [skill('mine', { ws: 'ws1' })] }), WS);
    expect(tree.sections.map((s) => s.id)).toEqual(['local']);
    const searched = buildCustomizationTree(
      input({ skills: [skill('mine', { ws: 'ws1' }), skill('tdd')] }),
      { ...WS, query: 'mine' },
    );
    expect(searched.sections.map((s) => s.id)).toEqual(['local']);
  });

  it('keeps local and Global items with the same name apart', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('tdd'), skill('tdd', { ws: 'ws1' })] }),
      WS,
    );
    const items = [
      ...(group(tree, 'skill')?.items ?? []),
      ...(group(tree, 'skill', 'global')?.items ?? []),
    ];
    expect(items.map((i) => i.origin)).toEqual(['local', 'global']);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });

  it('treats everything as local while the workspace loads', () => {
    const loading: TreeOptions = {
      isHome: false,
      aliases: {},
      folders: [],
      multi: false,
      query: '',
      filter: 'all',
    };
    const tree = buildCustomizationTree(
      input({ skills: [skill('tdd'), skill('x', { ws: 'ws1' })], hooks: [hook('h')] }),
      loading,
    );
    expect(tree.totals.global).toBe(0);
    expect(tree.sections.map((s) => s.id)).toEqual(['local']);
    expect(group(tree, 'skill')?.items.every((i) => i.origin === 'local')).toBe(true);
  });

  it('Início shows no Global and always lists the singleton instruction', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('tdd')], hooks: [hook('h')], plugins: [plugin('p')] }),
      HOME,
    );
    const instr = group(tree, 'instruction');
    expect(instr?.items).toHaveLength(1);
    expect(instr?.items[0]?.entity).toMatchObject({ kind: 'instruction', value: undefined });
    expect(tree.totals.global).toBe(0);
  });

  it('shows the saved personal instruction as Global inside a workspace', () => {
    const tree = buildCustomizationTree(input({ personalInstruction: instruction('default') }), WS);
    expect(group(tree, 'instruction')?.items[0]?.entity).toMatchObject({
      kind: 'instruction',
      value: undefined,
      placement: 'workspace',
    });
    expect(group(tree, 'instruction', 'global')?.items.map((i) => i.origin)).toEqual(['global']);
  });

  it('placeholder instruction rows are not counted and hide while searching or filtering', () => {
    const tree = buildCustomizationTree(input(), WS);
    expect(group(tree, 'instruction')?.items).toHaveLength(1);
    expect(tree.totals.all).toBe(0);
    expect(tree.shown).toBe(0);
    expect(
      group(buildCustomizationTree(input(), { ...WS, query: 'x' }), 'instruction'),
    ).toBeUndefined();
    expect(
      group(buildCustomizationTree(input(), { ...WS, filter: 'draft' }), 'instruction'),
    ).toBeUndefined();
  });

  it("nests a plugin's items under its row, never in the kind groups", () => {
    const tree = buildCustomizationTree(
      input({
        skills: [skill('own'), skill('from-plugin', { plugin: 'p1' })],
        mcps: [mcp('pm', { plugin: 'p1' })],
        plugins: [plugin('p1')],
      }),
      HOME,
    );
    expect(names(tree, 'skill')).toEqual(['own']);
    expect(group(tree, 'mcp')).toBeUndefined();
    expect(names(tree, 'plugin')).toEqual(['p1']);
    const row = group(tree, 'plugin')?.items[0]?.entity;
    expect(row?.kind === 'plugin' ? row.items.map((i) => i.name) : undefined).toEqual([
      'from-plugin',
      'pm',
    ]);
    expect(group(tree, 'plugin')?.count).toBe(3);
    expect(tree.shown).toBe(tree.grandTotal);
  });

  it('two plugins shipping a same-named agent each list it, under distinct row keys', () => {
    const tree = buildCustomizationTree(
      input({
        agents: [
          agent('code-simplifier', { plugin: 'code-simplifier' }),
          agent('code-simplifier', { plugin: 'pr-review-toolkit' }),
        ],
        plugins: [plugin('code-simplifier'), plugin('pr-review-toolkit')],
      }),
      HOME,
    );
    const children = (group(tree, 'plugin')?.items ?? []).map((r) =>
      r.entity.kind === 'plugin' ? r.entity.items : [],
    );
    expect(children.map((c) => c.map((i) => i.name))).toEqual([
      ['code-simplifier'],
      ['code-simplifier'],
    ]);
    expect(children[0]?.[0]?.key).not.toBe(children[1]?.[0]?.key);
  });

  it('keeps an item whose plugin is not listed in its kind group', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('orphan', { plugin: 'gone' })] }),
      HOME,
    );
    expect(names(tree, 'skill')).toEqual(['orphan']);
  });

  it('search: a matching item shows its plugin with only the match; a matching plugin shows all it ships', () => {
    const base = input({
      skills: [skill('alpha', { plugin: 'kit' }), skill('beta', { plugin: 'kit' })],
      plugins: [plugin('kit')],
    });
    const nested = (tree: Tree) => {
      const e = group(tree, 'plugin')?.items[0]?.entity;
      return e?.kind === 'plugin' ? e.items.map((i) => i.name) : undefined;
    };
    expect(nested(buildCustomizationTree(base, { ...HOME, query: 'alpha' }))).toEqual(['alpha']);
    expect(nested(buildCustomizationTree(base, { ...HOME, query: 'kit' }))).toEqual([
      'alpha',
      'beta',
    ]);
    expect(
      group(buildCustomizationTree(base, { ...HOME, query: 'zzz' }), 'plugin'),
    ).toBeUndefined();
  });

  it("a disabled plugin's items stay listed under it and read desativado (Review Focus 5)", () => {
    const tree = buildCustomizationTree(
      input({
        skills: [skill('brainstorming', { plugin: 'superpowers' })],
        plugins: [plugin('superpowers', { enabled: false })],
        status: { 'urn:skill:brainstorming': ok },
      }),
      HOME,
    );
    const row = group(tree, 'plugin')?.items[0]?.entity;
    const item = row?.kind === 'plugin' ? row.items[0] : undefined;
    expect(item?.name).toBe('brainstorming');
    expect(item !== undefined && isDisabled(item)).toBe(true);
  });

  it('computes chip totals on the searched set', () => {
    const tree = buildCustomizationTree(
      input({
        skills: [skill('review-pr', { ws: 'ws1' }), skill('commit-msg', { ws: 'ws1' })],
        mcps: [mcp('off', { enabled: false })],
        status: { 'urn:skill:review-pr': err('cursor'), 'urn:skill:commit-msg': ok },
      }),
      { ...WS, query: 'rev' },
    );
    expect(tree.totals).toEqual({
      all: 1,
      global: 0,
      installed: 0,
      draft: 0,
      error: 1,
      byChannel: { draft: {}, error: { cursor: 1 } },
    });
  });

  it('a status chip keeps only the items with that status and counts errors per group', () => {
    const status = {
      'urn:skill:a': err('claude'),
      'urn:mcp:m': err('cursor'),
      'urn:skill:b': ok,
      'urn:mcp:n': detectedIn('cursor'),
    };
    const skills = [skill('a', { ws: 'ws1' }), skill('b', { ws: 'ws1' })];
    const mcps = [mcp('m', { repoPath: '/r/app' }), mcp('n', { repoPath: '/r/app' })];
    const errors = buildCustomizationTree(input({ skills, mcps, status }), {
      ...WS,
      filter: 'error',
    });
    expect(names(errors, 'skill')).toEqual(['a']);
    expect(names(errors, 'mcp')).toEqual(['m']);
    expect(group(errors, 'skill')).toMatchObject({ count: 1, problems: 1 });
    expect(errors.shown).toBe(2);
    expect(
      names(
        buildCustomizationTree(input({ skills, mcps, status }), { ...WS, filter: 'installed' }),
        'skill',
      ),
    ).toEqual(['b']);
    expect(
      names(
        buildCustomizationTree(input({ skills, mcps, status }), { ...WS, filter: 'draft' }),
        'mcp',
      ),
    ).toEqual(['n']);
  });

  it('the channel sub-filter keeps the items with that status on that channel, and counts per channel', () => {
    const status = {
      'urn:skill:a': err('claude'),
      'urn:skill:b': err('claude', 'cursor'),
      // Error overall, but only a conflict on Cursor: it is not an error *on Cursor*.
      'urn:skill:c': {
        status: 'error',
        channels: { claude: { status: 'error' }, cursor: { status: 'draft', reason: 'detected' } },
      } satisfies ItemStatus,
    };
    const skills = [
      skill('a', { ws: 'ws1' }),
      skill('b', { ws: 'ws1' }),
      skill('c', { ws: 'ws1' }),
    ];
    const tree = buildCustomizationTree(input({ skills, status }), {
      ...WS,
      filter: 'error',
      channel: 'cursor',
    });
    expect(names(tree, 'skill')).toEqual(['b']);
    expect(tree.totals.byChannel.error).toEqual({ claude: 3, cursor: 1 });
    expect(tree.totals.byChannel.draft).toEqual({});
  });

  it('an active chip with zero matches yields no groups and shown 0', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('a', { ws: 'ws1' }), skill('g')] }),
      { ...WS, filter: 'draft' },
    );
    expect(tree.sections).toEqual([{ id: 'local', groups: [], count: 0, rows: 0, problems: 0 }]);
    expect(tree.shown).toBe(0);
    expect(tree.matched).toBe(0);
    expect(tree.grandTotal).toBe(2);
  });

  it('lists detected items in their group but counts only the app\'s own', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('a')], detected: [detected('d', { scope: 'personal' })] }),
      HOME,
    );
    const skills = tree.sections[0]?.groups.find((g) => g.id === 'skill');
    expect(skills?.items.map((i) => i.name)).toEqual(['a', 'd']);
    expect(skills?.count).toBe(1);
    expect(skills?.rows).toBe(2);
    expect(tree.grandTotal).toBe(1);
    expect(tree.matched).toBe(tree.sections.reduce((n, s) => n + s.rows, 0));
  });

  it('hides empty groups except Skills and Agents when unfiltered', () => {
    const tree = buildCustomizationTree(input({ mcps: [mcp('m')] }), HOME);
    expect(groupIds(tree)).toEqual(['instruction', 'skill', 'agent', 'mcp']);
    const searched = buildCustomizationTree(input({ mcps: [mcp('m')] }), { ...HOME, query: 'm' });
    expect(groupIds(searched)).toEqual(['mcp']);
  });

  it('makes disabled MCP, hook and plugin a draft, whatever the report says', () => {
    const tree = buildCustomizationTree(
      input({
        mcps: [mcp('m', { enabled: false })],
        hooks: [hook('h', { enabled: false }), hook('on')],
        plugins: [plugin('p', { enabled: false })],
        status: { 'urn:mcp:m': err('claude') },
      }),
      HOME,
    );
    expect(group(tree, 'mcp')?.items[0] && isDisabled(group(tree, 'mcp')!.items[0]!)).toBe(true);
    expect(group(tree, 'hook')?.items.map(isDisabled)).toEqual([true, false]);
    expect(group(tree, 'plugin')?.items[0]?.status).toEqual({
      status: 'draft',
      reason: 'disabled',
      channels: {},
    });
    expect(tree.totals).toMatchObject({ draft: 3, error: 0 });
  });

  it('counts an error once: a plugin row rolling up its item’s error is not a second one', () => {
    const tree = buildCustomizationTree(
      input({
        mcps: [mcp('m', { plugin: 'p' })],
        plugins: [plugin('p'), plugin('broken')],
        status: {
          'urn:mcp:m': err('claude'),
          'urn:plugin:p': err('claude'),
          'urn:plugin:broken': err('claude'),
        },
      }),
      HOME,
    );
    // `p` only mirrors its MCP's error; `broken` has one of its own (nothing it ships explains it).
    expect(tree.totals).toMatchObject({ error: 2, byChannel: { error: { claude: 2 } } });
    expect(group(tree, 'plugin')).toMatchObject({ count: 3, problems: 2 });
    expect(group(tree, 'plugin')?.items.find((i) => i.name === 'p')?.status?.status).toBe('error');
  });

  it('a detected MCP server reporting enabled false is not "desativado" — only the user’s own can be turned off', () => {
    const tree = buildCustomizationTree(
      input({ mcps: [{ ...mcp('claude-ai-Gmail', { detected: true }), enabled: false }] }),
      HOME,
    );
    const item = group(tree, 'mcp')?.items[0];
    expect(item && isDisabled(item)).toBe(false);
    expect(item?.status).toMatchObject({ status: 'draft', reason: 'detected' });
  });

  it('detected rows are drafts even before the report arrives; nothing else has a status meanwhile', () => {
    const withDetected = buildCustomizationTree(input({ detected: [detected('ghost')] }), WS);
    expect(withDetected.totals).toMatchObject({ draft: 1, error: 0 });
    expect(group(withDetected, 'skill')?.items[0]?.origin).toBe('detected');
    const empty = buildCustomizationTree(input({ skills: [skill('a', { ws: 'ws1' })] }), WS);
    expect(empty.totals).toMatchObject({ installed: 0, draft: 0, error: 0 });
    expect(group(empty, 'skill')?.items[0]?.status).toBeUndefined();
  });

  it('lists detected items after local and Global ones, one row per harness', () => {
    const tree = buildCustomizationTree(
      input({
        skills: [skill('z', { ws: 'ws1' }), skill('g')],
        detected: [
          detected('a'),
          detected('a', { harness: 'cursor' }),
          detected('home', { scope: 'personal' }),
        ],
      }),
      WS,
    );
    // Detected items are the workspace's own (found in its folders), listed after its saved ones.
    expect(group(tree, 'skill')?.items.map((i) => `${i.origin}:${i.name}`)).toEqual([
      'local:z',
      'detected:a',
      'detected:a',
    ]);
    expect(new Set(group(tree, 'skill')?.items.map((i) => i.key)).size).toBe(3);
    expect(names(tree, 'skill', 'global')).toEqual(['g']);
  });

  it('marks detected MCP and hooks as detected', () => {
    const detectedHook: Hook = {
      ...hook('dh'),
      source: { kind: 'detected', detectedId: 'x', harness: 'cursor', importable: true },
    };
    const tree = buildCustomizationTree(
      input({ mcps: [mcp('dm', { detected: true, repoPath: '/r/app' })], hooks: [detectedHook] }),
      WS,
    );
    expect(group(tree, 'mcp')?.items[0]?.origin).toBe('detected');
    expect(group(tree, 'hook')?.items[0]?.origin).toBe('detected');
  });

  it('lists an MCP server detected in the user’s own config under Global, one found in the workspace under it', () => {
    const tree = buildCustomizationTree(
      input({
        mcps: [
          mcp('home', { detected: true }),
          mcp('here', { detected: true, repoPath: '/r/app' }),
        ],
      }),
      WS,
    );
    expect(names(tree, 'mcp', 'local')).toEqual(['here']);
    expect(names(tree, 'mcp', 'global')).toEqual(['home']);
    // Still a detected row (Importar, draft) wherever it is listed.
    const globalMcp = tree.sections
      .find((s) => s.id === 'global')
      ?.groups.find((g) => g.id === 'mcp')?.items[0];
    expect(globalMcp?.origin).toBe('detected');
  });

  it('keeps every detected MCP server in Início’s own section', () => {
    const tree = buildCustomizationTree(input({ mcps: [mcp('home', { detected: true })] }), HOME);
    expect(names(tree, 'mcp', 'local')).toEqual(['home']);
  });

  it('tags rows with their folder in a multi-folder workspace', () => {
    const multi: TreeOptions = {
      ...WS,
      multi: true,
      folders: ['/r/api'],
      aliases: { '/r/api': 'api' },
    };
    const tree = buildCustomizationTree(
      input({
        skills: [skill('s', { ws: 'ws1', folder: '/r/api' })],
        detected: [detected('d', { folder: '/r/api' })],
      }),
      multi,
    );
    expect(group(tree, 'skill')?.items.map((i) => i.folderAlias)).toEqual(['api', 'api']);
    const instr = group(tree, 'instruction')?.items ?? [];
    expect(instr.map((i) => i.entity)).toEqual([
      expect.objectContaining({ placement: 'workspace' }),
      expect.objectContaining({ placement: 'folder', folder: '/r/api' }),
    ]);
    expect(instr[1]?.folderAlias).toBe('api');
  });

  it('grandTotal ignores query and filter', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('a', { ws: 'ws1' }), skill('b', { ws: 'ws1' })], hooks: [hook('h')] }),
      { ...WS, query: 'a', filter: 'error' },
    );
    expect(tree.grandTotal).toBe(3);
  });
});

describe('rowBadge', () => {
  const item = (patch: Partial<TreeItem>): TreeItem => ({
    key: 'k',
    urn: 'urn:skill:x',
    name: 'x',
    origin: 'local',
    entity: { kind: 'skill', value: skill('x') },
    ...patch,
  });
  it('shows the status unless installed', () => {
    expect(rowBadge(item({ status: err('claude') }))).toBe('error');
    expect(rowBadge(item({ origin: 'global', status: detectedIn('cursor') }))).toBe('draft');
    // The Global section names the origin; its rows carry no tag of their own.
    expect(rowBadge(item({ origin: 'global' }))).toBeNull();
    expect(rowBadge(item({ status: ok }))).toBeNull();
    expect(rowBadge(item({}))).toBeNull();
  });

  it('channelsWith lists the channels with a status in registry order', () => {
    const status: ItemStatus = {
      status: 'error',
      channels: { cursor: { status: 'error' }, claude: { status: 'error' } },
    };
    expect(channelsWith(item({ status }), 'error')).toEqual(['claude', 'cursor']);
    expect(channelsWith(item({ status }), 'draft')).toEqual([]);
  });
});
