import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FsClaudeTranscriptWatch } from '../../../../src/main/infrastructure/external-sessions/fs-claude-transcript-watch.js';

describe('FsClaudeTranscriptWatch', () => {
  let home: string;
  let watch: FsClaudeTranscriptWatch;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'transcript-watch-'));
  });
  afterEach(() => {
    watch?.stop();
    vi.useRealTimers();
    rmSync(home, { recursive: true, force: true });
  });

  it('keeps looking for a projects dir that did not exist at start, so the first session of a fresh machine is still seen', async () => {
    const projects = join(home, 'projects');
    watch = new FsClaudeTranscriptWatch(projects);
    const seen: string[] = [];
    watch.onChange((change) => seen.push(change.id));

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await watch.start(); // nothing there yet: must not throw, must not give up
    mkdirSync(join(projects, 'proj'), { recursive: true });
    await vi.advanceTimersByTimeAsync(3500); // the retry finds the dir and starts watching
    vi.useRealTimers();

    const line = JSON.stringify({ type: 'ai-title', aiTitle: 'Late title', cwd: '/x' });
    await expect
      .poll(
        () => {
          writeFileSync(join(projects, 'proj', 'abc.jsonl'), `${line}\n`);
          return seen;
        },
        { timeout: 5000, interval: 700 },
      )
      .toContain('abc');
  });

  it('stop() cancels a pending retry', async () => {
    watch = new FsClaudeTranscriptWatch(join(home, 'never-created'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await watch.start();
    watch.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
