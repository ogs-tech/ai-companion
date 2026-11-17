import { describe, it, expect, vi } from 'vitest';
import { buildHandlers, type IpcDeps } from '../../../../src/main/ipc/registry.js';
import { createDispatcher } from '../../../../src/main/ipc/dispatcher.js';
import type { AdapterManager, SymlinkError } from '../../../../src/main/application/services/adapter-manager.js';
import type { SettingsService } from '../../../../src/main/application/services/settings-service.js';

const buildDeps = () => {
  const errors: SymlinkError[] = [{ destination: '/dest/x', kind: 'io', message: 'FS error' }];
  const removeAdapterSymlinks = vi.fn().mockResolvedValue({ removed: 0, skipped: 0, errors });
  const removeAdapterGeneratedFiles = vi.fn().mockResolvedValue({ removed: 0, skipped: 0, errors: [] });
  const merge = vi.fn().mockResolvedValue({});
  const syncAll = vi.fn().mockResolvedValue([]);
  const adapterManager = { removeAdapterSymlinks, removeAdapterGeneratedFiles, syncAll } as unknown as AdapterManager;
  const settingsService = { merge, load: vi.fn().mockResolvedValue(null), getDefaults: vi.fn().mockReturnValue({}) } as unknown as SettingsService;
  return { adapterManager, settingsService, merge, errors };
};

describe('IPC adapter.setEnabled — persist settings even with errors (AC#9)', () => {
  it('settings are saved even when removeAll has errors', async () => {
    const { adapterManager, settingsService, merge } = buildDeps();
    const handlers = buildHandlers({ adapterManager, settingsService } as unknown as IpcDeps);
    const dispatch = createDispatcher(handlers);

    const result = await dispatch('adapter.setEnabled', {
      adapterId: 'claude',
      enabled: false,
      removeSymlinks: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { errors: SymlinkError[] };
    expect(data.errors.length).toBeGreaterThan(0);
    expect(merge).toHaveBeenCalled();
  });
});
