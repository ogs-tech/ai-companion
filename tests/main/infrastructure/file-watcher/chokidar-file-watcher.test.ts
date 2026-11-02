import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ChokidarFileWatcher } from '../../../../src/main/infrastructure/file-watcher/chokidar-file-watcher.js';
import type { FileWatcherHandle } from '../../../../src/main/application/ports/file-watcher-port.js';

let dir: string;
let handle: FileWatcherHandle | null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sde-file-watcher-'));
  handle = null;
});

afterEach(async () => {
  await handle?.close();
  await rm(dir, { recursive: true, force: true });
});

describe('ChokidarFileWatcher', () => {
  it('reports a file written under a watched root path once its write has settled', async () => {
    await mkdir(join(dir, 'skills', 'demo'), { recursive: true });
    const watcher = new ChokidarFileWatcher({ stabilityThresholdMs: 30 });
    const onChange = vi.fn();
    handle = watcher.watch([dir], onChange);
    // chokidar's initial recursive scan is async — give it a moment to finish
    // arming watches on the pre-existing `skills/demo` dir before writing,
    // same as any real caller that starts the watcher well before a session
    // could plausibly write anything.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await writeFile(join(dir, 'skills', 'demo', 'SKILL.md'), '# demo\n', 'utf8');

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(join(dir, 'skills', 'demo', 'SKILL.md')), {
      timeout: 3000,
    });
  });

  it('never reports a change under a path outside every watched root', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'sde-file-watcher-other-'));
    const watcher = new ChokidarFileWatcher({ stabilityThresholdMs: 30 });
    const onChange = vi.fn();
    handle = watcher.watch([dir], onChange);

    await writeFile(join(otherDir, 'unrelated.md'), 'irrelevant\n', 'utf8');
    // Give the watcher the same settle window as the positive case, then
    // assert it never fired — proves the watch is scoped to `dir`, not just slow.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onChange).not.toHaveBeenCalled();
    await rm(otherDir, { recursive: true, force: true });
  });

  it('does not follow a symlink out of a watched root into the folder it points at', async () => {
    // Multi-folder sessions drop symlinks to the user's real repos under Global's data dir; following them would watch every file of `node_modules`/`.git` and exhaust file descriptors (EMFILE).
    const repo = await mkdtemp(join(tmpdir(), 'sde-file-watcher-repo-'));
    await symlink(repo, join(dir, 'linked-repo'));
    const watcher = new ChokidarFileWatcher({ stabilityThresholdMs: 30 });
    const onChange = vi.fn();
    handle = watcher.watch([dir], onChange);
    await new Promise((resolve) => setTimeout(resolve, 200));

    await mkdir(join(repo, 'node_modules'), { recursive: true });
    await writeFile(join(repo, 'node_modules', 'touched.md'), 'x\n', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The link itself may be reported (harmless — it maps to no entity); nothing inside its target may be.
    const reported = onChange.mock.calls.map(([path]) => String(path));
    expect(reported.filter((path) => path.startsWith(join(dir, 'linked-repo') + '/'))).toEqual([]);
    await rm(repo, { recursive: true, force: true });
  });

  it('skips a unix socket under a watched root instead of failing to watch it', async () => {
    const socketServer = createServer();
    await new Promise<void>((resolve) => socketServer.listen(join(dir, 'link.sock'), resolve));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      handle = new ChokidarFileWatcher({ stabilityThresholdMs: 30 }).watch([dir], vi.fn());
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      await new Promise<void>((resolve) => socketServer.close(() => resolve()));
    }
  });
});
