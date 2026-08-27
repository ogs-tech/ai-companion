import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../../../../src/renderer/components/shell/AppShell.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.list') return ok([]);
    if (method === 'workspace.getActive') return ok(undefined);
    return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
  });
});

describe('AppShell', () => {
  it('switches to a default sub when entering an area with subs', async () => {
    const onNavigate = vi.fn();
    renderWithShell(
      <AppShell nav={{ area: 'starter-pack' }} onNavigate={onNavigate} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId('nav-workspace'));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'workspace', sub: 'visao-geral' });
  });
  it('switching to Workspace from inside a non-default workspace switches back to Default first (the "go home" gesture)', async () => {
    const onNavigate = vi.fn();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return ok([]);
      if (method === 'workspace.getActive') {
        return ok({ id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' });
      }
      if (method === 'workspace.switchTo') {
        return ok({ id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
      }
      return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
    });
    renderWithShell(
      <AppShell nav={{ area: 'starter-pack' }} onNavigate={onNavigate} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId('nav-workspace'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' }));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'workspace', sub: 'visao-geral' });
  });

  it('re-clicking Workspace while already browsing one of its sub-screens (e.g. Skills) still switches back to Default', async () => {
    const onNavigate = vi.fn();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return ok([]);
      if (method === 'workspace.getActive') {
        return ok({ id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' });
      }
      if (method === 'workspace.switchTo') {
        return ok({ id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
      }
      return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
    });
    renderWithShell(
      <AppShell nav={{ area: 'workspace', sub: 'skills' }} onNavigate={onNavigate} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId('nav-workspace'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' }));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'workspace', sub: 'visao-geral' });
  });

  it('switching to Workspace while already on Default does not call workspace.switchTo', async () => {
    const onNavigate = vi.fn();
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.list') return ok([]);
      if (method === 'workspace.getActive') {
        return ok({ id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
      }
      return ok({ ui: { theme: 'light' }, adapters: { claude: { enabled: true } }, language: 'off' });
    });
    renderWithShell(
      <AppShell nav={{ area: 'starter-pack' }} onNavigate={onNavigate} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId('nav-workspace'));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'workspace', sub: 'visao-geral' });
    expect(call).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
  });

  it('renders the global footer with the OGS Tech brand line', () => {
    renderWithShell(
      <AppShell nav={{ area: 'starter-pack' }} onNavigate={() => undefined} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /OGS Tech/i })).toBeInTheDocument();
  });
  it('opens the command palette on ⌘K', async () => {
    renderWithShell(
      <AppShell nav={{ area: 'starter-pack' }} onNavigate={() => undefined} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });
});
