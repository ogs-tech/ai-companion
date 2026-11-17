import { describe, it, expect, vi } from 'vitest';
import { buildEntityHandlers } from '../../../src/main/ipc/entity-handlers.js';
import { createDispatcher } from '../../../src/main/ipc/dispatcher.js';
import type { EntityService } from '../../../src/main/application/services/entity-service.js';

describe('entity handlers', () => {
  it('entity.setEnabled forwards urn and enabled and returns the sync report', async () => {
    const setEnabled = vi.fn(async () => ({ entity: {}, syncReport: [] }));
    const handlers = buildEntityHandlers({ setEnabled } as unknown as EntityService);
    expect(await handlers['entity.setEnabled']!({ urn: 'urn:mcp:github', enabled: false })).toEqual({ ok: true, syncReport: [] });
    expect(setEnabled).toHaveBeenCalledWith({ urn: 'urn:mcp:github', enabled: false });
  });

  it('entity.setEnabled rejects a missing enabled with kind validation', async () => {
    const dispatch = createDispatcher(buildEntityHandlers({} as EntityService));
    const result = await dispatch('entity.setEnabled', { urn: 'urn:skill:x' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  it('mcp.setEnabled is gone (unknown method → not_found)', async () => {
    const dispatch = createDispatcher(buildEntityHandlers({} as EntityService));
    expect(await dispatch('mcp.setEnabled', { id: 'x', enabled: false })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });
});
