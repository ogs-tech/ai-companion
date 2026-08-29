import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getWorkspaceHistorySnapshot,
  navigateWorkspaceHistory,
  pushWorkspaceHistoryEntry,
  registerWorkspaceHistoryApplier,
  resetWorkspaceHistoryForTests,
  subscribeWorkspaceHistory,
  type WorkspaceHistoryEntry,
} from '../../../src/renderer/lib/workspace-history-store.js';

const scopeA: WorkspaceHistoryEntry = { workspaceId: 'w1', projectId: null, activeTabId: null };
const tabA1: WorkspaceHistoryEntry = { workspaceId: 'w1', projectId: null, activeTabId: 'a1' };
const tabA2: WorkspaceHistoryEntry = { workspaceId: 'w1', projectId: null, activeTabId: 'a2' };

afterEach(() => {
  resetWorkspaceHistoryForTests();
});

describe('workspace-history-store', () => {
  it('starts with nothing to go back/forward to', () => {
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: false });
  });

  it('stays disabled after a single push (nothing earlier to go back to)', () => {
    registerWorkspaceHistoryApplier(vi.fn());
    pushWorkspaceHistoryEntry(scopeA);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: false });
  });

  it('enables canGoBack once a second distinct entry is pushed', () => {
    registerWorkspaceHistoryApplier(vi.fn());
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('dedupes a push that matches the current entry', () => {
    registerWorkspaceHistoryApplier(vi.fn());
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(scopeA);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: false });
  });

  it('reads as disabled while no applier is registered, even with entries recorded', () => {
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: false });
    registerWorkspaceHistoryApplier(vi.fn());
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('notifies subscribers only when the reachability actually changes', () => {
    const listener = vi.fn();
    subscribeWorkspaceHistory(listener);
    registerWorkspaceHistoryApplier(vi.fn());
    pushWorkspaceHistoryEntry(scopeA); // canGoBack stays false — no notify
    expect(listener).not.toHaveBeenCalled();
    pushWorkspaceHistoryEntry(tabA1); // canGoBack flips to true — notify
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing stops further notifications', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceHistory(listener);
    registerWorkspaceHistoryApplier(vi.fn());
    unsubscribe();
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('going back applies the previous entry and moves the cursor', async () => {
    const applier = vi.fn().mockResolvedValue('applied');
    registerWorkspaceHistoryApplier(applier);
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    await navigateWorkspaceHistory('back');
    expect(applier).toHaveBeenCalledWith(scopeA);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: true });
  });

  it('going forward after going back re-applies the later entry', async () => {
    const applier = vi.fn().mockResolvedValue('applied');
    registerWorkspaceHistoryApplier(applier);
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    await navigateWorkspaceHistory('back');
    applier.mockClear();
    await navigateWorkspaceHistory('forward');
    expect(applier).toHaveBeenCalledWith(tabA1);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('pushing after going back truncates the forward (redo) entries', async () => {
    const applier = vi.fn().mockResolvedValue('applied');
    registerWorkspaceHistoryApplier(applier);
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    await navigateWorkspaceHistory('back');
    pushWorkspaceHistoryEntry(tabA2);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
    applier.mockClear();
    await navigateWorkspaceHistory('back');
    expect(applier).toHaveBeenCalledWith(scopeA);
  });

  it('does not re-record the location that navigate() itself just applied', async () => {
    const applier = vi.fn().mockImplementation(async (entry: WorkspaceHistoryEntry) => {
      pushWorkspaceHistoryEntry(entry); // simulates WorkspaceScreen's own location effect firing off the state change
      return 'applied' as const;
    });
    registerWorkspaceHistoryApplier(applier);
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    await navigateWorkspaceHistory('back');
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: true });
  });

  it('skips a stale (closed-tab) entry when going back and keeps walking to the next valid one', async () => {
    const applier = vi.fn().mockImplementation(async (entry: WorkspaceHistoryEntry) =>
      entry.activeTabId === 'a1' ? 'stale' : 'applied',
    );
    registerWorkspaceHistoryApplier(applier);
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    pushWorkspaceHistoryEntry(tabA2);
    await navigateWorkspaceHistory('back');
    expect(applier).toHaveBeenNthCalledWith(1, tabA1);
    expect(applier).toHaveBeenNthCalledWith(2, scopeA);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: false, canGoForward: true });
    // the pruned tabA1 entry is gone for good — going forward again lands straight on tabA2
    applier.mockClear();
    await navigateWorkspaceHistory('forward');
    expect(applier).toHaveBeenCalledTimes(1);
    expect(applier).toHaveBeenCalledWith(tabA2);
  });

  it('skips a stale entry when going forward and keeps walking to the next valid one', async () => {
    const applier = vi.fn().mockResolvedValue('applied');
    registerWorkspaceHistoryApplier(applier);
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    pushWorkspaceHistoryEntry(tabA2);
    await navigateWorkspaceHistory('back');
    await navigateWorkspaceHistory('back');
    applier.mockImplementation(async (entry: WorkspaceHistoryEntry) =>
      entry.activeTabId === 'a1' ? 'stale' : 'applied',
    );
    applier.mockClear();
    await navigateWorkspaceHistory('forward');
    expect(applier).toHaveBeenNthCalledWith(1, tabA1);
    expect(applier).toHaveBeenNthCalledWith(2, tabA2);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('stops in place (without pruning) when the applier declines', async () => {
    const applier = vi.fn().mockResolvedValue('declined');
    registerWorkspaceHistoryApplier(applier);
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    await navigateWorkspaceHistory('back');
    expect(applier).toHaveBeenCalledTimes(1);
    expect(getWorkspaceHistorySnapshot()).toEqual({ canGoBack: true, canGoForward: false });
    // the declined entry is still there — trying again re-offers the same entry, not a different one
    applier.mockClear();
    applier.mockResolvedValue('applied');
    await navigateWorkspaceHistory('back');
    expect(applier).toHaveBeenCalledWith(scopeA);
  });

  it('is a no-op when no applier is registered', async () => {
    pushWorkspaceHistoryEntry(scopeA);
    pushWorkspaceHistoryEntry(tabA1);
    await expect(navigateWorkspaceHistory('back')).resolves.toBeUndefined();
  });
});
