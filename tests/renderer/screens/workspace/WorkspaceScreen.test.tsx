import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { WorkspaceScreen } from '../../../../src/renderer/screens/workspace/WorkspaceScreen.js';
import { SessionFocusProvider } from '../../../../src/renderer/lib/session-focus-context.js';
import { SessionsPanel } from '../../../../src/renderer/components/shell/SessionsPanel.js';
import { mockApi } from '../../test-utils.js';

// WorkspaceScreen opens sessions through the SessionsPanel docked in
// AppShell (SessionFocusProvider) rather than rendering a terminal itself,
// so both are mounted here together, the same way AppShell composes them.
// SessionsPanel -> SessionPanel opens a real xterm Terminal — same
// lightweight mocks as tests/renderer/screens/instructions/instructions-screen.test.tsx
// keep xterm's real browser-only Terminal (canvas, matchMedia) out of jsdom.
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

// Most tests exercise a dedicated (non-default) project workspace, since
// that's the case where the file browser actually renders — see the
// "Global workspace" describe block below for the isDefault:true nudge.
const projectWorkspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };
const globalWorkspace = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const projects = [{ id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '' }];
// A project whose path matches a real top-level folder (`workspaceRootPath/apps`) — the
// FolderTree only shows the "Gerir instructions" shortcut for a folder registered this way.
const registeredProjects = [{ id: 'p1', name: 'apps', path: '/repos/acme/apps', createdAt: '' }];

const renderScreen = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <SessionFocusProvider>
          <WorkspaceScreen />
          <SessionsPanel />
        </SessionFocusProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  mockApi();
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return projectWorkspace;
    if (method === 'project.list') return projects;
    if (method === 'workspace.listDir') return [];
    if (method === 'session.list') return [];
    return undefined;
  });
});

