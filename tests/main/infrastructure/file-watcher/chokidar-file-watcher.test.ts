import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
