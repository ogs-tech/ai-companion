import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStarterPack } from '../../../src/renderer/hooks/use-starter-pack.js';
import { mockApi, ok, type CallSpy } from '../test-utils.js';

const OFFICIAL_REPO = 'anthropics/claude-plugins-official';

interface Plugin {
  name: string;
  description: string;
  source: unknown;
}

const FEATURE_DEV: Plugin = {
  name: 'feature-dev',
  description: 'Build features',
  source: { kind: 'github' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Stateful fake of the IPC backend: `plugin.list` reflects whatever has been
 * installed so far (with its enabled flag), exactly like the real main process.
 * `gate` lets a test hold an install open to simulate navigating away
 * mid-install. `disabled` seeds plugins that are installed but turned off.
 */
function setupApi(
  call: CallSpy,
  plugins: Plugin[],
  options: { gate?: Promise<void>; disabled?: string[] } = {},
): { enabledOf: Map<string, boolean> } {
  const { gate, disabled = [] } = options;
  // id -> enabled. Seeded disabled plugins are installed but off.
  const enabledOf = new Map<string, boolean>(disabled.map((id) => [id, false]));
  call.mockImplementation((method: string, params?: { plugin?: Plugin; id?: string; enabled?: boolean }) => {
    switch (method) {
      case 'marketplace.list':
        return Promise.resolve(
          ok([
            {
              id: 'official',
              source: { kind: 'github', repo: OFFICIAL_REPO },
              manifest: { plugins },
            },
          ]),
        );
      case 'plugin.list':
        return Promise.resolve(ok([...enabledOf].map(([id, enabled]) => ({ id, enabled }))));
      case 'instruction.get':
        return Promise.resolve(ok({ id: 'default' }));
      case 'plugin.installFromMarketplace': {
        const name = params?.plugin?.name;
        const finish = () => {
          if (name) enabledOf.set(name, true);
          return ok(undefined);
        };
        return gate ? gate.then(finish) : Promise.resolve(finish());
      }
      case 'plugin.toggle': {
        if (params?.id) enabledOf.set(params.id, params.enabled ?? true);
        return Promise.resolve(ok(undefined));
      }
      default:
        return Promise.resolve(ok(undefined));
    }
  });
  return { enabledOf };
}

/** Prod-like client: a warm, non-zero staleTime is what hides the seeding side
 * effect on remount, so the bug only reproduces with these defaults. */
function warmClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

describe('useStarterPack', () => {
  it('derives done from server-installed plugins', async () => {
    setupApi(call, [FEATURE_DEV]);
    const client = warmClient();
    const { result } = renderHook(() => useStarterPack(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stateFor('feature-dev')).toBe('idle');

    await act(async () => {
      await result.current.install([FEATURE_DEV]);
    });

    await waitFor(() =>
      expect(result.current.stateFor('feature-dev')).toBe('done'),
    );
  });

  it('keeps install state after the screen unmounts and remounts (warm cache)', async () => {
    setupApi(call, [FEATURE_DEV]);
    const client = warmClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useStarterPack(), { wrapper });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    await act(async () => {
      await first.result.current.install([FEATURE_DEV]);
    });
    await waitFor(() =>
      expect(first.result.current.stateFor('feature-dev')).toBe('done'),
    );

    // Navigate away (Starter Pack -> Plugins) then back: the screen is a different
    // component type, so React unmounts and remounts StarterPackScreen.
    first.unmount();
    const second = renderHook(() => useStarterPack(), { wrapper });

    await waitFor(() =>
      expect(second.result.current.stateFor('feature-dev')).toBe('done'),
    );
  });

  it('finishes an install that was in flight when the screen unmounted', async () => {
    const gate = deferred<void>();
    setupApi(call, [FEATURE_DEV], { gate: gate.promise });
    const client = warmClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useStarterPack(), { wrapper });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    // Kick off the install but DON'T await — it is still in flight.
    let installDone: Promise<unknown>;
    act(() => {
      installDone = first.result.current.install([FEATURE_DEV]);
    });
    await waitFor(() =>
      expect(first.result.current.stateFor('feature-dev')).toBe('loading'),
    );

    // Navigate away mid-install.
    first.unmount();

    // The install resolves while nothing is mounted.
    await act(async () => {
      gate.resolve();
      await installDone;
    });

    // Come back: the finished install must be reflected, not lost.
    const second = renderHook(() => useStarterPack(), { wrapper });
    await waitFor(() =>
      expect(second.result.current.stateFor('feature-dev')).toBe('done'),
    );
  });

  it('shows loading state for an in-flight install across remount', async () => {
    const gate = deferred<void>();
    setupApi(call, [FEATURE_DEV], { gate: gate.promise });
    const client = warmClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useStarterPack(), { wrapper });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    let installDone: Promise<unknown>;
    act(() => {
      installDone = first.result.current.install([FEATURE_DEV]);
    });
    await waitFor(() =>
      expect(first.result.current.stateFor('feature-dev')).toBe('loading'),
    );

    first.unmount();
    const second = renderHook(() => useStarterPack(), { wrapper });

    // The loading indicator survives navigation because the in-flight set
    // lives in the query cache, above the screen.
    await waitFor(() =>
      expect(second.result.current.stateFor('feature-dev')).toBe('loading'),
    );

    await act(async () => {
      gate.resolve();
      await installDone;
    });
    await waitFor(() =>
      expect(second.result.current.stateFor('feature-dev')).toBe('done'),
    );
  });

  it('reports an installed-but-disabled plugin as disabled, not done', async () => {
    setupApi(call, [FEATURE_DEV], { disabled: ['feature-dev'] });
    const client = warmClient();
    const { result } = renderHook(() => useStarterPack(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stateFor('feature-dev')).toBe('disabled');
  });

  it('re-enables a disabled plugin and flips it to done', async () => {
    setupApi(call, [FEATURE_DEV], { disabled: ['feature-dev'] });
    const client = warmClient();
    const { result } = renderHook(() => useStarterPack(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stateFor('feature-dev')).toBe('disabled');

    await act(async () => {
      await result.current.reenable('feature-dev');
    });

    await waitFor(() =>
      expect(result.current.stateFor('feature-dev')).toBe('done'),
    );
  });
});
