import { describe, it, expect, vi } from 'vitest';
import { prepareMultiFolderCwd } from '../../../src/main/application/session-folders.js';

type Entry = { kind: 'symlink' | 'file' | 'none'; target?: string };
const setup = (existing: Record<string, Entry> = {}) => {
  const links: Array<{ target: string; path: string }> = [];
  const fs = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    lstat: vi.fn(async (p: string): Promise<Entry> => existing[p] ?? { kind: 'none' }),
    readlink: vi.fn(async (p: string) => existing[p]?.target ?? ''),
    symlink: vi.fn(async (a: { target: string; path: string }) => void links.push(a)),
  };
  return { fs, links };
};

describe('prepareMultiFolderCwd', () => {
  it('links exactly the given folders plus the shared .claude, under the workspace home', async () => {
    const { fs, links } = setup();
    const cwd = await prepareMultiFolderCwd(fs, '/h/ws', ['/r/web', '/r/api']);
    expect(cwd).toMatch(/^\/h\/ws\/sessions\/[0-9a-f]{10}$/);
    expect(links).toEqual([
      { target: '/r/api', path: `${cwd}/api` },
      { target: '/r/web', path: `${cwd}/web` },
      { target: '/h/ws/.claude', path: `${cwd}/.claude` },
    ]);
  });

  it('is stable for the same folder set regardless of order, and different otherwise', async () => {
    const a = await prepareMultiFolderCwd(setup().fs, '/h/ws', ['/r/web', '/r/api']);
    const b = await prepareMultiFolderCwd(setup().fs, '/h/ws', ['/r/api', '/r/web']);
    const c = await prepareMultiFolderCwd(setup().fs, '/h/ws', ['/r/api', '/r/other']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('disambiguates folders sharing a basename and never reuses the .claude name', async () => {
    const { fs, links } = setup();
    const cwd = await prepareMultiFolderCwd(fs, '/h/ws', ['/a/app', '/b/app', '/c/.claude']);
    expect(links.map((l) => l.path.replace(`${cwd}/`, ''))).toEqual(['app', 'app-2', '.claude-2', '.claude']);
  });

  it('keeps existing correct links and does not clobber foreign entries', async () => {
    const probe = await prepareMultiFolderCwd(setup().fs, '/h/ws', ['/r/web', '/r/api']);
    const { fs, links } = setup({
      [`${probe}/api`]: { kind: 'symlink', target: '/r/api' },
      [`${probe}/web`]: { kind: 'file' },
    });
    await prepareMultiFolderCwd(fs, '/h/ws', ['/r/web', '/r/api']);
    expect(links.map((l) => l.path)).toEqual([`${probe}/.claude`]);
  });
});
