import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsSessionSignalAdapter } from '../../../../src/main/infrastructure/session-signals/fs-session-signal-adapter.js';
import type { SessionSignal } from '../../../../src/main/application/ports/session-signal-port.js';

describe('FsSessionSignalAdapter', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'signals-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(predicate()).toBe(true);
  };

  it('delivers appended lines, skips malformed ones and reassembles a split line', async () => {
    const adapter = new FsSessionSignalAdapter(dir);
    const got: Array<[string, SessionSignal]> = [];
    adapter.onSignal((id, signal) => got.push([id, signal]));
    const file = await adapter.prepare('entity:urn:skill:foo');

    await appendFile(file, '{"event":"working"}\ngarbage\n{"event":"id');
    await waitFor(() => got.length === 1);
    await appendFile(file, 'le"}\n');
    await waitFor(() => got.length === 2);

    expect(got).toEqual([
      ['entity:urn:skill:foo', { event: 'working' }],
      ['entity:urn:skill:foo', { event: 'idle' }],
    ]);
    await adapter.release('entity:urn:skill:foo');
  });

  it('prepare is idempotent and release deletes the file', async () => {
    const adapter = new FsSessionSignalAdapter(dir);
    const a = await adapter.prepare('s1');
    expect(await adapter.prepare('s1')).toBe(a);
    await adapter.release('s1');
    await expect(stat(a)).rejects.toThrow();
  });
});
