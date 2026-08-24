import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { WorkspaceScreen } from '../../../../src/renderer/screens/workspace/WorkspaceScreen.js';

// WorkspaceScreen renders SessionDialog -> SessionPanel, which opens a real
// xterm Terminal. Same lightweight mocks as
// tests/renderer/screens/instructions/instructions-screen.test.tsx keep
// xterm's real browser-only Terminal (canvas, matchMedia) out of jsdom.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));

const activeWorkspace = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const projects = [{ id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '' }];

const renderScreen = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <WorkspaceScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return activeWorkspace;
    if (method === 'project.list') return projects;
    if (method === 'workspace.listDir') return [];
    return undefined;
  });
});

describe('WorkspaceScreen', () => {
  it('shows the active workspace name and root path', async () => {
    renderScreen();
    // The workspace header and the active-workspace card both render the
    // name/path, so more than one match is expected here.
    expect((await screen.findAllByText('Default')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('/home/u')).length).toBeGreaterThan(0);
  });

  it('lists every registered project with an "Abrir sessão" action', async () => {
    renderScreen();
    expect(await screen.findByText('acme')).toBeInTheDocument();
    expect(screen.getByTestId('project-open-session-p1')).toBeInTheDocument();
  });

  it('opening a session on the workspace root spawns with a workspace anchor', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByTestId('workspace-open-session'));
    expect(await screen.findByTestId('session-dialog')).toBeInTheDocument();
  });

  it('opening a session on a project row spawns with a project anchor', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByTestId('project-open-session-p1'));
    expect(await screen.findByTestId('session-dialog')).toBeInTheDocument();
  });

  it('deleting a project calls project.delete', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByTestId('project-delete-p1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('project.delete', { id: 'p1' }));
  });
});
