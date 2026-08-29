import { describe, it, expect, vi, afterEach } from 'vitest';
import { confirmDiscardUnsavedTabs, registerUnsavedTabsGuard } from '../../../src/renderer/lib/workspace-tabs-guard.js';

afterEach(() => {
  registerUnsavedTabsGuard(null);
});

describe('workspace-tabs-guard', () => {
  it('allows navigation when no guard is registered', () => {
    expect(confirmDiscardUnsavedTabs()).toBe(true);
  });

  it('defers to the registered guard', () => {
    const guard = vi.fn().mockReturnValue(false);
    registerUnsavedTabsGuard(guard);
    expect(confirmDiscardUnsavedTabs()).toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('allows navigation again once the guard is unregistered', () => {
    registerUnsavedTabsGuard(() => false);
    registerUnsavedTabsGuard(null);
    expect(confirmDiscardUnsavedTabs()).toBe(true);
  });
});
