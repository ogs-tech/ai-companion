import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginsTreeGroup } from '../../../../src/renderer/components/workspace/PluginsTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import type { PluginListItemIpc } from '../../../../src/shared/plugin-ipc-types.js';

const localPlugin: PluginListItemIpc = {
  id: 'local-plugin',
  origin: 'imported',
  scope: 'project',
  enabled: true,
  installedAt: '2026-05-01T00:00:00Z',
  installedRef: { kind: 'branch', value: 'main' },
};
const personalPlugin: PluginListItemIpc = {
  id: 'personal-plugin',
  origin: 'owned',
  scope: 'personal',
  enabled: true,
  installedAt: '2026-05-01T00:00:00Z',
};

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string, params: unknown) => {
    if (method === 'plugin.list') {
      const scope = (params as { scope?: string } | undefined)?.scope;
      return ok(scope === 'project' ? [localPlugin] : [personalPlugin]);
    }
    if (method === 'plugin.get') return ok(localPlugin);
    return ok(undefined);
  });
});

describe('PluginsTreeGroup', () => {
  it('at the Default tier (no isProjectContext), shows personal-scope plugins', async () => {
    const user = userEvent.setup();
    renderWithShell(<PluginsTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-plugin'));
    expect(await screen.findByTestId('tree-plugin-personal-plugin')).toBeInTheDocument();
  });

  it('inside a project workspace, only shows the project-scope plugin until "Mostrar globais" is on', async () => {
    const user = userEvent.setup();
    renderWithShell(<PluginsTreeGroup isProjectContext showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-plugin'));
    expect(await screen.findByTestId('tree-plugin-local-plugin')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-plugin-personal-plugin')).not.toBeInTheDocument();
  });

  it('reveals the personal-scope plugin once showGlobal is true', async () => {
    const user = userEvent.setup();
    renderWithShell(<PluginsTreeGroup isProjectContext showGlobal />);
    await user.click(await screen.findByTestId('tree-group-plugin'));
    expect(await screen.findByTestId('tree-plugin-local-plugin')).toBeInTheDocument();
    expect(await screen.findByTestId('tree-plugin-personal-plugin')).toBeInTheDocument();
  });

  it('toggling the switch calls plugin.toggle with the item scope', async () => {
    const user = userEvent.setup();
    renderWithShell(<PluginsTreeGroup isProjectContext showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-plugin'));
    await user.click(await screen.findByLabelText('Toggle local-plugin'));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('plugin.toggle', { id: 'local-plugin', scope: 'project', enabled: false }),
    );
  });

  it('clicking a row opens the detail drawer', async () => {
    const user = userEvent.setup();
    renderWithShell(<PluginsTreeGroup isProjectContext showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-plugin'));
    await user.click(await screen.findByTestId('tree-plugin-local-plugin'));
    expect(await screen.findByTestId('detail-drawer-plugin')).toBeInTheDocument();
  });

  it('opens the import dialog via the "+" header action', async () => {
    const user = userEvent.setup();
    renderWithShell(<PluginsTreeGroup showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-new-plugin'));
    expect(await screen.findByTestId('plugin-import-dialog')).toBeInTheDocument();
  });

  it('removes a plugin from the row menu after confirmation', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithShell(<PluginsTreeGroup isProjectContext showGlobal={false} />);
    await user.click(await screen.findByTestId('tree-group-plugin'));
    await user.click(await screen.findByTestId('tree-plugin-menu-local-plugin'));
    await user.click(await screen.findByText('Remover'));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(call).toHaveBeenCalledWith('plugin.remove', { id: 'local-plugin', scope: 'project' }));
    confirmSpy.mockRestore();
  });
});
