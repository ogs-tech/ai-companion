import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopNav } from '../../../../src/renderer/components/shell/TopNav.js';
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

const noop = () => undefined;

describe('TopNav', () => {
  it('renders the four primary area tabs', () => {
    renderWithShell(<TopNav active="inicio" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.getByTestId('nav-inicio')).toBeInTheDocument();
    expect(screen.getByTestId('nav-biblioteca')).toBeInTheDocument();
    expect(screen.getByTestId('nav-plugins')).toBeInTheDocument();
    expect(screen.getByTestId('nav-diagnostico')).toBeInTheDocument();
  });
  it('selects an area on click', async () => {
    const onSelectArea = vi.fn();
    renderWithShell(<TopNav active="inicio" onSelectArea={onSelectArea} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    await userEvent.click(screen.getByTestId('nav-biblioteca'));
    expect(onSelectArea).toHaveBeenCalledWith('biblioteca');
  });
  it('opens settings and the command palette via their controls', async () => {
    const onOpenSettings = vi.fn();
    const onOpenCommandPalette = vi.fn();
    renderWithShell(<TopNav active="inicio" onSelectArea={noop} onOpenSettings={onOpenSettings} onOpenCommandPalette={onOpenCommandPalette} />);
    await userEvent.click(screen.getByTestId('nav-settings'));
    await userEvent.click(screen.getByTestId('command-palette-trigger'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });
  it('marks only the active area tab as selected (the CSS underline anchor)', () => {
    renderWithShell(<TopNav active="plugins" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.getByTestId('nav-plugins')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('nav-inicio')).toHaveAttribute('aria-selected', 'false');
  });
  it('no longer renders the OGS brand line (moved to the footer)', () => {
    renderWithShell(<TopNav active="inicio" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    expect(screen.queryByText(/TECNOLOGIA BRASIL/i)).not.toBeInTheDocument();
  });
  it('shows the sync StatusPill carrying the health severity', () => {
    renderWithShell(<TopNav active="inicio" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} healthSeverity="error" />);
    expect(screen.getByTestId('status-pill-sync')).toHaveAttribute('data-variant', 'error');
  });
  it('toggles the theme through useThemeMode', async () => {
    renderWithShell(<TopNav active="inicio" onSelectArea={noop} onOpenSettings={noop} onOpenCommandPalette={noop} />);
    await userEvent.click(screen.getByTestId('theme-toggle'));
    expect(call).toHaveBeenCalledWith('settings.merge', expect.objectContaining({ ui: expect.any(Object) }));
  });
});
