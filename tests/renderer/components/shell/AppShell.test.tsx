import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
      <AppShell nav={{ area: 'inicio' }} onNavigate={onNavigate} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.click(screen.getByTestId('nav-biblioteca'));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'biblioteca', sub: 'skills' });
  });
  it('renders the global footer with the OGS Tech brand line', () => {
    renderWithShell(
      <AppShell nav={{ area: 'inicio' }} onNavigate={() => undefined} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /OGS Tech/i })).toBeInTheDocument();
  });
  it('opens the command palette on ⌘K', async () => {
    renderWithShell(
      <AppShell nav={{ area: 'inicio' }} onNavigate={() => undefined} onOpenSettings={() => undefined}>
        <div data-testid="screen" />
      </AppShell>,
    );
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });
});
