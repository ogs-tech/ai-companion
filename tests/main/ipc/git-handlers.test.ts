import { describe, expect, it, vi } from 'vitest';
import { buildGitHandlers } from '../../../src/main/ipc/git-handlers.js';
import type { GitService } from '../../../src/main/application/services/git-service.js';
import { DomainError } from '../../../src/main/domain/errors.js';

function setup() {
  const service = {
    status: vi.fn().mockResolvedValue({ isRepo: false }),
    diff: vi.fn().mockResolvedValue({ kind: 'text', path: 'a', hunks: [] }),
    stage: vi.fn().mockResolvedValue(undefined),
    unstage: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ sha: 'abc' }),
    init: vi.fn().mockResolvedValue(undefined),
  };
  return { service, handlers: buildGitHandlers(service as unknown as GitService) };
}

describe('git handlers', () => {
  it('git.status targets the open workspace and takes no target params', async () => {
    const { service, handlers } = setup();
    await handlers['git.status']!(undefined);
    await handlers['git.status']!({});
    expect(service.status.mock.calls).toEqual([[], []]);
  });

  it('git.diff validates the source', async () => {
    const { service, handlers } = setup();
    await handlers['git.diff']!({ path: 'a.ts', source: { kind: 'index' } });
    expect(service.diff).toHaveBeenCalledWith('a.ts', { kind: 'index' });
    await expect(
      handlers['git.diff']!({ path: 'a.ts', source: { kind: 'nope' } }),
    ).rejects.toMatchObject({
      kind: 'validation',
    });
    await expect(
      handlers['git.diff']!({ path: 'a.ts', source: { kind: 'commit' } }),
    ).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  it.each(['git.stage', 'git.unstage', 'git.discard'] as const)(
    '%s requires a non-empty string array',
    async (m) => {
      const { service, handlers } = setup();
      await handlers[m]!({ paths: ['a', 'b'] });
      const fn = service[m.slice(4) as 'stage' | 'unstage' | 'discard'];
      expect(fn).toHaveBeenCalledWith(['a', 'b']);
      for (const bad of [undefined, [], ['a', ''], ['a', 1], 'a']) {
        await expect(handlers[m]!({ paths: bad })).rejects.toMatchObject({ kind: 'validation' });
      }
    },
  );

  it('git.commit defaults amend to false and type-checks it', async () => {
    const { service, handlers } = setup();
    await expect(handlers['git.commit']!({ message: 'm' })).resolves.toEqual({ sha: 'abc' });
    expect(service.commit).toHaveBeenCalledWith('m', false);
    await expect(handlers['git.commit']!({ message: 'm', amend: 'yes' })).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  it('passes domain error kinds through', async () => {
    const { service, handlers } = setup();
    service.init.mockRejectedValueOnce(new DomainError('conflict', 'Already a git repository'));
    await expect(handlers['git.init']!({})).rejects.toMatchObject({ kind: 'conflict' });
  });
});