describe('WorkspaceScreen', () => {
  it('shows the active workspace name and root path', async () => {
    renderScreen();
    expect((await screen.findAllByText('Acme')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('/repos/acme')).length).toBeGreaterThan(0);
  });

  it('opening a session on the workspace root spawns with a workspace anchor', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByTestId('workspace-open-session'));
    expect(await screen.findByTestId('sessions-panel-tab-workspace:w1')).toBeInTheDocument();
  });

  it('opening a session for the selected project spawns with a project anchor', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return registeredProjects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir') return [];
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
    await user.click(await screen.findByTestId('project-open-session-p1'));
    expect(await screen.findByTestId('sessions-panel-tab-project:p1')).toBeInTheDocument();
  });

  it('deleting the selected project calls project.delete and reverts to the workspace-level header', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return registeredProjects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir') return [];
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
    await user.click(await screen.findByTestId('project-delete-p1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('project.delete', { id: 'p1' }));
    expect(await screen.findByTestId('workspace-open-session')).toBeInTheDocument();
  });

  it('shows an error toast when deleting the selected project fails', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return registeredProjects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir') return [];
      if (method === 'project.delete') throw new Error('Project not found');
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
    await user.click(await screen.findByTestId('project-delete-p1'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('Project not found');
  });

  it('shows an error toast when "Use as Project" fails', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return projects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'workspace.resolvePath') return { absolutePath: '/repos/apps' };
      if (method === 'project.findOrCreateByPath') throw new Error('boom');
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('tree-node-use-as-project-apps'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
  });

  it('clicking the home ".." row in the folder tree switches back to the Default workspace', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return projects;
      if (method === 'workspace.listDir') return [];
      if (method === 'workspace.switchTo') return globalWorkspace;
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('tree-node-home'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' }));
  });

  it('shows an error toast when navigating home fails', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return projects;
      if (method === 'workspace.listDir') return [];
      if (method === 'workspace.switchTo') throw new Error('disk full');
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('tree-node-home'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('disk full');
  });

  it('selecting a project via the tree scopes the folder tree to project.listDir', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return registeredProjects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }, { name: 'workspace-root-dir', kind: 'dir' }];
      }
      if (method === 'project.listDir' && (params as { projectId: string }).projectId === 'p1') {
        return [{ name: 'project-scoped-file.md', kind: 'file' }];
      }
      return undefined;
    });
    renderScreen();
    expect(await screen.findByText('workspace-root-dir')).toBeInTheDocument();
    await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
    expect(await screen.findByText('project-scoped-file.md')).toBeInTheDocument();
    expect(screen.queryByText('workspace-root-dir')).not.toBeInTheDocument();
    expect(ipc.callIpc).toHaveBeenCalledWith('project.listDir', { projectId: 'p1', path: '' });
  });

  it('clicking the ".." row in the folder tree exits project scope, reverting to the workspace root tree', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return registeredProjects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }, { name: 'workspace-root-dir', kind: 'dir' }];
      }
      if (method === 'project.listDir') return [{ name: 'project-scoped-file.md', kind: 'file' }];
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
    expect(await screen.findByText('project-scoped-file.md')).toBeInTheDocument();
    await user.click(await screen.findByTestId('tree-node-up'));
    expect(await screen.findByText('workspace-root-dir')).toBeInTheDocument();
    expect(screen.queryByText('project-scoped-file.md')).not.toBeInTheDocument();
    expect(await screen.findByTestId('workspace-instruction-row')).toBeInTheDocument();
  });

  describe('instructions row on a project workspace tree', () => {
    it('shows the Workspace Instruction row, empty, when no project is selected', async () => {
      const user = userEvent.setup();
      renderScreen();
      await screen.findByTestId('workspace-instruction-row');
      expect(screen.queryByTestId('project-instruction-row')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('workspace-instruction-row'));
      expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
    });

    it('switches to the Project Instruction row once a project is selected', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [];
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-instruction-row');
      await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
      await screen.findByTestId('project-instruction-row');
      expect(screen.queryByTestId('workspace-instruction-row')).not.toBeInTheDocument();
    });

    it('deleting a configured instruction asks for confirmation before calling instruction.delete', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const workspaceInstruction = {
        urn: 'urn:instruction:acme', kind: 'instruction' as const, name: 'acme',
        description: '', scopes: ['workspace' as const], scopeId: 'w1',
        metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '# Instructions\n',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'instruction.list') return [workspaceInstruction];
        if (method === 'instruction.delete') return { ok: true };
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-instruction-delete'));
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('acme'));
      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('instruction.delete', { name: 'acme', removeSymlinks: true }),
      );
      confirmSpy.mockRestore();
    });
  });

  describe('folder tree "already a Project" shortcut', () => {
    it('hides "Usar como Project" and shows a "Gerir instructions" shortcut for a folder already registered as a Project', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('folder-tree');
      expect(await screen.findByTestId('tree-node-manage-instructions-apps')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-node-use-as-project-apps')).not.toBeInTheDocument();
    });

    it('clicking anywhere on the folder row (not just the shortcut icon) also selects that Project', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByText('apps'));
      await screen.findByTestId('project-instruction-row');
      expect(ipc.callIpc).toHaveBeenCalledWith('project.listDir', { projectId: 'p1', path: '' });
    });

    it('clicking the shortcut selects that Project, scoping the tree and swapping in its Instructions card', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
      await screen.findByTestId('project-instruction-row');
      expect(ipc.callIpc).toHaveBeenCalledWith('project.listDir', { projectId: 'p1', path: '' });
    });
  });

  describe('Global workspace (isDefault)', () => {
    it('shows the instructions row and workspace list instead of a file browser tree', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'project.list') return projects;
        return undefined;
      });
      renderScreen();
      expect(await screen.findByTestId('personal-instruction-row')).toBeInTheDocument();
      expect(await screen.findByTestId('workspace-management-list')).toBeInTheDocument();
      expect(screen.queryByTestId('folder-tree')).not.toBeInTheDocument();
    });

    it('lists other project workspaces in the management card, leaving out the active Default one', async () => {
      const acmeWorkspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'workspace.list') return [globalWorkspace, acmeWorkspace];
        if (method === 'project.list') return projects;
        return undefined;
      });
      renderScreen();
      expect(await screen.findByTestId('workspace-list-row-w1')).toHaveTextContent('Acme');
      expect(screen.queryByTestId('workspace-list-row-default')).not.toBeInTheDocument();
    });

    it('switching workspaces from the management card refreshes the screen in place, with no extra navigation needed', async () => {
      const user = userEvent.setup();
      const acmeWorkspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };
      let active: typeof globalWorkspace | typeof acmeWorkspace = globalWorkspace;
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return active;
        if (method === 'workspace.list') return [globalWorkspace, acmeWorkspace];
        if (method === 'project.list') return active.id === 'default' ? projects : [];
        if (method === 'workspace.listDir') return [];
        if (method === 'workspace.switchTo') {
          active = (params as { id: string }).id === 'w1' ? acmeWorkspace : globalWorkspace;
          return active;
        }
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-list-row-w1');
      await user.click(screen.getByTestId('workspace-list-row-w1'));
      // The screen re-renders in place for the newly active (non-default)
      // workspace — its name shows up and the Global-only management card is
      // gone — with no re-navigation to "Visão geral" required.
      await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0));
      expect(screen.queryByTestId('workspace-management-list')).not.toBeInTheDocument();
    });

    it('shows the Personal Instruction row, empty, and opens the editor on click', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'workspace.list') return [globalWorkspace];
        if (method === 'project.list') return projects;
        if (method === 'instruction.list') return [];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('personal-instruction-row'));
      expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
    });

    it('shows the workspace list in its own toggleable Files panel, matching the non-default workspace treatment', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'workspace.list') return [globalWorkspace];
        if (method === 'project.list') return projects;
        return undefined;
      });
      renderScreen();
      const panel = await screen.findByTestId('workspace-files-panel');
      expect(panel).toContainElement(await screen.findByTestId('workspace-management-list'));
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      expect(screen.queryByTestId('workspace-files-panel')).not.toBeInTheDocument();
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      expect(await screen.findByTestId('workspace-files-panel')).toBeInTheDocument();
    });

    it('opens the editor in edit mode when a Personal Instruction already exists', async () => {
      const user = userEvent.setup();
      const personal = {
        urn: 'urn:instruction:default', kind: 'instruction' as const, name: 'default',
        description: 'personal profile', scopes: ['personal' as const], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '## Section A\n',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'workspace.list') return [globalWorkspace];
        if (method === 'project.list') return projects;
        if (method === 'instruction.list') return [personal];
        if (method === 'instruction.get') return personal;
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('personal-instruction-row'));
      expect(await screen.findByText('Editar Personal Instruction')).toBeInTheDocument();
    });
  });

  describe('Skills/Agents/Hooks/MCP/Plugins tree nodes', () => {
    it('shows every entity-kind tree node on the Default workspace overview, with no global toggle', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'workspace.list') return [globalWorkspace];
        if (method === 'project.list') return projects;
        if (method === 'session.list') return [];
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-management-list');
      expect(screen.getByTestId('tree-group-skill')).toBeInTheDocument();
      expect(screen.getByTestId('tree-group-agent')).toBeInTheDocument();
      expect(screen.getByTestId('tree-group-hook')).toBeInTheDocument();
      expect(screen.getByTestId('tree-group-mcp')).toBeInTheDocument();
      expect(screen.getByTestId('tree-group-plugin')).toBeInTheDocument();
      expect(screen.getByTestId('tree-group-session')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-toggle-global')).not.toBeInTheDocument();
    });

    it('inside a non-default workspace, offers a toggle to reveal global entities, hidden by default', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.list') {
          return [
            { urn: 'urn:skill:local', kind: 'skill', name: 'local', description: '', scopes: ['workspace'], scopeId: 'w1', metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: '' },
            { urn: 'urn:skill:global', kind: 'skill', name: 'global', description: '', scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: '' },
          ];
        }
        return undefined;
      });
      renderScreen();
      const toggle = await screen.findByTestId('workspace-toggle-global');
      expect(toggle).toHaveTextContent('Mostrar globais');
      await user.click(await screen.findByTestId('tree-group-skill'));
      expect(await screen.findByTestId('tree-skill-local')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-skill-global')).not.toBeInTheDocument();

      await user.click(toggle);
      expect(toggle).toHaveTextContent('Ocultar globais');
      expect(await screen.findByTestId('tree-skill-global')).toBeInTheDocument();
    });
  });

  describe('Sessions tree node', () => {
    const runningSession = {
      sessionId: 'project:p1',
      anchor: { kind: 'project' as const, projectId: 'p1' },
      cwd: '/repos/acme',
      label: 'acme',
      status: 'running' as const,
    };
    const exitedSession = {
      sessionId: 'entity:urn:skill:foo',
      anchor: { kind: 'entity' as const, urn: 'urn:skill:foo' },
      cwd: '/repos/acme',
      label: 'foo',
      status: 'exited' as const,
    };

    it('hides finished sessions until "Mostrar finalizadas" is toggled on', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [runningSession, exitedSession];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-session'));
      expect(await screen.findByTestId('tree-session-project:p1')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-session-entity:urn:skill:foo')).not.toBeInTheDocument();

      const toggle = await screen.findByTestId('workspace-toggle-finished-sessions');
      expect(toggle).toHaveTextContent('Mostrar finalizadas');
      await user.click(toggle);
      expect(toggle).toHaveTextContent('Ocultar finalizadas');
      expect(await screen.findByTestId('tree-session-entity:urn:skill:foo')).toBeInTheDocument();
    });

    it('clicking a listed session focuses it in the persistent sessions panel', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [runningSession];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-session'));
      await user.click(await screen.findByTestId('tree-session-project:p1'));
      expect(await screen.findByTestId('sessions-panel-tab-project:p1')).toBeInTheDocument();
    });
  });

  describe('Customizations open in a dialog, not the file canvas', () => {
    it('opening the instruction editor opens a dialog and keeps the tree mounted underneath', async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(await screen.findByTestId('workspace-instruction-row'));
      expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
      expect(screen.getByTestId('folder-tree')).toBeInTheDocument();
    });

    it('creating a new skill opens a dialog without replacing the tree group', async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-skill'));
      await user.click(await screen.findByTestId('tree-group-new-skill'));
      expect(await screen.findByTestId('customization-editor')).toBeInTheDocument();
      expect(screen.getByTestId('tree-group-skill')).toBeInTheDocument();
    });

    it('separates Sessões from Customizations as two distinct rail sections', async () => {
      renderScreen();
      expect(await screen.findByTestId('tree-group-session')).toBeInTheDocument();
      expect(await screen.findByText('Customizations')).toBeInTheDocument();
    });
  });

  describe('Files panel', () => {
    it('can be hidden and shown again from the header toggle', async () => {
      const user = userEvent.setup();
      renderScreen();
      expect(await screen.findByTestId('workspace-files-panel')).toBeInTheDocument();
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      expect(screen.queryByTestId('workspace-files-panel')).not.toBeInTheDocument();
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      expect(await screen.findByTestId('workspace-files-panel')).toBeInTheDocument();
    });

    it('opening two files keeps both tabs mounted and toggles which is visible', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }, { name: 'b.md', kind: 'file' }];
        if (method === 'project.readFile') {
          const path = (params as { path: string }).path;
          return { previewable: true, truncated: false, content: `content of ${path}` };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
      await user.click(await screen.findByText('a.md'));
      expect(await screen.findByText('content of a.md')).toBeVisible();

      await user.click(await screen.findByText('b.md'));
      expect(await screen.findByText('content of b.md')).toBeVisible();
      expect(screen.getByText('content of a.md')).not.toBeVisible();

      const tabButtons = screen.getAllByTestId(/^workbench-tab-(?!close-)/);
      expect(tabButtons).toHaveLength(2);
      await user.click(tabButtons[0]!);
      expect(screen.getByText('content of a.md')).toBeVisible();
      expect(screen.getByText('content of b.md')).not.toBeVisible();
    });

    it('closing a file tab removes it and shows the empty state once none remain', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
        if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hello' };
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-node-manage-instructions-apps'));
      await user.click(await screen.findByText('a.md'));
      await screen.findByText('hello');
      await user.click(screen.getByLabelText(/^Fechar /));
      expect(screen.queryByText('hello')).not.toBeInTheDocument();
      expect(await screen.findByTestId('empty-state-workbench-empty')).toBeInTheDocument();
    });
  });

  describe('removing the active workspace from its Visão geral header', () => {
    const acme = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };

    it('shows a remove action for the active workspace when it is not Default', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return acme;
        if (method === 'project.list') return [];
        if (method === 'workspace.listDir') return [];
        return undefined;
      });
      renderScreen();
      expect(await screen.findByTestId('workspace-context-remove')).toBeInTheDocument();
    });

    it('does not show a remove action for the Default workspace', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'workspace.list') return [globalWorkspace];
        if (method === 'project.list') return [];
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-management-list');
      expect(screen.queryByTestId('workspace-context-remove')).not.toBeInTheDocument();
    });

    it('confirming removal switches back to Default, then deletes the workspace', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return acme;
        if (method === 'project.list') return [];
        if (method === 'workspace.listDir') return [];
        if (method === 'workspace.switchTo') return globalWorkspace;
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-context-remove'));
      await user.click(await screen.findByTestId('workspace-remove-confirm-btn'));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' }));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.delete', { id: 'w1' }));
    });

    it('canceling the confirmation calls neither switchTo nor delete', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return acme;
        if (method === 'project.list') return [];
        if (method === 'workspace.listDir') return [];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-context-remove'));
      await user.click(await screen.findByTestId('workspace-remove-cancel-btn'));
      await waitFor(() => expect(screen.queryByTestId('workspace-remove-confirm-dialog')).not.toBeInTheDocument());
      expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
      expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.delete', expect.anything());
    });

    it('shows an error toast when the removal fails', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return acme;
        if (method === 'project.list') return [];
        if (method === 'workspace.listDir') return [];
        if (method === 'workspace.switchTo') return globalWorkspace;
        if (method === 'workspace.delete') throw new Error('boom');
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-context-remove'));
      await user.click(await screen.findByTestId('workspace-remove-confirm-btn'));
      expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
    });
  });
});
