import { describe, expect, it } from 'vitest';
import { DetectionService } from '../../../../src/main/application/services/detection-service.js';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import type { Entity } from '../../../../src/shared/entity.js';

const HOME = '/home/u';
const FOLDER = '/repos/app';

function make(opts: { canonical?: Entity[]; open?: boolean } = {}) {
  const fs = new InMemoryFileSystem();
  const saved: Entity[] = [];
  const service = new DetectionService({
    fs,
    homedir: HOME,
    entities: {
      list: async (kind) => (opts.canonical ?? []).filter((e) => e.kind === kind),
      save: async ({ entity }) => {
        saved.push(entity);
        return { entity, syncReport: [] };
      },
    },
    context: { workspace: opts.open === false ? null : { id: 'ws-1', folders: [FOLDER] } },
  });
  return { fs, service, saved };
}

const canonicalMcp = (name: string): Entity =>
  ({ urn: `urn:mcp:${name}`, kind: 'mcp', name, description: '', scopes: ['personal'], metadata: { version: '1.0.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, def: {}, enabled: true }) as Entity;

describe('DetectionService', () => {
  it('detects skills, agents, MCP servers and hooks in both harnesses', async () => {
    const { fs, service } = make();
    fs.createFile(`${HOME}/.claude/skills/review/SKILL.md`, '---\nname: review\ndescription: Reviews code\n---\nBody');
    fs.createFile(`${HOME}/.cursor/agents/planner.md`, '---\nname: planner\ndescription: Plans\n---\nPrompt');
    fs.createFile(`${HOME}/.claude.json`, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp' } } }));
    fs.createFile(`${HOME}/.cursor/mcp.json`, JSON.stringify({ mcpServers: { fs: { command: 'fs-mcp' } } }));
    fs.createFile(`${HOME}/.claude/settings.json`, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: './s.sh' }] }] } }));
    fs.createFile(`${HOME}/.cursor/hooks.json`, JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: './p.sh', matcher: 'Shell' }] } }));

    const list = await service.list();
    const key = (d: { kind: string; harness: string; name: string }) => `${d.harness}:${d.kind}:${d.name}`;
    const keys = list.map(key);
    expect(keys).toContain('claude:skill:review');
    expect(keys).toContain('cursor:agent:planner');
    expect(keys).toContain('claude:mcp:gh');
    expect(keys).toContain('cursor:mcp:fs');
    expect(list.filter((d) => d.kind === 'hook')).toHaveLength(2);
    const cursorHook = list.find((d) => d.kind === 'hook' && d.harness === 'cursor');
    expect(cursorHook?.preview).toMatchObject({ event: 'PreToolUse', matcher: 'Bash' });
  });

  it('reads workspace folders only while a workspace is open', async () => {
    const closed = make({ open: false });
    closed.fs.createFile(`${FOLDER}/.mcp.json`, JSON.stringify({ mcpServers: { local: { command: 'x' } } }));
    expect(await closed.service.list()).toEqual([]);
    const open = make();
    open.fs.createFile(`${FOLDER}/.mcp.json`, JSON.stringify({ mcpServers: { local: { command: 'x' } } }));
    expect(await open.service.list()).toMatchObject([{ kind: 'mcp', name: 'local', scope: 'workspace', folder: FOLDER }]);
  });

  it('skips symlinked skills (the app\'s own links) and hides items that are already canonical', async () => {
    const { fs, service } = make({ canonical: [canonicalMcp('gh')] });
    fs.createFile('/data/skills/mine/SKILL.md', '---\nname: mine\ndescription: d\n---\nb');
    await fs.mkdir(`${HOME}/.claude/skills`, { recursive: true });
    await fs.symlink({ target: '/data/skills/mine', path: `${HOME}/.claude/skills/mine` });
    fs.createFile(`${HOME}/.claude.json`, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp' }, other: { command: 'o' } } }));
    const list = await service.list();
    expect(list.map((d) => d.name)).toEqual(['other']);
  });

  it('marks a multi-file skill, an invalid MCP def and an unmappable Cursor hook as not importable', async () => {
    const { fs, service } = make();
    fs.createFile(`${HOME}/.claude/skills/big/SKILL.md`, '---\nname: big\ndescription: d\n---\nb');
    fs.createFile(`${HOME}/.claude/skills/big/script.sh`, 'echo');
    fs.createFile(`${HOME}/.cursor/mcp.json`, JSON.stringify({ mcpServers: { bad: { nothing: true } } }));
    fs.createFile(`${HOME}/.cursor/hooks.json`, JSON.stringify({ hooks: { afterFileEdit: [{ command: './x.sh' }] } }));
    const list = await service.list();
    expect(list.every((d) => !d.importable && d.reason !== undefined)).toBe(true);
    expect(list).toHaveLength(3);
  });

  it('tolerates malformed JSON in the user\'s files', async () => {
    const { fs, service } = make();
    fs.createFile(`${HOME}/.claude.json`, '{ not json');
    expect(await service.list()).toEqual([]);
  });

  it('hides a hook already represented by a canonical one, in both harnesses', async () => {
    const hook = { urn: 'urn:hook:a', kind: 'hook', name: 'a', description: '', scopes: ['personal'], metadata: { version: '1.0.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, event: 'PreToolUse', matcher: 'Bash|Edit', handler: { type: 'command', command: './a.sh' }, enabled: true } as Entity;
    const { fs, service } = make({ canonical: [hook] });
    fs.createFile(`${HOME}/.claude/settings.json`, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|Edit', hooks: [{ type: 'command', command: './a.sh' }] }] } }));
    fs.createFile(`${HOME}/.cursor/hooks.json`, JSON.stringify({ hooks: { preToolUse: [{ command: './a.sh', matcher: 'Shell|Write' }] } }));
    expect(await service.list()).toEqual([]);
  });

  it('imports an item as a canonical entity re-homed to its scope', async () => {
    const { fs, service, saved } = make();
    fs.createFile(`${FOLDER}/.mcp.json`, JSON.stringify({ mcpServers: { local: { command: 'x' } } }));
    fs.createFile(`${HOME}/.claude/skills/review/SKILL.md`, '---\nname: review\ndescription: Reviews\nmodel: opus\n---\nBody');
    const [mcp, skill] = [
      (await service.list({ kinds: ['mcp'] }))[0]!,
      (await service.list({ kinds: ['skill'] }))[0]!,
    ];
    await service.import(mcp.id);
    await service.import(skill.id);
    expect(saved[0]).toMatchObject({ kind: 'mcp', name: 'local', scopes: ['workspace'], scopeId: 'ws-1', folder: FOLDER, def: { command: 'x' } });
    expect(saved[1]).toMatchObject({ kind: 'skill', name: 'review', scopes: ['personal'], description: 'Reviews', content: 'Body', ext: { model: 'opus' } });
  });

  it('refuses to import a non-importable or unknown item', async () => {
    const { fs, service } = make();
    fs.createFile(`${HOME}/.cursor/mcp.json`, JSON.stringify({ mcpServers: { bad: {} } }));
    const [bad] = await service.list();
    await expect(service.import(bad!.id)).rejects.toMatchObject({ kind: 'validation' });
    await expect(service.import('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
