import { describe, it, expect, vi } from 'vitest';
import { buildBrowserHandlers } from '../../../src/main/ipc/browser-handlers.js';
import { SessionService } from '../../../src/main/application/services/session-service.js';
import { EntityService } from '../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../src/main/application/services/adapter-manager.js';
import { FakeClaudeSessionPort } from '../../../src/main/application/services/__fixtures__/fake-claude-session-port.js';
import { FakeEmbeddedBrowserPort } from '../../../src/main/application/services/__fixtures__/fake-embedded-browser-port.js';
import { WORKSPACE_SOURCE, entityUrn, type Skill } from '../../../src/shared/entity.js';

const skill = (name = 'foo'): Skill => ({
  urn: entityUrn('skill', name), kind: 'skill', name, description: '',
  scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'body',
});

const setup = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  const claudeSession = new FakeClaudeSessionPort();
  const embeddedBrowser = new FakeEmbeddedBrowserPort();
  const scopeDeps = {
    workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/workspace', isDefault: false, createdAt: '' }) },
    projectService: {
      get: async (id: string) => ({ id, name: 'Test', path: '/project', createdAt: '' }),
      findOrCreateByPath: async (path: string) => ({ id: `project-for:${path}`, name: 'adopted', path, createdAt: '' }),
    },
  };
  const fs = { mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined) };
  const service = new SessionService(base, claudeSession, embeddedBrowser, '/workspace', scopeDeps, fs);
  const h = buildBrowserHandlers(service, embeddedBrowser);
  return { service, base, embeddedBrowser, h };
};

describe('browser-handlers', () => {
  it('browser.enable validates sessionId and forwards to service.setBrowserEnabled(true)', async () => {
    const { service, base, h } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const spawned = await service.spawn({ kind: 'entity', urn: entityUrn('skill', 'foo') });
    const spy = vi.spyOn(service, 'setBrowserEnabled');

    await h['browser.enable']!({ sessionId: spawned.sessionId });

    expect(spy).toHaveBeenCalledWith(spawned.sessionId, true);
  });

  it('browser.enable rejects a missing sessionId', async () => {
    const { h } = setup();
    await expect(h['browser.enable']!({})).rejects.toMatchObject({ kind: 'validation' });
  });

  it('browser.disable validates sessionId and forwards to service.setBrowserEnabled(false)', async () => {
    const { service, base, h } = setup();
    await base.save({ entity: skill('foo'), isCreate: true });
    const spawned = await service.spawn({ kind: 'entity', urn: entityUrn('skill', 'foo') });
    await service.setBrowserEnabled(spawned.sessionId, true);
    const spy = vi.spyOn(service, 'setBrowserEnabled');

    await h['browser.disable']!({ sessionId: spawned.sessionId });

    expect(spy).toHaveBeenCalledWith(spawned.sessionId, false);
  });

  it('browser.navigate validates tabId + url and forwards to the port', async () => {
    const { embeddedBrowser, h } = setup();
    await h['browser.navigate']!({ tabId: 'tab-1', url: 'https://example.com' });
    expect(embeddedBrowser.navigateCalls).toEqual([['tab-1', 'https://example.com']]);
  });

  it('browser.navigate rejects a missing url', async () => {
    const { h } = setup();
    await expect(h['browser.navigate']!({ tabId: 'tab-1' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('browser.setBounds validates the bounds shape and forwards to the port', async () => {
    const { embeddedBrowser, h } = setup();
    await h['browser.setBounds']!({ tabId: 'tab-1', bounds: { x: 1, y: 2, width: 300, height: 400 } });
    expect(embeddedBrowser.setBoundsCalls).toEqual([['tab-1', { x: 1, y: 2, width: 300, height: 400 }]]);
  });

  it('browser.setBounds rejects a non-numeric bound field', async () => {
    const { h } = setup();
    await expect(
      h['browser.setBounds']!({ tabId: 'tab-1', bounds: { x: 1, y: 2, width: 'wide', height: 400 } }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('browser.status returns null before the browser was ever enabled', async () => {
    const { h } = setup();
    expect(await h['browser.status']!({ tabId: 'tab-1' })).toBeNull();
  });

  it('browser.status returns the current url once navigated', async () => {
    const { h } = setup();
    await h['browser.navigate']!({ tabId: 'tab-1', url: 'https://example.com' });
    expect(await h['browser.status']!({ tabId: 'tab-1' })).toEqual({ url: 'https://example.com' });
  });

  it('browser.openTab forwards the optional url to the port', async () => {
    const { embeddedBrowser, h } = setup();

    const result = await h['browser.openTab']!({ url: 'https://example.com' });

    expect(embeddedBrowser.openTabCalls).toEqual(['https://example.com']);
    expect(result).toEqual({ tabId: 'tab-1' });
  });

  it('browser.openTab tolerates no url at all', async () => {
    const { embeddedBrowser, h } = setup();
    await h['browser.openTab']!({});
    expect(embeddedBrowser.openTabCalls).toEqual([undefined]);
  });

  it('browser.closeTab validates tabId and forwards to the port', async () => {
    const { embeddedBrowser, h } = setup();
    await h['browser.closeTab']!({ tabId: 'tab-1' });
    expect(embeddedBrowser.closeTabCalls).toEqual(['tab-1']);
  });

  it('browser.closeTab rejects a missing tabId', async () => {
    const { h } = setup();
    await expect(h['browser.closeTab']!({})).rejects.toMatchObject({ kind: 'validation' });
  });

});
