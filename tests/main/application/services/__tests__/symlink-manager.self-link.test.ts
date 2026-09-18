import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../../../../src/main/domain/errors.js';
import { setupSymlinkManager } from './symlink-manager.helpers.js';

/**
 * A symlink whose target is its own path is never a valid outcome: every `open()` on it fails
 * with ELOOP, and `create` would otherwise treat it as already-correct on the next run
 * (the existing-symlink branch sees `resolvedTarget === sourcePath`) and never heal it.
 */
describe('SymlinkManager.create with source === destination', () => {
  const PATH = '/workspace/.ai-companion/index.md';

  it('refuses instead of linking a path to itself', async () => {
    const { manager } = setupSymlinkManager();

    await expect(manager.create({ source: PATH, destination: PATH })).rejects.toThrow(DomainError);
  });

  it('refuses paths that only differ before resolution', async () => {
    const { manager } = setupSymlinkManager();

    await expect(
      manager.create({ source: PATH, destination: '/workspace/.ai-companion/./index.md' }),
    ).rejects.toThrow(DomainError);
  });

  it('leaves the existing file untouched rather than backing it up and replacing it', async () => {
    const { fs, manager } = setupSymlinkManager();
    fs.createFile(PATH, '# canonical index');
    const unlink = vi.spyOn(fs, 'unlink');
    const symlink = vi.spyOn(fs, 'symlink');

    await expect(manager.create({ source: PATH, destination: PATH })).rejects.toThrow(DomainError);

    expect(unlink).not.toHaveBeenCalled();
    expect(symlink).not.toHaveBeenCalled();
    expect(await fs.readFile(PATH)).toBe('# canonical index');
  });
});
