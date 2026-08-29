import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { WorkspaceScreen } from '../../../../src/renderer/screens/workspace/WorkspaceScreen.js';
import { navigateWorkspaceHistory, resetWorkspaceHistoryForTests } from '../../../../src/renderer/lib/workspace-history-store.js';
import { mockApi } from '../../test-utils.js';

// A session opens as a Workbench canvas tab (SessionPanel), which opens a
// real xterm Terminal — same lightweight mocks as
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

// Most tests exercise a dedicated (non-default) project workspace, since
// that's the case where the file browser actually renders — see the
// "Global workspace" describe block below for the isDefault:true nudge.
const projectWorkspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };
const globalWorkspace = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
const projects = [{ id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '' }];
// A project whose path matches a real top-level folder (`workspaceRootPath/apps`) — only a
// folder registered this way expands in place (fetching its own `project.listDir`).
const registeredProjects = [{ id: 'p1', name: 'apps', path: '/repos/acme/apps', createdAt: '' }];

const renderScreen = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <WorkspaceScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );

// Filters, panel toggles, and the destructive remove action all live behind
// the header's "⋮" menu now, instead of being separate always-visible
// buttons — open it before reaching for one of those testids.
const openHeaderMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByTestId('workspace-header-menu-button'));
};

// Expands the "apps" Project folder in place and opens one of its files —
// opening the file is what derives Control Panel/Instructions scope onto
// that Project now (there's no dedicated "enter project" gesture anymore).
const openProjectFile = async (user: ReturnType<typeof userEvent.setup>, fileName: string) => {
  await user.click(await screen.findByText('apps'));
  await user.click(await screen.findByText(fileName));
};

