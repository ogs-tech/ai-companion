import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, makeTestQueryClient } from '../test-utils.js';
import { entityQueryKey, useInvalidateCustomization } from '../../../src/renderer/hooks/use-customization-list.js';
import { healthQueryKey } from '../../../src/renderer/hooks/use-health-report.js';

beforeEach(() => {
  mockApi();
});

describe('useInvalidateCustomization', () => {
  it('refreshes the list and the health report, so a saved item does not keep a stale ⚠', async () => {
    const client = makeTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useInvalidateCustomization(), { wrapper });
    await result.current('skill');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: entityQueryKey('skill') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: healthQueryKey('personal') });
  });
});
