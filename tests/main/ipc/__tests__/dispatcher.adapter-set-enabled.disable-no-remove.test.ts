import { describe, it, expect, vi } from 'vitest';
import { buildHandlers, type IpcDeps } from '../../../../src/main/ipc/registry.js';
import { createDispatcher } from '../../../../src/main/ipc/dispatcher.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import type { SettingsService } from '../../../../src/main/application/services/settings-service.js';

const buildDeps = () => {
  const removeAdapterSymlinks = vi.fn().mockResolvedValue({ removed: 0, skipped: 0, errors: [] });
  const merge = vi.fn().mockResolvedValue({});
  const syncAll = vi.fn().mockResolvedValue([]);
  const adapterManager = { removeAdapterSymlinks, syncAll } as unknown as AdapterManager;
  const settingsService = { merge, load: vi.fn().mockResolvedValue(null), getDefaults: vi.fn().mockReturnValue({}) } as unknown as SettingsService;
  return { adapterManager, settingsService, removeAdapterSymlinks, merge };
};

describe('IPC adapter.setEnabled — disable no remove (AC#7)', () => {
  it('removeSymlinks:false does NOT call removeAdapterSymlinks; just saves settings', async () => {
    const { adapterManager, settingsService, removeAdapterSymlinks, merge } = buildDeps();
    const handlers = buildHandlers({ adapterManager, settingsService } as unknown as IpcDeps);
    const dispatch = createDispatcher(handlers);

    const result = await dispatch('adapter.setEnabled', {
      adapterId: 'claude',
      enabled: false,
      removeSymlinks: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(removeAdapterSymlinks).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalled();
    const data = result.data as { removed: number; skipped: number; errors: unknown[] };
    expect(data.removed).toBe(0);
    expect(data.errors).toHaveLength(0);
  });
});
