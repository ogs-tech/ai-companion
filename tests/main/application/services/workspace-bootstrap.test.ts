import { describe, expect, it, vi } from 'vitest';
import { WorkspaceBootstrapService } from '../../../../src/main/application/services/workspace-bootstrap.js';
import type { FileSystemMutator } from '../../../../src/main/application/ports/file-system-mutator.js';
import { WorkspacePaths } from '../../../../src/shared/settings.js';
import { workspaceIndexMarkerPath } from '../../../../src/shared/brand-paths.js';

const mutator = (
  mkdir: FileSystemMutator['mkdirRecursive'],
  writeFile: FileSystemMutator['writeFile'] = vi.fn().mockResolvedValue(undefined),
): FileSystemMutator => ({
  mkdirRecursive: mkdir,
  writeFile,
});

describe('WorkspaceBootstrapService.create', () => {
  it('creates every subdirectory listed in WorkspacePaths inside the workspace', async () => {
    const created: string[] = [];
    const service = new WorkspaceBootstrapService(
      mutator(async (path) => {
        created.push(path);
      }),
    );

    await service.create('/tmp/ws');

    expect(created).toEqual(WorkspacePaths.map((sub) => `/tmp/ws/${sub}`));
  });

  it('writes the AI Companion index.md marker at the workspace root', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const service = new WorkspaceBootstrapService(mutator(vi.fn().mockResolvedValue(undefined), writeFile));

    await service.create('/tmp/ws');

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0]!;
    expect(path).toBe(workspaceIndexMarkerPath('/tmp/ws'));
    expect(content).toContain('AI Companion');
  });

  it('is idempotent — does not throw when the mutator no-ops on existing dirs', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const service = new WorkspaceBootstrapService(mutator(mkdir));

    await service.create('/tmp/ws');
    await service.create('/tmp/ws');

    expect(mkdir).toHaveBeenCalledTimes(WorkspacePaths.length * 2);
  });

  it('propagates errors from the mutator without swallowing them', async () => {
    const err = new Error('EACCES: permission denied');
    const service = new WorkspaceBootstrapService(
      mutator(() => Promise.reject(err)),
    );

    await expect(service.create('/tmp/ws')).rejects.toBe(err);
  });
});
