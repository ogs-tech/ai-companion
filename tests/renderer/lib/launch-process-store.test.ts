import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLaunchProcessesSnapshot,
  markLaunchProcessExited,
  registerLaunchProcess,
  resetLaunchProcessesForTests,
  subscribeLaunchProcesses,
} from '../../../src/renderer/lib/launch-process-store.js';

afterEach(() => {
  resetLaunchProcessesForTests();
});

describe('launch-process-store', () => {
  it('starts empty', () => {
    expect(getLaunchProcessesSnapshot()).toEqual({ processes: [] });
  });

  it('registerLaunchProcess records a process and notifies subscribers', () => {
    const listener = vi.fn();
    subscribeLaunchProcesses(listener);
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    expect(getLaunchProcessesSnapshot().processes).toEqual([
      { processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('registerLaunchProcess replaces an existing entry with the same processId instead of duplicating it', () => {
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    expect(getLaunchProcessesSnapshot().processes).toHaveLength(1);
  });

  it("markLaunchProcessExited updates the matching process's status and exitCode", () => {
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    markLaunchProcessExited('p1', 0);
    expect(getLaunchProcessesSnapshot().processes).toEqual([
      { processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'exited', exitCode: 0 },
    ]);
  });

  it('markLaunchProcessExited is a no-op for an unknown processId', () => {
    markLaunchProcessExited('unknown', 0);
    expect(getLaunchProcessesSnapshot().processes).toEqual([]);
  });

  it('unsubscribing stops further notifications', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLaunchProcesses(listener);
    unsubscribe();
    registerLaunchProcess({ processId: 'p1', projectId: 'proj-1', configName: 'Run', status: 'running', exitCode: null });
    expect(listener).not.toHaveBeenCalled();
  });
});