// Shared by the "Unsaved changes guard" and "Workbench history" suites — both
// need a dirty in-project file tab.
const openDirtyFileTab = async (user: ReturnType<typeof userEvent.setup>) => {
  (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
    if (method === 'workspace.getActive') return projectWorkspace;
    if (method === 'project.list') return registeredProjects;
    if (method === 'workspace.listDir') {
      const path = (params as { path?: string } | undefined)?.path;
      return path ? [] : [{ name: 'apps', kind: 'dir' }];
    }
    if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
    if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hello' };
    if (method === 'project.writeFile') return undefined;
    return undefined;
  });
  renderScreen();
  await openProjectFile(user, 'a.md');
  await screen.findByText('hello');
  const editor = document.querySelector('[data-testid="body-editor"] .cm-content') as HTMLElement;
  editor.focus();
  // skipClick: user-event's default type() clicks the target first to
  // resolve a caret position, which needs real layout — jsdom has none,
  // so let the .focus() above stand in for it instead.
  await user.type(editor, 'x', { skipClick: true });
  await waitFor(() => expect(screen.getByTestId('workbench-tab-dirty-file:p1:a.md')).toBeInTheDocument());
};

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  resetWorkspaceHistoryForTests();
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

  it('opening a session on the workspace root calls session.spawn with a workspace anchor, opening its Workbench tab', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return projects;
      if (method === 'workspace.listDir') return [];
      if (method === 'session.list') return [];
      if (method === 'session.spawn') {
        return { sessionId: 'sess-w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '' };
      }
      return undefined;
    });
    renderScreen();
    await user.click(await screen.findByTestId('workspace-sessions-new'));
    await waitFor(() =>
      expect(ipc.callIpc).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'workspace', workspaceId: 'w1' } }),
    );
    expect(await screen.findByTestId('workbench-tab-session:sess-w1')).toBeInTheDocument();
    expect(await screen.findByTestId('session-panel')).toBeInTheDocument();
  });

  it('opening a session for the selected project calls session.spawn with a project anchor', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return registeredProjects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
      if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hi' };
      if (method === 'session.list') return [];
      if (method === 'session.spawn') {
        return { sessionId: 'sess-p1', anchor: { kind: 'project', projectId: 'p1' }, cwd: '/repos/acme/apps', label: 'apps', status: 'running', outputBuffer: '' };
      }
      return undefined;
    });
    renderScreen();
    await openProjectFile(user, 'a.md');
    await user.click(await screen.findByTestId('workspace-sessions-new'));
    await waitFor(() =>
      expect(ipc.callIpc).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'project', projectId: 'p1' } }),
    );
    expect(await screen.findByTestId('workbench-tab-session:sess-p1')).toBeInTheDocument();
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
      if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
      if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hi' };
      return undefined;
    });
    renderScreen();
    await openProjectFile(user, 'a.md');
    await openHeaderMenu(user);
    await user.click(await screen.findByTestId('project-delete-p1'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('project.delete', { id: 'p1' }));
    expect(await screen.findByTestId('workspace-sessions-new')).toBeInTheDocument();
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
      if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
      if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hi' };
      if (method === 'project.delete') throw new Error('Project not found');
      return undefined;
    });
    renderScreen();
    await openProjectFile(user, 'a.md');
    await openHeaderMenu(user);
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

  it('opening a file inside a Project scopes the Control Panel to it, without changing the Explorer Panel\'s own root listing', async () => {
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
      if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hi' };
      return undefined;
    });
    renderScreen();
    expect(await screen.findByText('workspace-root-dir')).toBeInTheDocument();
    await openProjectFile(user, 'project-scoped-file.md');
    expect(ipc.callIpc).toHaveBeenCalledWith('project.listDir', { projectId: 'p1', path: '' });
    // The Explorer Panel keeps showing the unscoped workspace root — only the
    // Control Panel's scope (proxied here by the breadcrumb switching to show
    // the Project) follows the opened file.
    expect(await screen.findByText('workspace-root-dir')).toBeInTheDocument();
    await screen.findByTestId('workspace-breadcrumb-workspace-crumb');
  });

  it('clicking the workspace crumb reverts Control Panel scope to the workspace, even with the project file tab still open', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'project.list') return registeredProjects;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path;
        return path ? [] : [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
      if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hi' };
      return undefined;
    });
    renderScreen();
    await openProjectFile(user, 'a.md');
    await screen.findByTestId('workspace-breadcrumb-workspace-crumb');
    await user.click(screen.getByTestId('workspace-breadcrumb-workspace-crumb'));
    await waitFor(() => expect(screen.queryByTestId('workspace-breadcrumb-workspace-crumb')).not.toBeInTheDocument());
    // Unlike a real workspace switch, this never discards the open tab.
    expect(screen.getByTestId('workbench-tab-file:p1:a.md')).toBeInTheDocument();
  });

  describe('instructions row on a project workspace tree', () => {
    it('shows the Workspace Instruction row, empty, when no project is selected', async () => {
      const user = userEvent.setup();
      renderScreen();
      await screen.findByTestId('workspace-instruction-row');
      await user.click(screen.getByTestId('workspace-instruction-row'));
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
    });

    it('keeps the Workspace Instruction row pinned even once a project file is opened — a Project\'s own instruction is reached via its nested row instead', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
        if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hi' };
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-instruction-row');
      await openProjectFile(user, 'a.md');
      // The Control Panel/breadcrumb scope did follow the opened file...
      await screen.findByTestId('workspace-breadcrumb-workspace-crumb');
      // ...but the pinned row at the top of the tree is still the workspace's.
      expect(screen.getByTestId('workspace-instruction-row')).toBeInTheDocument();
      // "apps"'s own instruction is reachable via its nested row instead.
      expect(await screen.findByTestId('tree-node-instructions-apps')).toBeInTheDocument();
    });

    it('opening the pinned Workspace Instruction row also drops any Project scope in view', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
        if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hi' };
        return undefined;
      });
      renderScreen();
      await openProjectFile(user, 'a.md');
      await screen.findByTestId('workspace-breadcrumb-workspace-crumb');
      await user.click(screen.getByTestId('workspace-instruction-row'));
      // The project file's own tab stays open alongside the new one, so
      // assert on the workspace instruction's own tab rather than the
      // (now duplicated) generic "editor-panel" testid.
      expect(await screen.findByTestId('workbench-tab-entity-new:instruction:1')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-breadcrumb-workspace-crumb')).not.toBeInTheDocument();
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
    it('does not show the old "enter project" icon shortcut — a Project\'s Skills/Agents/etc are reached by opening one of its files', async () => {
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
      expect(screen.queryByTestId('tree-node-open-project-apps')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tree-node-use-as-project-apps')).not.toBeInTheDocument();
    });

    it('clicking the folder row expands it in place instead of selecting that Project, showing its own INSTRUCTIONS row nested inside — no "entering" required', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'src', kind: 'dir' }];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByText('apps'));
      expect(await screen.findByText('src')).toBeInTheDocument();
      expect(ipc.callIpc).toHaveBeenCalledWith('project.listDir', { projectId: 'p1', path: '' });
      // The screen's own scope never changed (no project selected), so the
      // top-of-tree row is still the workspace's, not the project's.
      expect(screen.queryByTestId('project-instruction-row')).not.toBeInTheDocument();
      // But "apps"'s own INSTRUCTIONS row is now reachable nested under its
      // folder, pinned above "src" — this is the new capability.
      expect(await screen.findByTestId('tree-node-instructions-apps')).toBeInTheDocument();
      expect(screen.getByTestId('tree-node-instructions-apps')).toHaveTextContent('INSTRUCTIONS');
    });

    it('clicking a Project\'s own INSTRUCTIONS row while it\'s only browsed in place scopes the Control Panel to that Project too, same as opening one of its files', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'src', kind: 'dir' }];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByText('apps'));
      await user.click(await screen.findByTestId('tree-node-instructions-apps'));
      // The Control Panel/breadcrumb now follows the Project, exactly like
      // opening a file from it would — the pinned top-of-tree row stays the
      // workspace's throughout.
      await screen.findByTestId('workspace-breadcrumb-workspace-crumb');
      expect(screen.getByTestId('workspace-instruction-row')).toBeInTheDocument();
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
    });
  });

  describe('Global workspace (isDefault)', () => {
    it('shows the Personal Instruction row pinned inside the Explorer Panel\'s workspace list, not a file browser tree', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'project.list') return projects;
        return undefined;
      });
      renderScreen();
      const managementList = await screen.findByTestId('workspace-management-list');
      expect(managementList).toContainElement(await screen.findByTestId('personal-instruction-row'));
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
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
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
      // The panel is collapsible, not unmounted, so it stays in the DOM
      // (react-resizable-panels shrinks it to 0 rather than removing it).
      await openHeaderMenu(user);
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      await waitFor(() => expect(screen.getByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'true'));
      await openHeaderMenu(user);
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      await waitFor(() => expect(screen.getByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'false'));
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
      // Edit mode (vs. a fresh "create" tab) shows the already-saved body —
      // a blank/seeded tab would have no content to render here.
      expect(await screen.findByText(/Section A/)).toBeInTheDocument();
    });
  });

  describe('Skills/Agents/Hooks/MCP/Plugins tree nodes', () => {
    it('shows every entity-kind tree node on the Default workspace overview, with no global toggle', async () => {
      const user = userEvent.setup();
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
      expect(screen.getByTestId('workspace-sessions-panel')).toBeInTheDocument();
      await openHeaderMenu(user);
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
      await openHeaderMenu(user);
      expect(await screen.findByTestId('workspace-toggle-global')).toHaveTextContent('Mostrar entidades globais');
      // Clicking a menu item both applies the toggle and closes the menu.
      await user.click(screen.getByTestId('workspace-toggle-global'));

      await user.click(await screen.findByTestId('tree-group-skill'));
      expect(await screen.findByTestId('tree-skill-local')).toBeInTheDocument();
      expect(await screen.findByTestId('tree-skill-global')).toBeInTheDocument();

      await openHeaderMenu(user);
      expect(await screen.findByTestId('workspace-toggle-global')).toHaveTextContent('Ocultar entidades globais');
    });
  });

  describe('Session tabs', () => {
    it('clicking "+" twice in a row spawns two independent sessions, each its own Workbench tab (regression: coexistence, not refocus)', async () => {
      const user = userEvent.setup();
      let spawnCount = 0;
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'session.spawn') {
          spawnCount += 1;
          return {
            sessionId: `sess-${spawnCount}`,
            anchor: { kind: 'workspace', workspaceId: 'w1' },
            cwd: '/repos/acme',
            label: spawnCount === 1 ? 'Acme' : `Acme (${spawnCount})`,
            status: 'running',
            outputBuffer: '',
          };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      await screen.findByTestId('workbench-tab-session:sess-1');
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      await screen.findByTestId('workbench-tab-session:sess-2');

      const tabButtons = screen.getAllByTestId(/^workbench-tab-(?!close-)/);
      expect(tabButtons).toHaveLength(2);
    });

    it('closing a session tab drops it from the Workbench without affecting other open tabs', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'session.spawn') {
          return { sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      expect(await screen.findByTestId('workbench-tab-session:workspace:w1')).toBeInTheDocument();
      await user.click(screen.getByTestId('workbench-tab-close-session:workspace:w1'));
      expect(screen.queryByTestId('workbench-tab-session:workspace:w1')).not.toBeInTheDocument();
      expect(await screen.findByTestId('empty-state-workbench-empty')).toBeInTheDocument();
    });

    it('labels the close action "Minimizar" while the session is still running', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running' }];
        }
        if (method === 'session.spawn') {
          return { sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      expect(await screen.findByTestId('workbench-tab-close-session:workspace:w1')).toHaveAttribute(
        'aria-label',
        expect.stringContaining('Minimizar'),
      );
    });

    it('labels the close action "Fechar" once the session has exited', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'session.spawn') {
          return { sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      expect(await screen.findByTestId('workbench-tab-close-session:workspace:w1')).toHaveAttribute(
        'aria-label',
        expect.stringContaining('Fechar'),
      );
    });

    it('offers a consolidated Sessões tree node, and opening a running session from it focuses its Workbench tab with no extra IPC call', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running' }];
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-session-workspace:w1'));
      expect(await screen.findByTestId('workbench-tab-session:workspace:w1')).toBeInTheDocument();
      expect(ipc.callIpc).not.toHaveBeenCalledWith('session.resume', expect.anything());
      expect(ipc.callIpc).not.toHaveBeenCalledWith('session.spawn', expect.anything());
    });

    it('clicking an exited session in the tree resumes it via session.resume and opens its Workbench tab', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'exited' }];
        }
        if (method === 'session.resume') {
          return { sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-session-workspace:w1'));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('session.resume', { sessionId: 'workspace:w1' }));
      expect(await screen.findByTestId('workbench-tab-session:workspace:w1')).toBeInTheDocument();
    });

    it('apagar a session whose tab is open closes that tab too', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running' }];
        }
        if (method === 'session.spawn') {
          return { sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      expect(await screen.findByTestId('workbench-tab-session:workspace:w1')).toBeInTheDocument();

      await user.click(await screen.findByTestId('tree-session-remove-workspace:w1'));
      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('session.remove', { sessionId: 'workspace:w1' }));
      expect(screen.queryByTestId('workbench-tab-session:workspace:w1')).not.toBeInTheDocument();
      confirmSpy.mockRestore();
    });
  });

  describe('Customizations open as tabs in the editor canvas', () => {
    it('opening the instruction editor opens a tab and keeps the tree mounted alongside it', async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(await screen.findByTestId('workspace-instruction-row'));
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tabs')).toBeInTheDocument();
      expect(screen.getByTestId('folder-tree')).toBeInTheDocument();
    });

    it('creating a new skill opens a tab without replacing the tree group', async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-skill'));
      await user.click(await screen.findByTestId('tree-group-new-skill'));
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
      expect(screen.getByTestId('tree-group-skill')).toBeInTheDocument();
    });

    it('editing the same entity twice focuses the existing tab instead of duplicating it', async () => {
      const user = userEvent.setup();
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
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-instruction-row'));
      await user.click(await screen.findByTestId('workspace-instruction-row'));
      const tabButtons = screen.getAllByTestId(/^workbench-tab-(?!close-)/);
      expect(tabButtons).toHaveLength(1);
    });
  });

  describe('Preview via right-click', () => {
    it('right-clicking a file row opens a separate, read-only preview tab alongside its own editing tab', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }];
        if (method === 'project.readFile') return { previewable: true, truncated: false, content: '# Hello' };
        return undefined;
      });
      renderScreen();
      await openProjectFile(user, 'a.md');
      await screen.findByTestId('workbench-tab-file:p1:a.md');

      const folderTree = await screen.findByTestId('folder-tree');
      fireEvent.contextMenu(await within(folderTree).findByText('a.md'));
      await user.click(await screen.findByTestId('row-context-menu-preview'));

      // Both tabs coexist — opening the preview never disturbed the editing tab.
      expect(await screen.findByTestId('workbench-tab-preview:file:p1:a.md')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tab-file:p1:a.md')).toBeInTheDocument();
      expect(screen.queryByTestId('workbench-tab-dirty-preview:file:p1:a.md')).not.toBeInTheDocument();
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    });

    it('right-clicking a skill row opens its body as a read-only preview tab', async () => {
      const user = userEvent.setup();
      const acmeSkill = {
        urn: 'urn:skill:acme', kind: 'skill' as const, name: 'acme', description: '',
        scopes: ['workspace' as const], scopeId: 'w1', metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '# Skill body',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.list') return [acmeSkill];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-skill'));
      fireEvent.contextMenu(await screen.findByTestId('tree-skill-acme'));
      await user.click(await screen.findByTestId('row-context-menu-preview'));

      expect(await screen.findByTestId('workbench-tab-preview:entity:urn:skill:acme')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
      expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
    });

    it('has no context menu on an unconfigured instruction row — nothing saved yet to preview', async () => {
      renderScreen();
      fireEvent.contextMenu(await screen.findByTestId('workspace-instruction-row'));
      expect(screen.queryByTestId('row-context-menu-preview')).not.toBeInTheDocument();
    });
  });

  describe('Files panel', () => {
    it('can be hidden and shown again from the header toggle', async () => {
      const user = userEvent.setup();
      renderScreen();
      expect(await screen.findByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'false');
      await openHeaderMenu(user);
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      await waitFor(() => expect(screen.getByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'true'));
      await openHeaderMenu(user);
      await user.click(await screen.findByTestId('workspace-toggle-files'));
      await waitFor(() => expect(screen.getByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'false'));
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
      await openProjectFile(user, 'a.md');
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

    it('saving a newly created skill updates its tab in place instead of opening a duplicate', async () => {
      const user = userEvent.setup();
      const savedSkill = {
        urn: 'urn:skill:novo', kind: 'skill' as const, name: 'novo', description: '',
        scopes: ['personal' as const], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.save') return { skill: savedSkill, syncReport: [] };
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-skill'));
      await user.click(await screen.findByTestId('tree-group-new-skill'));
      await screen.findByTestId('editor-panel');
      await user.keyboard('{Control>}s{/Control}');
      await waitFor(() => expect(screen.getAllByTestId(/^workbench-tab-(?!close-)/)).toHaveLength(1));
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
      await openProjectFile(user, 'a.md');
      await screen.findByText('hello');
      await user.click(screen.getByLabelText(/^Fechar /));
      expect(screen.queryByText('hello')).not.toBeInTheDocument();
      expect(await screen.findByTestId('empty-state-workbench-empty')).toBeInTheDocument();
    });
  });

  describe('Unsaved changes guard', () => {
    it('shows a dirty dot on the Workbench tab once the open file has unsaved edits', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
    });

    it('asks for confirmation before closing a tab with unsaved edits, and keeps it open when declined', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await user.click(screen.getByLabelText(/^Fechar /));
      expect(confirmSpy).toHaveBeenCalled();
      expect(screen.getByTestId('workbench-tab-file:p1:a.md')).toBeInTheDocument();
    });

    it('closes a tab with unsaved edits once the user confirms discarding them', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await user.click(screen.getByLabelText(/^Fechar /));
      expect(screen.queryByTestId('workbench-tab-file:p1:a.md')).not.toBeInTheDocument();
    });

    it('clears the dirty dot once the edit is saved', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      await user.keyboard('{Control>}s{/Control}');
      await waitFor(() => expect(screen.queryByTestId('workbench-tab-dirty-file:p1:a.md')).not.toBeInTheDocument());
    });

    it('clicking the workspace crumb reverts scope without discarding unsaved edits — it is a view switch, not a real navigation', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      const confirmSpy = vi.spyOn(window, 'confirm');
      await user.click(await screen.findByTestId('workspace-breadcrumb-workspace-crumb'));
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('workbench-tab-file:p1:a.md')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tab-dirty-file:p1:a.md')).toBeInTheDocument();
      expect(await screen.findByTestId('workspace-instruction-row')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-breadcrumb-workspace-crumb')).not.toBeInTheDocument();
    });

    const openDirtyEntityTab = async (user: ReturnType<typeof userEvent.setup>) => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-skill'));
      await user.click(await screen.findByTestId('tree-group-new-skill'));
      await screen.findByTestId('editor-panel');
      const editor = document.querySelector('[data-testid="body-editor"] .cm-content') as HTMLElement;
      editor.focus();
      await user.type(editor, 'x', { skipClick: true });
      await waitFor(() => expect(screen.getByTestId('workbench-tab-dirty-entity-new:skill:1')).toBeInTheDocument());
    };

    it('shows a dirty dot on a new skill tab once it has unsaved content, and asks for confirmation before closing it', async () => {
      const user = userEvent.setup();
      await openDirtyEntityTab(user);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await user.click(screen.getByLabelText(/^Fechar /));
      expect(confirmSpy).toHaveBeenCalled();
      expect(screen.getByTestId('workbench-tab-entity-new:skill:1')).toBeInTheDocument();
    });

    it('clears the dirty dot on an entity tab once the edit is saved', async () => {
      const user = userEvent.setup();
      const savedSkill = {
        urn: 'urn:skill:novo', kind: 'skill' as const, name: 'novo', description: '',
        scopes: ['personal' as const], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: 'x',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.save') return { skill: savedSkill, syncReport: [] };
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-skill'));
      await user.click(await screen.findByTestId('tree-group-new-skill'));
      await screen.findByTestId('editor-panel');
      const editor = document.querySelector('[data-testid="body-editor"] .cm-content') as HTMLElement;
      editor.focus();
      await user.type(editor, 'x', { skipClick: true });
      await waitFor(() => expect(screen.getByTestId('workbench-tab-dirty-entity-new:skill:1')).toBeInTheDocument());
      await user.keyboard('{Control>}s{/Control}');
      await waitFor(() => expect(document.querySelector('[data-testid^="workbench-tab-dirty-"]')).toBeNull());
    });

  });

  describe('Workbench history (back/forward)', () => {
    const renderWithTwoFiles = async (user: ReturnType<typeof userEvent.setup>) => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return registeredProjects;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }];
        }
        if (method === 'project.listDir') return [{ name: 'a.md', kind: 'file' }, { name: 'b.md', kind: 'file' }];
        if (method === 'project.readFile') return { previewable: true, truncated: false, content: 'hello' };
        return undefined;
      });
      renderScreen();
      await openProjectFile(user, 'a.md');
      await screen.findByTestId('workbench-tab-file:p1:a.md');
      await user.click(await screen.findByText('b.md'));
      await screen.findByTestId('workbench-tab-file:p1:b.md');
    };

    it('going back re-selects the previously active Workbench tab', async () => {
      const user = userEvent.setup();
      await renderWithTwoFiles(user);
      expect(screen.getByTestId('workbench-tab-file:p1:b.md')).toHaveAttribute('aria-pressed', 'true');
      await act(async () => {
        await navigateWorkspaceHistory('back');
      });
      expect(screen.getByTestId('workbench-tab-file:p1:a.md')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('workbench-tab-file:p1:b.md')).toHaveAttribute('aria-pressed', 'false');
    });

    it('going forward after going back re-selects the later tab again', async () => {
      const user = userEvent.setup();
      await renderWithTwoFiles(user);
      await act(async () => {
        await navigateWorkspaceHistory('back');
        await navigateWorkspaceHistory('forward');
      });
      expect(screen.getByTestId('workbench-tab-file:p1:b.md')).toHaveAttribute('aria-pressed', 'true');
    });

    it('skips a history step pointing at a tab that has since been closed', async () => {
      const user = userEvent.setup();
      await renderWithTwoFiles(user);
      await user.click(screen.getByTestId('workbench-tab-close-file:p1:a.md'));
      expect(screen.queryByTestId('workbench-tab-file:p1:a.md')).not.toBeInTheDocument();
      // History is [root, a.md (which also derives project scope), b.md];
      // a.md's step is now stale (its tab closed), so going back from b.md
      // skips it and lands on the root step instead — b.md stays open, just
      // no longer active.
      await act(async () => {
        await navigateWorkspaceHistory('back');
      });
      expect(screen.getByTestId('workbench-tab-file:p1:b.md')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tab-file:p1:b.md')).toHaveAttribute('aria-pressed', 'false');
    });

    it('a same-scope history step never prompts to discard unsaved edits (the tab stays open, just unfocused)', async () => {
      const user = userEvent.setup();
      await renderWithTwoFiles(user);
      // Both tabs' editors are mounted at once (only their CSS display
      // toggles) — the active one (b.md) is the second, opened after a.md.
      const editors = screen.getAllByTestId('body-editor');
      const editor = editors[1]?.querySelector('.cm-content') as HTMLElement;
      editor.focus();
      await user.type(editor, 'x', { skipClick: true });
      await waitFor(() => expect(screen.getByTestId('workbench-tab-dirty-file:p1:b.md')).toBeInTheDocument());
      const confirmSpy = vi.spyOn(window, 'confirm');
      await act(async () => {
        await navigateWorkspaceHistory('back');
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('workbench-tab-file:p1:b.md')).toBeInTheDocument();
    });
  });

  describe('Explorer Panel / Control Panel identity', () => {
    it('labels the left aside "Explorer Panel" and the right aside "Control Panel"', async () => {
      renderScreen();
      expect(await screen.findByTestId('workspace-explorer-panel-label')).toHaveTextContent('Explorer Panel');
      expect(await screen.findByTestId('workspace-control-panel-label')).toHaveTextContent('Control Panel');
    });

    it('renders the workspace breadcrumb and its "⋮" menu inside the Explorer Panel, not above it', async () => {
      renderScreen();
      const filesPanel = await screen.findByTestId('workspace-files-panel');
      expect(filesPanel).toContainElement(await screen.findByTestId('workspace-header-menu-button'));
      expect(filesPanel).toHaveTextContent('Acme');
      expect(filesPanel).toHaveTextContent('/repos/acme');
    });
  });

  describe('Customizations aside', () => {
    it('can be collapsed and expanded from the header toggle', async () => {
      const user = userEvent.setup();
      renderScreen();
      expect(await screen.findByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'false');
      await openHeaderMenu(user);
      await user.click(await screen.findByTestId('workspace-toggle-customizations'));
      await waitFor(() => expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'true'));
      await openHeaderMenu(user);
      await user.click(await screen.findByTestId('workspace-toggle-customizations'));
      await waitFor(() => expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'false'));
    });

    it('can also be collapsed and expanded by clicking directly on the aside itself', async () => {
      const user = userEvent.setup();
      renderScreen();
      await user.click(await screen.findByTestId('workspace-customizations-collapse'));
      expect(await screen.findByTestId('workspace-customizations-expand')).toBeInTheDocument();
      await user.click(screen.getByTestId('workspace-customizations-expand'));
      expect(await screen.findByTestId('workspace-customizations-collapse')).toBeInTheDocument();
    });

    it('offers a separate Sessões icon in the collapsed 40px strip, reachable even when the whole aside is hidden', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running' }];
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-customizations-collapse'));
      expect(screen.queryByTestId('workspace-sessions-panel')).not.toBeInTheDocument();
      expect(await screen.findByTestId('workspace-sessions-expand')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-customizations-expand')).toBeInTheDocument();

      await user.click(screen.getByTestId('workspace-sessions-expand'));
      expect(await screen.findByTestId('workspace-sessions-panel')).toBeInTheDocument();
      expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'false');
    });

    it('the Sessões strip icon also re-expands sessões if it had been individually collapsed before the aside was hidden', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running' }];
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-collapse'));
      expect(screen.queryByTestId('tree-session-workspace:w1')).not.toBeInTheDocument();
      await user.click(await screen.findByTestId('workspace-customizations-collapse'));

      await user.click(await screen.findByTestId('workspace-sessions-expand'));
      expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
    });

    it('stacks a separate Sessões panel above Customizations, with its own local collapse independent of the aside', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'project.list') return projects;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running' }];
        }
        return undefined;
      });
      renderScreen();
      const sessionsPanel = await screen.findByTestId('workspace-sessions-panel');
      const customizationsHeader = await screen.findByTestId('workspace-customizations-collapse');
      const position = sessionsPanel.compareDocumentPosition(customizationsHeader);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();

      const collapseButton = screen.getByTestId('workspace-sessions-collapse');
      expect(collapseButton).toHaveAccessibleName('Ocultar sessões');
      await user.click(collapseButton);
      expect(screen.queryByTestId('tree-session-workspace:w1')).not.toBeInTheDocument();
      expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'false');

      // The toggle itself stays visible and reachable once collapsed — its
      // label/icon flips to make the "click here to bring it back" gesture
      // discoverable, instead of looking identical to the expanded state.
      const expandButton = screen.getByTestId('workspace-sessions-collapse');
      expect(expandButton).toHaveAccessibleName('Mostrar sessões');
      await user.click(expandButton);
      expect(await screen.findByTestId('tree-session-workspace:w1')).toBeInTheDocument();
    });
  });

  describe('removing the active workspace from its Visão geral header', () => {
    const acme = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };

    it('shows a remove action for the active workspace when it is not Default', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return acme;
        if (method === 'project.list') return [];
        if (method === 'workspace.listDir') return [];
        return undefined;
      });
      renderScreen();
      await openHeaderMenu(user);
      expect(await screen.findByTestId('workspace-context-remove')).toBeInTheDocument();
    });

    it('does not show a remove action for the Default workspace', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return globalWorkspace;
        if (method === 'workspace.list') return [globalWorkspace];
        if (method === 'project.list') return [];
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-management-list');
      await openHeaderMenu(user);
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
      await openHeaderMenu(user);
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
      await openHeaderMenu(user);
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
      await openHeaderMenu(user);
      await user.click(await screen.findByTestId('workspace-context-remove'));
      await user.click(await screen.findByTestId('workspace-remove-confirm-btn'));
      expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
    });
  });
});
