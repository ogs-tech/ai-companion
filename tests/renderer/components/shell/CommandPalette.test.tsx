import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../../../../src/renderer/components/shell/CommandPalette.js';
import { registerAreaOpener } from '../../../../src/renderer/lib/workspace-area-store.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';

const DEFAULT_WORKSPACE = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const OTHER_WORKSPACE = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };

const noop = () => undefined;
let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

afterEach(() => {
  registerAreaOpener(null);
});

describe('CommandPalette', () => {
  it('is hidden when closed', () => {
    call.mockImplementation(async () => ok(DEFAULT_WORKSPACE));
    renderWithShell(<CommandPalette open={false} onClose={noop} />);
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('filters commands by query and opens the Marketplaces Workbench tab on select', async () => {
    call.mockImplementation(async () => ok(DEFAULT_WORKSPACE));
    const opener = vi.fn();
    registerAreaOpener(opener);
    const onClose = vi.fn();
    renderWithShell(<CommandPalette open onClose={onClose} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    const input = screen.getByTestId('command-palette-input');
    await userEvent.type(input, 'marketplaces');
    await userEvent.click(screen.getByText(/Marketplaces/i));

    expect(opener).toHaveBeenCalledWith('marketplaces');
    expect(onClose).toHaveBeenCalled();
  });

  it('jumps back to the Default workspace via its "Início" quick-jump entry', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return ok(OTHER_WORKSPACE);
      if (method === 'workspace.switchTo') return ok(DEFAULT_WORKSPACE);
      return ok(undefined);
    });
    renderWithShell(<CommandPalette open onClose={noop} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.getActive', {}));

    await userEvent.type(screen.getByTestId('command-palette-input'), 'Início');
    await userEvent.click(screen.getByText('Início'));

    await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' }));
  });
});
