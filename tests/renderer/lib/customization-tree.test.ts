import { describe, expect, it } from 'vitest';
import {
  buildCustomizationTree,
  rowBadge,
  type TreeInput,
  type TreeItem,
  type TreeOptions,
} from '../../../src/renderer/lib/customization-tree.js';
import type { ChannelProblems } from '../../../src/renderer/lib/entity-health.js';
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
    name,
    description: `${name} description`,
    scopes: opts.ws !== undefined ? ['workspace'] : ['personal'],
    ...(opts.ws !== undefined ? { scopeId: opts.ws } : {}),
    ...(opts.folder !== undefined ? { folder: opts.folder } : {}),
    metadata: META,
    source: opts.plugin !== undefined ? { kind: 'plugin', pluginId: opts.plugin, provenance: 'workspace-managed' } : { kind: 'workspace' },
  };
}
const skill = (name: string, opts?: ScopeArg): Skill => ({ ...base('skill', name, opts), kind: 'skill', content: '' });
const agent = (name: string, opts?: ScopeArg): Agent => ({ ...base('agent', name, opts), kind: 'agent', systemPrompt: '' });
const instruction = (name: string, opts?: ScopeArg): Instruction => ({ ...base('instruction', name, opts), kind: 'instruction', content: '' });

function mcp(name: string, opts: { enabled?: boolean; repoPath?: string; detected?: boolean; plugin?: string } = {}): McpServer {
  return {
    id: `${name}-${opts.repoPath ?? 'global'}`,
    name,
    def: {},
    scope: opts.detected ? 'detected' : opts.repoPath !== undefined ? 'project-shared' : opts.plugin !== undefined ? 'plugin' : 'global',
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

function plugin(id: string, opts: { scope?: 'personal' | 'project'; enabled?: boolean } = {}): PluginListItemIpc {
  return { id, origin: 'imported', scope: opts.scope ?? 'personal', enabled: opts.enabled ?? true, installedAt: '2026-01-01' };
}

function detected(name: string, opts: { kind?: 'skill' | 'agent' | 'instruction'; scope?: 'personal' | 'workspace'; folder?: string; harness?: 'claude' | 'cursor' } = {}): DetectedEntity {
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

const NONE: ChannelProblems = new Map();

function input(partial: Partial<TreeInput> = {}): TreeInput {
  return {
    skills: [], agents: [], instructions: [], personalInstruction: null,
    mcps: [], hooks: [], plugins: [], detected: [], problems: NONE,
    ...partial,
  };
}

const WS: TreeOptions = {
  isHome: false, localScope: { scope: 'workspace', scopeId: 'ws1' }, mcpMatchPath: '/r/app',
  aliases: {}, folders: [], multi: false, query: '', filter: 'all',
};
const HOME: TreeOptions = { isHome: true, aliases: {}, folders: [], multi: false, query: '', filter: 'all' };

type Tree = ReturnType<typeof buildCustomizationTree>;
const section = (tree: Tree, id: 'local' | 'global') => tree.sections.find((s) => s.id === id);
const groupIds = (tree: Tree, id: 'local' | 'global' = 'local') => section(tree, id)?.groups.map((g) => g.id);
/** A group of the local section, or of `sectionId`. */
const group = (tree: Tree, id: string, sectionId: 'local' | 'global' = 'local') => section(tree, sectionId)?.groups.find((g) => g.id === id);
const names = (tree: Tree, id: string, sectionId: 'local' | 'global' = 'local') => group(tree, id, sectionId)?.items.map((i) => i.name);

describe('buildCustomizationTree', () => {
  it('groups by type in fixed order', () => {
    const tree = buildCustomizationTree(
      input({
        skills: [skill('s', { ws: 'ws1' })], agents: [agent('a', { ws: 'ws1' })],
        instructions: [instruction('i', { ws: 'ws1' })], mcps: [mcp('m', { repoPath: '/r/app' })],
        hooks: [hook('h')], plugins: [plugin('p', { scope: 'project' })],
      }),
      HOME,
    );
    expect(tree.sections.map((s) => s.id)).toEqual(['local']);
    expect(groupIds(tree)).toEqual(['instruction', 'skill', 'agent', 'mcp', 'hook', 'plugin']);
    expect(section(tree, 'local')?.groups.map((g) => g.label)).toEqual(['Instruções', 'Skills', 'Agents', 'MCP', 'Hooks', 'Plugins']);
  });

  it('splits a workspace into a Workspace section and a read-only Global section', () => {
    const tree = buildCustomizationTree(input({ skills: [skill('tdd'), skill('review-pr', { ws: 'ws1' }), skill('commit-msg', { ws: 'ws1' })], hooks: [hook('h')] }), WS);
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
    const searched = buildCustomizationTree(input({ skills: [skill('mine', { ws: 'ws1' }), skill('tdd')] }), { ...WS, query: 'mine' });
    expect(searched.sections.map((s) => s.id)).toEqual(['local']);
  });

  it('keeps local and Global items with the same name apart', () => {
    const tree = buildCustomizationTree(input({ skills: [skill('tdd'), skill('tdd', { ws: 'ws1' })] }), WS);
    const items = [...(group(tree, 'skill')?.items ?? []), ...(group(tree, 'skill', 'global')?.items ?? [])];
    expect(items.map((i) => i.origin)).toEqual(['local', 'global']);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });

  it('treats everything as local while the workspace loads', () => {
    const loading: TreeOptions = { isHome: false, aliases: {}, folders: [], multi: false, query: '', filter: 'all' };
    const tree = buildCustomizationTree(input({ skills: [skill('tdd'), skill('x', { ws: 'ws1' })], hooks: [hook('h')] }), loading);
    expect(tree.totals.global).toBe(0);
    expect(tree.sections.map((s) => s.id)).toEqual(['local']);
    expect(group(tree, 'skill')?.items.every((i) => i.origin === 'local')).toBe(true);
  });

  it('Início shows no Global and always lists the singleton instruction', () => {
    const tree = buildCustomizationTree(input({ skills: [skill('tdd')], hooks: [hook('h')], plugins: [plugin('p')] }), HOME);
    const instr = group(tree, 'instruction');
    expect(instr?.items).toHaveLength(1);
    expect(instr?.items[0]?.entity).toMatchObject({ kind: 'instruction', value: undefined });
    expect(tree.totals.global).toBe(0);
  });

  it('shows the saved personal instruction as Global inside a workspace', () => {
    const tree = buildCustomizationTree(input({ personalInstruction: instruction('default') }), WS);
    expect(group(tree, 'instruction')?.items[0]?.entity).toMatchObject({ kind: 'instruction', value: undefined, placement: 'workspace' });
    expect(group(tree, 'instruction', 'global')?.items.map((i) => i.origin)).toEqual(['global']);
  });

  it('placeholder instruction rows are not counted and hide while searching or filtering', () => {
    const tree = buildCustomizationTree(input(), WS);
    expect(group(tree, 'instruction')?.items).toHaveLength(1);
    expect(tree.totals.all).toBe(0);
    expect(tree.shown).toBe(0);
    expect(group(buildCustomizationTree(input(), { ...WS, query: 'x' }), 'instruction')).toBeUndefined();
    expect(group(buildCustomizationTree(input(), { ...WS, filter: 'disabled' }), 'instruction')).toBeUndefined();
  });

  it('drops plugin-provided items and keeps one row per plugin', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('from-plugin', { plugin: 'p1' })], mcps: [mcp('pm', { plugin: 'p1' })], plugins: [plugin('p1')] }),
      HOME,
    );
    expect(names(tree, 'skill')).toEqual([]);
    expect(group(tree, 'mcp')).toBeUndefined();
    expect(names(tree, 'plugin')).toEqual(['p1']);
  });

  it('computes chip totals on the searched set', () => {
    const problems: ChannelProblems = new Map([['urn:skill:review-pr', ['cursor'] as const]]);
    const tree = buildCustomizationTree(
      input({ skills: [skill('review-pr', { ws: 'ws1' }), skill('commit-msg', { ws: 'ws1' })], mcps: [mcp('off', { enabled: false })], problems }),
      { ...WS, query: 'rev' },
    );
    expect(tree.totals).toEqual({ all: 1, global: 0, problems: 1, disabled: 0, detected: 0 });
  });

  it('problems filter keeps only failing items and counts per group', () => {
    const problems: ChannelProblems = new Map([
      ['urn:skill:a', ['claude'] as const],
      ['urn:mcp:m', ['cursor'] as const],
    ]);
    const tree = buildCustomizationTree(
      input({ skills: [skill('a', { ws: 'ws1' }), skill('b', { ws: 'ws1' })], mcps: [mcp('m', { repoPath: '/r/app' }), mcp('n', { repoPath: '/r/app' })], problems }),
      { ...WS, filter: 'problems' },
    );
    expect(names(tree, 'skill')).toEqual(['a']);
    expect(names(tree, 'mcp')).toEqual(['m']);
    expect(group(tree, 'skill')).toMatchObject({ count: 1, problems: 1 });
    expect(tree.shown).toBe(2);
  });

  it('an active chip with zero matches yields no groups and shown 0', () => {
    const tree = buildCustomizationTree(input({ skills: [skill('a', { ws: 'ws1' }), skill('g')] }), { ...WS, filter: 'disabled' });
    expect(tree.sections).toEqual([{ id: 'local', groups: [], count: 0, problems: 0 }]);
    expect(tree.shown).toBe(0);
    expect(tree.grandTotal).toBe(2);
  });

  it('hides empty groups except Skills and Agents when unfiltered', () => {
    const tree = buildCustomizationTree(input({ mcps: [mcp('m')] }), HOME);
    expect(groupIds(tree)).toEqual(['instruction', 'skill', 'agent', 'mcp']);
    const searched = buildCustomizationTree(input({ mcps: [mcp('m')] }), { ...HOME, query: 'm' });
    expect(groupIds(searched)).toEqual(['mcp']);
  });

  it('flags disabled MCP, hook and plugin', () => {
    const tree = buildCustomizationTree(
      input({ mcps: [mcp('m', { enabled: false })], hooks: [hook('h', { enabled: false }), hook('on')], plugins: [plugin('p', { enabled: false })] }),
      HOME,
    );
    expect(group(tree, 'mcp')?.items[0]?.state.disabled).toBe(true);
    expect(group(tree, 'hook')?.items.map((i) => i.state.disabled)).toEqual([true, false]);
    expect(group(tree, 'plugin')?.items[0]?.state.disabled).toBe(true);
    expect(tree.totals.disabled).toBe(3);
  });

  it('a detected MCP server reporting enabled false is not "desativado" — only the user’s own can be turned off', () => {
    const tree = buildCustomizationTree(input({ mcps: [{ ...mcp('claude-ai-Gmail', { detected: true }), enabled: false }] }), HOME);
    expect(group(tree, 'mcp')?.items[0]?.state.disabled).toBe(false);
    expect(tree.totals.disabled).toBe(0);
  });

  it('ignores problems on detected items and while health is empty', () => {
    const problems: ChannelProblems = new Map([['urn:skill:ghost', ['claude'] as const]]);
    const withDetected = buildCustomizationTree(input({ detected: [detected('ghost')], problems }), WS);
    expect(withDetected.totals).toMatchObject({ problems: 0, detected: 1 });
    expect(group(withDetected, 'skill')?.items[0]?.origin).toBe('detected');
    const empty = buildCustomizationTree(input({ skills: [skill('a', { ws: 'ws1' })] }), WS);
    expect(empty.totals.problems).toBe(0);
  });

  it('lists detected items after local and Global ones, one row per harness', () => {
    const tree = buildCustomizationTree(
      input({ skills: [skill('z', { ws: 'ws1' }), skill('g')], detected: [detected('a'), detected('a', { harness: 'cursor' }), detected('home', { scope: 'personal' })] }),
      WS,
    );
    // Detected items are the workspace's own (found in its folders), listed after its saved ones.
    expect(group(tree, 'skill')?.items.map((i) => `${i.origin}:${i.name}`)).toEqual(['local:z', 'detected:a', 'detected:a']);
    expect(new Set(group(tree, 'skill')?.items.map((i) => i.key)).size).toBe(3);
    expect(names(tree, 'skill', 'global')).toEqual(['g']);
  });

  it('marks detected MCP and hooks as detected', () => {
    const detectedHook: Hook = { ...hook('dh'), source: { kind: 'detected', detectedId: 'x', harness: 'cursor', importable: true } };
    const tree = buildCustomizationTree(input({ mcps: [mcp('dm', { detected: true })], hooks: [detectedHook] }), WS);
    expect(group(tree, 'mcp')?.items[0]?.origin).toBe('detected');
    expect(group(tree, 'hook')?.items[0]?.origin).toBe('detected');
  });

  it('tags rows with their folder in a multi-folder workspace', () => {
    const multi: TreeOptions = { ...WS, multi: true, folders: ['/r/api'], aliases: { '/r/api': 'api' } };
    const tree = buildCustomizationTree(input({ skills: [skill('s', { ws: 'ws1', folder: '/r/api' })], detected: [detected('d', { folder: '/r/api' })] }), multi);
    expect(group(tree, 'skill')?.items.map((i) => i.folderAlias)).toEqual(['api', 'api']);
    const instr = group(tree, 'instruction')?.items ?? [];
    expect(instr.map((i) => i.entity)).toEqual([
      expect.objectContaining({ placement: 'workspace' }),
      expect.objectContaining({ placement: 'folder', folder: '/r/api' }),
    ]);
    expect(instr[1]?.folderAlias).toBe('api');
  });

  it('grandTotal ignores query and filter', () => {
    const tree = buildCustomizationTree(input({ skills: [skill('a', { ws: 'ws1' }), skill('b', { ws: 'ws1' })], hooks: [hook('h')] }), { ...WS, query: 'a', filter: 'problems' });
    expect(tree.grandTotal).toBe(3);
  });
});

describe('rowBadge', () => {
  const item = (patch: Partial<TreeItem>): TreeItem => ({
    key: 'k', urn: 'urn:skill:x', name: 'x', origin: 'local', state: { problems: [], disabled: false },
    entity: { kind: 'skill', value: skill('x') }, ...patch,
  });
  it('rowBadge precedence', () => {
    expect(rowBadge(item({ state: { problems: ['claude'], disabled: true } }))).toBe('problem');
    expect(rowBadge(item({ origin: 'global', state: { problems: [], disabled: true } }))).toBe('disabled');
    expect(rowBadge(item({ origin: 'detected' }))).toBe('detected');
    // The Global section names the origin; its rows carry no tag of their own.
    expect(rowBadge(item({ origin: 'global' }))).toBeNull();
    expect(rowBadge(item({}))).toBeNull();
  });
});
