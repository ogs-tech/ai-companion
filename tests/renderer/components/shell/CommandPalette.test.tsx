import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../../../../src/renderer/components/shell/CommandPalette.js';
import { renderWithShell } from '../../test-utils.js';

const noop = () => undefined;

describe('CommandPalette', () => {
  it('is hidden when closed', () => {
    renderWithShell(<CommandPalette open={false} onClose={noop} onNavigate={noop} onCreate={noop} />);
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });
  it('filters commands by query and navigates on select', async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    renderWithShell(<CommandPalette open onClose={onClose} onNavigate={onNavigate} onCreate={noop} />);
    const input = screen.getByTestId('command-palette-input');
    await userEvent.type(input, 'hooks');
    await userEvent.click(screen.getByText(/Hooks/i));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'workspace', sub: 'hooks' });
    expect(onClose).toHaveBeenCalled();
  });
  it('jumps to the Workspace overview via its "Visão geral" quick-jump entry', async () => {
    const onNavigate = vi.fn();
    renderWithShell(<CommandPalette open onClose={noop} onNavigate={onNavigate} onCreate={noop} />);
    await userEvent.type(screen.getByTestId('command-palette-input'), 'Visão geral');
    await userEvent.click(screen.getByText('Visão geral'));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'workspace', sub: 'visao-geral' });
  });
  it('offers create actions for editable entities', async () => {
    const onCreate = vi.fn();
    renderWithShell(<CommandPalette open onClose={noop} onNavigate={noop} onCreate={onCreate} />);
    await userEvent.type(screen.getByTestId('command-palette-input'), 'Nova skill');
    await userEvent.click(screen.getByText('Nova skill'));
    expect(onCreate).toHaveBeenCalledWith('skills');
  });
});
