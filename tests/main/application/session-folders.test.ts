import { describe, it, expect } from 'vitest';
import { prepareMultiFolderCwd } from '../../../src/main/application/session-folders.js';

type Node = { kind: 'symlink'; target: string } | { kind: 'file' } | { kind: 'directory' };

/** Minimal in-memory file system: paths map to nodes; directories are also implied by their children. */
const memfs = (seed: Record<string, Node> = {}) => {
  const nodes = new Map<string, Node>(Object.entries(seed));
  const children = (dir: string): string[] =>
    [...nodes.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1));
  const implied = (path: string): boolean => [...nodes.keys()].some((p) => p.startsWith(`${path}/`));
  const fs = {
    mkdir: async (path: string) => {
      if (!nodes.has(path)) nodes.set(path, { kind: 'directory' });
    },
    lstat: async (path: string) => {
      const n = nodes.get(path);
      if (n) return { kind: n.kind };
      return { kind: implied(path) ? ('directory' as const) : ('none' as const) };
    },
    readlink: async (path: string) => {
      const n = nodes.get(path);
      return n?.kind === 'symlink' ? n.target : '';
    },
    symlink: async ({ target, path }: { target: string; path: string }) => void nodes.set(path, { kind: 'symlink', target }),
    unlink: async (path: string) => void nodes.delete(path),
    readdir: async (path: string) => children(path),
    pathExists: async (path: string) => nodes.has(path) || implied(path),
  };
  const links = (dir: string): Record<string, string | undefined> =>
    Object.fromEntries(children(dir).map((n) => [n, (nodes.get(`${dir}/${n}`) as { target?: string }).target]));
  return { fs, nodes, links };
};

const skill = (dir: string, name: string): Record<string, Node> => ({ [`${dir}/${name}`]: { kind: 'symlink', target: `/canon/${name}` } });

describe('prepareMultiFolderCwd', () => {
  it('links exactly the given folders under the workspace home', async () => {
    const { fs, links } = memfs();
    const cwd = await prepareMultiFolderCwd(fs, '/h/ws', ['/r/web', '/r/api']);
    expect(cwd).toMatch(/^\/h\/ws\/sessions\/[0-9a-f]{10}$/);
    expect(links(cwd)).toMatchObject({ api: '/r/api', web: '/r/web' });
  });

  it('is stable for the same folder set regardless of order, and different otherwise', async () => {
    const a = await prepareMultiFolderCwd(memfs().fs, '/h/ws', ['/r/web', '/r/api']);
    const b = await prepareMultiFolderCwd(memfs().fs, '/h/ws', ['/r/api', '/r/web']);
    const c = await prepareMultiFolderCwd(memfs().fs, '/h/ws', ['/r/api', '/r/other']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('disambiguates folders sharing a basename and never reuses the .claude name', async () => {
    const { fs, links } = memfs();
    const cwd = await prepareMultiFolderCwd(fs, '/h/ws', ['/a/app', '/b/app', '/c/.claude']);
    expect(Object.keys(links(cwd)).sort()).toEqual(['.claude', '.claude-2', 'app', 'app-2']);
  });

  it("merges the shared set and every folder's skills and agents into the session's own .claude", async () => {
    const { fs, nodes, links } = memfs({
      ...skill('/h/ws/.claude/skills', 'shared-skill'),
      ...skill('/r/web/.claude/skills', 'web-skill'),
      ...skill('/r/api/.claude/skills', 'api-skill'),
      ...skill('/r/api/.claude/agents', 'api-agent'),
      '/h/ws/.claude/CLAUDE.md': { kind: 'file' },
    });
    const cwd = await prepareMultiFolderCwd(fs, '/h/ws', ['/r/web', '/r/api']);
    expect(nodes.get(`${cwd}/.claude`)?.kind).toBe('directory');
    expect(links(`${cwd}/.claude/skills`)).toEqual({
      'shared-skill': '/h/ws/.claude/skills/shared-skill',
      'api-skill': '/r/api/.claude/skills/api-skill',
      'web-skill': '/r/web/.claude/skills/web-skill',
    });
    expect(links(`${cwd}/.claude/agents`)).toEqual({ 'api-agent': '/r/api/.claude/agents/api-agent' });
    expect(links(`${cwd}/.claude`)['CLAUDE.md']).toBe('/h/ws/.claude/CLAUDE.md');
  });

  it('lets the shared set win a name clash, then the first folder', async () => {
    const { fs, links } = memfs({
      ...skill('/h/ws/.claude/skills', 'dup'),
      ...skill('/r/web/.claude/skills', 'dup'),
      ...skill('/r/api/.claude/skills', 'only-api'),
    });
    const cwd = await prepareMultiFolderCwd(fs, '/h/ws', ['/r/web', '/r/api']);
    expect(links(`${cwd}/.claude/skills`)).toEqual({ dup: '/h/ws/.claude/skills/dup', 'only-api': '/r/api/.claude/skills/only-api' });
  });

  it('drops links that no longer belong and replaces the legacy single .claude link', async () => {
    const first = await prepareMultiFolderCwd(memfs().fs, '/h/ws', ['/r/web', '/r/api']);
    const { fs, nodes, links } = memfs({
      [`${first}/.claude`]: { kind: 'symlink', target: '/h/ws/.claude' },
      ...skill('/r/web/.claude/skills', 'web-skill'),
    });
    nodes.set(`${first}/.claude/skills/gone`, { kind: 'symlink', target: '/r/old/.claude/skills/gone' });
    await prepareMultiFolderCwd(fs, '/h/ws', ['/r/web', '/r/api']);
    expect(nodes.get(`${first}/.claude`)?.kind).toBe('directory');
    expect(links(`${first}/.claude/skills`)).toEqual({ 'web-skill': '/r/web/.claude/skills/web-skill' });
  });

  it('never clobbers a real file sitting where a link belongs', async () => {
    const first = await prepareMultiFolderCwd(memfs().fs, '/h/ws', ['/r/web', '/r/api']);
    const { fs, nodes } = memfs({ [`${first}/web`]: { kind: 'file' } });
    await prepareMultiFolderCwd(fs, '/h/ws', ['/r/web', '/r/api']);
    expect(nodes.get(`${first}/web`)).toEqual({ kind: 'file' });
  });
});
