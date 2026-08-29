import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { mockApi, ok, makeTestQueryClient, type CallSpy } from '../test-utils.js';
import { useSessionStatus } from '../../../src/renderer/hooks/use-sessions.js';
import type { SessionSnapshot } from '../../../src/shared/session.js';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'entity:urn:skill:foo',
    anchor: { kind: 'entity', urn: 'urn:skill:foo' },
    cwd: '/repos/acme',
    label: 'foo',
    status: 'running',
    ...overrides,
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
});

describe('useSessionStatus', () => {
  it("returns the matching session's status", async () => {
    call.mockImplementation(async (method: string) =>
      method === 'session.list' ? ok([snapshot({ status: 'running' })]) : ok(undefined),
    );
    const { result } = renderHook(() => useSessionStatus({ kind: 'entity', urn: 'urn:skill:foo' }), { wrapper });
    await waitFor(() => expect(result.current).toBe('running'));
  });

  it('returns undefined when no session matches the anchor', async () => {
    call.mockImplementation(async (method: string) => (method === 'session.list' ? ok([]) : ok(undefined)));
    const { result } = renderHook(() => useSessionStatus({ kind: 'workspace', workspaceId: 'w1' }), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalledWith('session.list', {}));
    expect(result.current).toBeUndefined();
  });

  it('distinguishes anchors of different kinds sharing no key overlap', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'session.list' ? ok([snapshot({ sessionId: 'project:p1', anchor: { kind: 'project', projectId: 'p1' }, status: 'exited' })]) : ok(undefined),
    );
    const { result } = renderHook(() => useSessionStatus({ kind: 'workspace', workspaceId: 'p1' }), { wrapper });
    await waitFor(() => expect(call).toHaveBeenCalledWith('session.list', {}));
    expect(result.current).toBeUndefined();
  });

  it('aggregates to "running" when one session for the anchor is running and another has exited', async () => {
    const anchor = { kind: 'workspace' as const, workspaceId: 'w1' };
    call.mockImplementation(async (method: string) =>
      method === 'session.list'
        ? ok([
            snapshot({ sessionId: 'sess-1', anchor, label: 'W', status: 'exited' }),
            snapshot({ sessionId: 'sess-2', anchor, label: 'W (2)', status: 'running' }),
          ])
        : ok(undefined),
    );
    const { result } = renderHook(() => useSessionStatus(anchor), { wrapper });
    await waitFor(() => expect(result.current).toBe('running'));
  });

  it('aggregates to "exited" when every session sharing the anchor has exited', async () => {
    const anchor = { kind: 'workspace' as const, workspaceId: 'w1' };
    call.mockImplementation(async (method: string) =>
      method === 'session.list'
        ? ok([
            snapshot({ sessionId: 'sess-1', anchor, label: 'W', status: 'exited' }),
            snapshot({ sessionId: 'sess-2', anchor, label: 'W (2)', status: 'exited' }),
          ])
        : ok(undefined),
    );
    const { result } = renderHook(() => useSessionStatus(anchor), { wrapper });
    await waitFor(() => expect(result.current).toBe('exited'));
  });
});
