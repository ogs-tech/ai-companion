import { describe, it, expect, vi } from 'vitest';
import { buildHandlers, type IpcDeps } from '../../../../src/main/ipc/registry.js';
import { createDispatcher } from '../../../../src/main/ipc/dispatcher.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import type { SettingsService } from '../../../../src/main/application/services/settings-service.js';
import type { SyncResult } from '../../../../src/shared/sync-result.js';

const stubSyncReport: SyncResult[] = [
  { adapter: 'claude', destination: '/dest/a', status: 'ok' },
];

const buildDeps = () => {
  const syncAll = vi.fn().mockResolvedValue(stubSyncReport);
  const merge = vi.fn().mockResolvedValue({});
  const adapterManager = { syncAll } as unknown as AdapterManager;
  const settingsService = { merge, load: vi.fn().mockResolvedValue(null), getDefaults: vi.fn().mockReturnValue({}) } as unknown as SettingsService;
  return { adapterManager, settingsService, syncAll, merge };
};

describe('IPC adapter.setEnabled — enable (AC#8)', () => {
  it('enabled:true with default runSyncAll → calls syncAll and returns { syncReport }', async () => {
    const { adapterManager, settingsService, syncAll } = buildDeps();
    const handlers = buildHandlers({ adapterManager, settingsService } as unknown as IpcDeps);
    const dispatch = createDispatcher(handlers);

    const result = await dispatch('adapter.setEnabled', {
      adapterId: 'claude',
      enabled: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { syncReport: SyncResult[] };
    expect(data.syncReport).toEqual(stubSyncReport);
    expect(syncAll).toHaveBeenCalledWith({});
  });

  it('enabled:true with runSyncAll:false → syncAll NOT called; syncReport empty', async () => {
    const { adapterManager, settingsService, syncAll } = buildDeps();
    const handlers = buildHandlers({ adapterManager, settingsService } as unknown as IpcDeps);
    const dispatch = createDispatcher(handlers);

    const result = await dispatch('adapter.setEnabled', {
      adapterId: 'claude',
      enabled: true,
      runSyncAll: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { syncReport: SyncResult[] };
    expect(data.syncReport).toHaveLength(0);
    expect(syncAll).not.toHaveBeenCalled();
  });
});
