import { describe, it, expect, vi } from 'vitest';
import { buildHandlers, type IpcDeps } from '../../../../src/main/ipc/registry.js';
import { createDispatcher } from '../../../../src/main/ipc/dispatcher.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import type { SettingsService } from '../../../../src/main/application/services/settings-service.js';

const stubRemoveResult = { removed: 2, skipped: 1, errors: [] };

const buildDeps = () => {
  const removeAdapterSymlinks = vi.fn().mockResolvedValue(stubRemoveResult);
  const removeAdapterGeneratedFiles = vi.fn().mockResolvedValue({ removed: 0, skipped: 0, errors: [] });
  const merge = vi.fn().mockResolvedValue({});
  const syncAll = vi.fn().mockResolvedValue([]);
  const adapterManager = { removeAdapterSymlinks, removeAdapterGeneratedFiles, syncAll } as unknown as AdapterManager;
  const settingsService = { merge, load: vi.fn().mockResolvedValue(null), getDefaults: vi.fn().mockReturnValue({}) } as unknown as SettingsService;
  return { adapterManager, settingsService, removeAdapterSymlinks, merge };
};

describe('IPC adapter.setEnabled — disable with remove (AC#6)', () => {
  it('removeSymlinks:true calls removeAdapterSymlinks("claude") and saves settings', async () => {
    const { adapterManager, settingsService, removeAdapterSymlinks, merge } = buildDeps();
    const handlers = buildHandlers({ adapterManager, settingsService } as unknown as IpcDeps);
    const dispatch = createDispatcher(handlers);

    const result = await dispatch('adapter.setEnabled', {
      adapterId: 'claude',
      enabled: false,
      removeSymlinks: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as typeof stubRemoveResult;
    expect(data.removed).toBe(2);
    expect(removeAdapterSymlinks).toHaveBeenCalledWith('claude');
    expect(merge).toHaveBeenCalled();
  });
});
