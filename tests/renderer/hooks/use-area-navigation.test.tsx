import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useAreaNavigation } from '../../../src/renderer/hooks/use-area-navigation.js';
import { useActiveWorkspace } from '../../../src/renderer/hooks/use-workspaces.js';
import { registerUnsavedTabsGuard } from '../../../src/renderer/lib/workspace-tabs-guard.js';
import { registerAreaOpener } from '../../../src/renderer/lib/workspace-area-store.js';
import { mockApi, ok, makeTestQueryClient, type CallSpy } from '../test-utils.js';

const DEFAULT_WORKSPACE = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const OTHER_WORKSPACE = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

afterEach(() => {
  registerUnsavedTabsGuard(null);
  registerAreaOpener(null);
});

const wrapper = () => {
  const client = makeTestQueryClient();
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

// Renders `useActiveWorkspace` alongside the hook under test so a test can
// wait for the active-workspace query to actually settle before invoking
// `navigate` — calling it while `activeWorkspace` is still `undefined` (the
// query's loading state) would silently take the "already on Default"
// branch, since the hook has no way to distinguish "not loaded yet" from
// "loaded and is Default".
const setup = () => renderHook(() => ({ navigate: useAreaNavigation(), workspace: useActiveWorkspace() }), { wrapper: wrapper() });

describe('useAreaNavigation', () => {
  it("'workspace' on the Default workspace already is a no-op (no switch call)", async () => {
    call.mockImplementation(async (method: string) => (method === 'workspace.getActive' ? ok(DEFAULT_WORKSPACE) : ok(undefined)));
    const { result } = setup();
    await waitFor(() => expect(result.current.workspace.data).toEqual(DEFAULT_WORKSPACE));

    result.current.navigate('workspace');

    expect(call).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });

  it("'workspace' from another workspace switches back to Default", async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(OTHER_WORKSPACE);
      if (method === 'workspace.switchTo') return ok(DEFAULT_WORKSPACE);
      return ok(undefined);
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.workspace.data).toEqual(OTHER_WORKSPACE));

    result.current.navigate('workspace');

    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' }));
  });

  it("'workspace' does nothing when a registered unsaved-tabs guard declines", async () => {
    call.mockImplementation(async (method: string) => (method === 'workspace.getActive' ? ok(OTHER_WORKSPACE) : ok(undefined)));
    registerUnsavedTabsGuard(() => false);
    const { result } = setup();
    await waitFor(() => expect(result.current.workspace.data).toEqual(OTHER_WORKSPACE));

    result.current.navigate('workspace');

    expect(call).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });

  it('opens the area tab directly when already on the Default workspace', async () => {
    call.mockImplementation(async (method: string) => (method === 'workspace.getActive' ? ok(DEFAULT_WORKSPACE) : ok(undefined)));
    const opener = vi.fn();
    registerAreaOpener(opener);
    const { result } = setup();
    await waitFor(() => expect(result.current.workspace.data).toEqual(DEFAULT_WORKSPACE));

    result.current.navigate('diagnostico');

    expect(opener).toHaveBeenCalledWith('diagnostico');
    expect(call).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });

  it('switches back to Default first, then opens the area tab, when starting from another workspace', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(OTHER_WORKSPACE);
      if (method === 'workspace.switchTo') return ok(DEFAULT_WORKSPACE);
      return ok(undefined);
    });
    const opener = vi.fn();
    registerAreaOpener(opener);
    const { result } = setup();
    await waitFor(() => expect(result.current.workspace.data).toEqual(OTHER_WORKSPACE));

    result.current.navigate('marketplaces');

    await waitFor(() => expect(opener).toHaveBeenCalledWith('marketplaces'));
    expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' });
  });

  it('does not open the area tab when a registered unsaved-tabs guard declines', async () => {
    call.mockImplementation(async (method: string) => (method === 'workspace.getActive' ? ok(OTHER_WORKSPACE) : ok(undefined)));
    registerUnsavedTabsGuard(() => false);
    const opener = vi.fn();
    registerAreaOpener(opener);
    const { result } = setup();
    await waitFor(() => expect(result.current.workspace.data).toEqual(OTHER_WORKSPACE));

    result.current.navigate('starter-pack');

    expect(opener).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });
});
