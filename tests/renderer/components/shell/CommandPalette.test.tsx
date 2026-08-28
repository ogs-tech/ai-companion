import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../../../../src/renderer/components/shell/CommandPalette.js';
import { renderWithShell } from '../../test-utils.js';

const noop = () => undefined;

describe('CommandPalette', () => {
  it('is hidden when closed', () => {
    renderWithShell(<CommandPalette open={false} onClose={noop} onNavigate={noop} />);
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });
  it('filters commands by query and navigates on select', async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    renderWithShell(<CommandPalette open onClose={onClose} onNavigate={onNavigate} />);
    const input = screen.getByTestId('command-palette-input');
    await userEvent.type(input, 'marketplaces');
    await userEvent.click(screen.getByText(/Marketplaces/i));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'marketplaces' });
    expect(onClose).toHaveBeenCalled();
  });
  it('jumps to the Workspace overview via its "Início" quick-jump entry', async () => {
    const onNavigate = vi.fn();
    renderWithShell(<CommandPalette open onClose={noop} onNavigate={onNavigate} />);
    await userEvent.type(screen.getByTestId('command-palette-input'), 'Início');
    await userEvent.click(screen.getByText('Início'));
    expect(onNavigate).toHaveBeenCalledWith({ area: 'workspace' });
  });
});
