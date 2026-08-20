import { describe, expect, it, vi } from 'vitest';
import { WorkspaceTeardownService } from '../../../../src/main/application/services/workspace-teardown.js';
import type { ClaudeSettings } from '../../../../src/main/application/schemas/claude-settings.schema.js';
import type { Scope } from '../../../../src/main/application/ports/scope.js';

import { workspacePath } from '../../../../src/shared/brand-paths.js';

const WORKSPACE = workspacePath('/home/user');

const buildService = () => {
  const order: string[] = [];
  const removeAllAdapterSymlinks = vi.fn(async () => {
    order.push('symlinks');
    return { removed: 0, skipped: 0, errors: [] };
  });
  const removeAllGeneratedFiles = vi.fn(async () => {
    order.push('generated-files');
    return { removed: 0, skipped: 0, errors: [] };
  });
  const remove = vi.fn(async (path: string) => {
    order.push(`remove:${path}`);
  });
  const mutate = vi.fn(
    async (scope: Scope, mutator: (s: ClaudeSettings) => ClaudeSettings) => {
      order.push(`mutate:${scope}`);
      mutator({
        extraKnownMarketplaces: { foo: { source: { source: 'github', repo: 'a/b' } } },
        enabledPlugins: { bar: true },
      });
    },
  );
  const service = new WorkspaceTeardownService(
    { removeAllAdapterSymlinks, removeAllGeneratedFiles },
    { remove },
    WORKSPACE,
    { mutate },
  );
  return { service, removeAllAdapterSymlinks, removeAllGeneratedFiles, remove, mutate, order };
};

describe('WorkspaceTeardownService.restore', () => {
  it('deletes only the workspace directory through the filesystem port', async () => {
    const { service, remove } = buildService();

    await service.restore();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(WORKSPACE);
  });

  it('never targets ~/.claude or any .env.local — only the app workspace', async () => {
    const { service, remove } = buildService();

    await service.restore();

    const removedPaths = remove.mock.calls.map(([path]) => path);
    expect(removedPaths).toEqual([WORKSPACE]);
    expect(removedPaths.some((p) => p.includes('.claude'))).toBe(false);
    expect(removedPaths.some((p) => p.includes('.env.local'))).toBe(false);
  });

  it('removes app-created symlinks before deleting the workspace directory', async () => {
    const { service, removeAllAdapterSymlinks, order } = buildService();

    await service.restore();

    expect(removeAllAdapterSymlinks).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['symlinks', 'generated-files', `remove:${WORKSPACE}`, 'mutate:personal']);
  });

  it('clears the marketplace and plugin registry in personal settings so no dangling cache reference survives', async () => {
    const { service, mutate } = buildService();

    await service.restore();

    expect(mutate).toHaveBeenCalledTimes(1);
    const [scope, mutator] = mutate.mock.calls[0]!;
    expect(scope).toBe('personal');
    const next = mutator({
      extraKnownMarketplaces: { 'claude-plugins-official': { source: { source: 'github', repo: 'a/b' } } },
      enabledPlugins: { 'some-plugin': true },
      customField: 'keep-me',
    } as ClaudeSettings);
    expect(next.extraKnownMarketplaces).toEqual({});
    expect(next.enabledPlugins).toEqual({});
    // Unrelated settings keys are preserved (passthrough).
    expect((next as Record<string, unknown>)['customField']).toBe('keep-me');
  });

  it('clears the registry only after the workspace cache has been deleted', async () => {
    const { service, order } = buildService();

    await service.restore();

    expect(order.indexOf(`remove:${WORKSPACE}`)).toBeLessThan(order.indexOf('mutate:personal'));
  });
});
