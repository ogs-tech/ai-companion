import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsWindowStateStore } from '../../../../src/main/infrastructure/window/fs-window-state-store.js';

describe('FsWindowStateStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'window-state-test-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips a saved state', () => {
    const store = new FsWindowStateStore(join(dir, 'nested', 'window-state.json'));
    store.save({ width: 1200, height: 800, x: 10, y: 20, maximized: true });
    expect(store.load()).toEqual({ width: 1200, height: 800, x: 10, y: 20, maximized: true });
  });

  it('returns null when the file is missing', () => {
    expect(new FsWindowStateStore(join(dir, 'none.json')).load()).toBeNull();
  });

  it('returns null for corrupt JSON or unusable sizes', () => {
    const file = join(dir, 'window-state.json');
    writeFileSync(file, '{not json');
    expect(new FsWindowStateStore(file).load()).toBeNull();
    writeFileSync(file, JSON.stringify({ width: 'wide', height: 600 }));
    expect(new FsWindowStateStore(file).load()).toBeNull();
  });

  it('drops a half-specified position', () => {
    const file = join(dir, 'window-state.json');
    writeFileSync(file, JSON.stringify({ width: 900, height: 600, x: 5 }));
    expect(new FsWindowStateStore(file).load()).toEqual({ width: 900, height: 600, maximized: false });
  });
});
