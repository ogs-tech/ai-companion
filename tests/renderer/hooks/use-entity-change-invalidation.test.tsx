import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, makeTestQueryClient } from '../test-utils.js';
import { useEntityChangeInvalidation } from '../../../src/renderer/hooks/use-entity-change-invalidation.js';
import { entityQueryKey } from '../../../src/renderer/hooks/use-customization-list.js';
import { INSTRUCTIONS_QUERY_KEY, PERSONAL_INSTRUCTION_QUERY_KEY } from '../../../src/renderer/hooks/use-instructions.js';
import type { EntityChangedEvent } from '../../../src/shared/entity.js';

beforeEach(() => {
  mockApi();
});

describe('useEntityChangeInvalidation', () => {
  it('invalidates the skill/agent list query for a matching entity:changed event', () => {
    const client = makeTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useEntityChangeInvalidation(), { wrapper });

    const listener = (window.api.entity.onChanged as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (
      event: EntityChangedEvent,
    ) => void;
    listener({ kind: 'skill', urn: 'urn:skill:demo' });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: entityQueryKey('skill') });
  });

  it('invalidates both instruction queries for an instruction entity:changed event', () => {
    const client = makeTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useEntityChangeInvalidation(), { wrapper });

    const listener = (window.api.entity.onChanged as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (
      event: EntityChangedEvent,
    ) => void;
    listener({ kind: 'instruction', urn: 'urn:instruction:acme' });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: INSTRUCTIONS_QUERY_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: PERSONAL_INSTRUCTION_QUERY_KEY });
  });

  it('unsubscribes on unmount', () => {
    const client = makeTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const unsubscribe = vi.fn();
    (window.api.entity.onChanged as ReturnType<typeof vi.fn>).mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useEntityChangeInvalidation(), { wrapper });
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
