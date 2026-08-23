import { describe, expect, it } from 'vitest';
import { createTaskQueue } from '../../../src/main/application/task-queue.js';

/** Lets every already-scheduled microtask and timer callback run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('createTaskQueue', () => {
  it('does not start a task until the previous one settles', async () => {
    const queue = createTaskQueue();
    const started: string[] = [];
    const release: Array<() => void> = [];

    const submit = (id: string): Promise<string> =>
      queue(async () => {
        started.push(id);
        await new Promise<void>((resolve) => release.push(resolve));
        return id;
      });

    const first = submit('a');
    const second = submit('b');
    await flush();

    expect(started).toEqual(['a']);

    release[0]?.();
    await expect(first).resolves.toBe('a');
    await flush();

    expect(started).toEqual(['a', 'b']);

    release[1]?.();
    await expect(second).resolves.toBe('b');
  });

  it('never lets two tasks overlap', async () => {
    const queue = createTaskQueue();
    let active = 0;
    let maxActive = 0;

    const submit = (delay: number): Promise<void> =>
      queue(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await after(delay);
        active--;
      });

    await Promise.all([submit(15), submit(1), submit(8), submit(1)]);

    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });

  it('leaves shared state matching the LAST task queued, even when an earlier task is slower', async () => {
    const queue = createTaskQueue();
    // Mirrors switchActiveWorkspace: write the persisted pointer across an
    // await, then swap the in-memory graph.
    let pointer = 'initial';
    let graph = 'initial';

    const switchTo = (id: string, delay: number): Promise<string> =>
      queue(async () => {
        await after(delay);
        pointer = id;
        graph = id;
        return id;
      });

    // 'a' is much slower than 'b'. Unserialized, both run at once and the slow
    // 'a' lands last — so the *first* request wins and the second is silently
    // discarded. Serialized, 'a' completes first and 'b' is genuinely last.
    const results = await Promise.all([switchTo('a', 25), switchTo('b', 1)]);

    expect(results).toEqual(['a', 'b']);
    expect(pointer).toBe('b');
    expect(graph).toBe('b');
  });

  it('surfaces a rejection to its own caller without blocking the queue', async () => {
    const queue = createTaskQueue();
    const ran: string[] = [];

    const ok = queue(async () => {
      ran.push('ok');
      return 'ok';
    });
    const boom = queue(async () => {
      ran.push('boom');
      throw new Error('task failed');
    });
    const after = queue(async () => {
      ran.push('after');
      return 'after';
    });

    await expect(ok).resolves.toBe('ok');
    await expect(boom).rejects.toThrow('task failed');
    await expect(after).resolves.toBe('after');
    expect(ran).toEqual(['ok', 'boom', 'after']);
  });
});
