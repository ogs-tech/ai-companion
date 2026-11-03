import { describe, it, expect, vi } from 'vitest';
import { HookService, type HookCanonical } from '../../../../src/main/application/services/hook-service.js';
import { FakePluginCachePort } from '../../../../src/main/application/services/__fixtures__/fake-plugin-cache-port.js';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { OperationNotAllowedForOriginError } from '../../../../src/main/domain/plugin-errors.js';
import { hookId } from '../../../../src/main/domain/hook-id.js';
import type { PluginId } from '../../../../src/main/domain/plugin-id.js';
import type { HookEntity } from '../../../../src/shared/entity.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';

const entity = (over: Partial<HookEntity> = {}): HookEntity => ({
  urn: 'urn:hook:h1', kind: 'hook', name: 'h1', description: '', scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: 't0', updatedAt: 't0' }, source: { kind: 'workspace' },
  event: 'PreToolUse', matcher: 'Bash', handler: { type: 'command', command: './c.sh' }, enabled: true, ...over,
});

const detectedHook: DetectedEntity = {
  id: 'det-hook', kind: 'hook', name: 'hook-abc', description: '', harness: 'cursor', scope: 'personal',
  path: '/home/u/.cursor/hooks.json', importable: true,
  preview: { event: 'Stop', handler: { type: 'command', command: './s.sh' } },
};

function make(opts: { canonical?: HookEntity[]; detected?: DetectedEntity[]; workspaceId?: string | null; plugin?: { cache: FakePluginCachePort; fs: InMemoryFileSystem } } = {}) {
  const store = new Map((opts.canonical ?? []).map((e) => [e.urn, e]));
  const save = vi.fn(async ({ entity: e }: { entity: HookEntity; isCreate?: boolean }) => {
    store.set(e.urn, e);
    return { entity: e, syncReport: [] };
  });
  const del = vi.fn(async () => ({ ok: true as const }));
  const canonical: HookCanonical = {
    entities: {
      list: async () => [...store.values()],
      get: async (urn: string) => {
        const found = store.get(urn);
        if (!found) throw new Error('not_found');
        return found;
      },
      save,
      delete: del,
    } as unknown as HookCanonical['entities'],
    detection: { list: async () => opts.detected ?? [] },
    workspaceId: opts.workspaceId === undefined ? 'ws-1' : opts.workspaceId,
  };
  return { service: new HookService(() => canonical, opts.plugin), save, del };
}

describe('HookService (canonical layer)', () => {
  it('creates a canonical hook with a generated slug name and returns the sync report', async () => {
    const { service, save } = make();
    const result = await service.save({ hook: { event: 'Stop', handler: { type: 'command', command: './s.sh' } } });
    const saved = save.mock.calls[0]![0];
    expect(saved.isCreate).toBe(true);
    expect(saved.entity).toMatchObject({ kind: 'hook', event: 'Stop', scopes: ['personal'], enabled: true });
    expect(saved.entity.name).toMatch(/^hook-[0-9a-f]{8}$/);
    expect(result.hook.id).toBe(saved.entity.name);
    expect(result.syncReport).toEqual([]);
  });

  it('updates an existing hook in place, keeping its enabled flag and metadata', async () => {
    const { service, save } = make({ canonical: [entity({ enabled: false })] });
    await service.save({ hook: { id: hookId('h1'), event: 'PreToolUse', matcher: 'Read', handler: { type: 'command', command: './n.sh' } } });
    expect(save.mock.calls[0]![0]).toMatchObject({ isCreate: false, entity: { name: 'h1', matcher: 'Read', enabled: false } });
  });

  it('rejects an invalid handler and a project hook without an open workspace', async () => {
    await expect(make().service.save({ hook: { event: 'Stop', handler: { type: 'command' } as never } })).rejects.toThrow();
    await expect(
      make({ workspaceId: null }).service.save({ scope: 'project', hook: { event: 'Stop', handler: { type: 'command', command: 'x' } } }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('lists canonical hooks by scope tier and detected ones as read-only', async () => {
    const project = entity({ urn: 'urn:hook:p', name: 'p', scopes: ['workspace'] });
    const { service } = make({ canonical: [entity(), project], detected: [detectedHook] });
    const personal = await service.list('personal');
    expect(personal.map((h) => h.id)).toContain('h1');
    expect(personal.map((h) => h.id)).not.toContain('p');
    const found = personal.find((h) => h.source.kind === 'detected');
    expect(found).toMatchObject({ event: 'Stop', source: { detectedId: 'det-hook', harness: 'cursor', importable: true } });
    expect((await service.list('project')).map((h) => h.id)).toEqual(['p']);
  });

  it('blocks save/delete of a detected hook until imported', async () => {
    const { service } = make({ detected: [detectedHook] });
    const [row] = await service.list('personal');
    await expect(service.delete({ id: row!.id })).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
    await expect(service.save({ hook: { id: row!.id, event: 'Stop', handler: { type: 'command', command: 'x' } } })).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
  });

  it('deletes the canonical entity together with its harness entries', async () => {
    const { service, del } = make({ canonical: [entity()] });
    await service.delete({ id: hookId('h1') });
    expect(del).toHaveBeenCalledWith({ urn: 'urn:hook:h1', removeSymlinks: true });
  });

  it('get() throws not_found for a missing hook', async () => {
    await expect(make().service.get({ id: hookId('nope') })).rejects.toMatchObject({ kind: 'not_found' });
  });

  describe('plugin hooks (read-only discovery)', () => {
    const seed = () => {
      const cache = new FakePluginCachePort();
      const fs = new InMemoryFileSystem();
      const pid = 'superpowers' as PluginId;
      cache.seedMeta('personal', {
        version: 2,
        plugins: [{ id: pid, origin: 'imported', installedAt: '2026-05-04T14:30:00Z', scope: 'personal', enabled: true }],
      });
      fs.createFile(
        `${cache.pluginDir('personal', pid)}/hooks/hooks.json`,
        JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|clear', hooks: [{ type: 'command', command: 'run-hook session-start' }] }] } }),
      );
      return { cache, fs, pid };
    };

    it('lists plugin hooks and blocks save/delete on them', async () => {
      const { cache, fs, pid } = seed();
      const { service } = make({ plugin: { cache, fs } });
      const [hook] = await service.list('personal');
      expect(hook).toMatchObject({ event: 'SessionStart', source: { kind: 'plugin', pluginId: pid } });
      expect(hook!.id.startsWith('superpowers:SessionStart:')).toBe(true);
      await expect(service.save({ hook: { id: hook!.id, event: 'SessionStart', handler: { type: 'command', command: 'evil' } } })).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
      await expect(service.delete({ id: hook!.id })).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
    });
  });
});
