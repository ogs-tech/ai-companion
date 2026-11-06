import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  confirmDiscardUnsavedTabs,
  confirmQuit,
  registerQuitGuard,
  registerUnsavedTabsGuard,
} from '../../../src/renderer/lib/workspace-tabs-guard.js';

afterEach(() => {
  registerUnsavedTabsGuard(null);
  registerQuitGuard(null);
});

describe('workspace-tabs-guard', () => {
  it('allows navigation when no guard is registered', async () => {
    await expect(confirmDiscardUnsavedTabs()).resolves.toBe(true);
  });

  it('defers to the registered guard', async () => {
    const guard = vi.fn().mockResolvedValue(false);
    registerUnsavedTabsGuard(guard);
    await expect(confirmDiscardUnsavedTabs()).resolves.toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('allows navigation again once the guard is unregistered', async () => {
    registerUnsavedTabsGuard(async () => false);
    registerUnsavedTabsGuard(null);
    await expect(confirmDiscardUnsavedTabs()).resolves.toBe(true);
  });

  it('lets the window close when no quit guard is registered, and defers to it otherwise', async () => {
    await expect(confirmQuit()).resolves.toBe(true);
    registerQuitGuard(async () => false);
    await expect(confirmQuit()).resolves.toBe(false);
  });
});
