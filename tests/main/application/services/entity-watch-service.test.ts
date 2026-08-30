import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { EntityWatchService } from '../../../../src/main/application/services/entity-watch-service.js';
import type { FileWatcherPort } from '../../../../src/main/application/ports/file-watcher-port.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../src/shared/entity.js';

const dataDir = '/home/user/.ai-companion';

const skill: Skill = {
  urn: 'urn:skill:demo', kind: 'skill', name: 'demo', description: 'd', scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'b',
};

function fakeWatcher(): { watcher: FileWatcherPort; trigger: (path: string) => void; close: ReturnType<typeof vi.fn> } {
  let captured: ((path: string) => void) | undefined;
  const close = vi.fn(async () => undefined);
  const watcher: FileWatcherPort = {
    watch: vi.fn((_patterns, onChange) => {
      captured = onChange;
      return { close };
    }),
  };
  return { watcher, trigger: (path: string) => captured?.(path), close };
}

describe('EntityWatchService', () => {
  it('start() watches dataDir itself (filtering happens in the change handler, not the watch call)', () => {
    const { watcher } = fakeWatcher();
    const service = new EntityWatchService(dataDir, { get: vi.fn() }, { syncEntity: vi.fn() }, watcher);
    service.start();
    expect(watcher.watch).toHaveBeenCalledWith([dataDir], expect.any(Function));
  });

  it('on a recognized path, re-syncs the entity and notifies listeners', async () => {
    const { watcher, trigger } = fakeWatcher();
    const get = vi.fn(async () => skill);
    const syncEntity = vi.fn(async () => []);
    const service = new EntityWatchService(dataDir, { get }, { syncEntity }, watcher);
    const listener = vi.fn();
    service.onEntityChanged(listener);
    service.start();

    trigger(join(dataDir, 'skills', 'demo', 'SKILL.md'));
    await vi.waitFor(() => expect(syncEntity).toHaveBeenCalled());

    expect(get).toHaveBeenCalledWith('urn:skill:demo');
    expect(syncEntity).toHaveBeenCalledWith({ entity: skill });
    expect(listener).toHaveBeenCalledWith({ kind: 'skill', urn: 'urn:skill:demo' });
  });

  it('ignores a path outside the canonical entity conventions', async () => {
    const { watcher, trigger } = fakeWatcher();
    const get = vi.fn(async () => skill);
    const syncEntity = vi.fn(async () => []);
    const service = new EntityWatchService(dataDir, { get }, { syncEntity }, watcher);
    service.start();

    trigger(join(dataDir, 'settings.json'));
    await Promise.resolve();

    expect(get).not.toHaveBeenCalled();
    expect(syncEntity).not.toHaveBeenCalled();
  });

  it('tolerates a malformed/missing entity by skipping the sync silently', async () => {
    const { watcher, trigger } = fakeWatcher();
    const get = vi.fn(async () => { throw new Error('boom'); });
    const syncEntity = vi.fn(async () => []);
    const service = new EntityWatchService(dataDir, { get }, { syncEntity }, watcher);
    const listener = vi.fn();
    service.onEntityChanged(listener);
    service.start();

    trigger(join(dataDir, 'skills', 'broken', 'SKILL.md'));
    await vi.waitFor(() => expect(get).toHaveBeenCalled());

    expect(syncEntity).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('stop() closes the underlying watcher handle', async () => {
    const { watcher, close } = fakeWatcher();
    const service = new EntityWatchService(dataDir, { get: vi.fn() }, { syncEntity: vi.fn() }, watcher);
    service.start();
    await service.stop();
    expect(close).toHaveBeenCalled();
  });
});
