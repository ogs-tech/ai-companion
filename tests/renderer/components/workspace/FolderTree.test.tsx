import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { FolderTree } from '../../../../src/renderer/components/workspace/FolderTree.js';
import type { Project } from '../../../../src/shared/project.js';

interface RenderTreeOptions {
  onSelectFile?: (relPath: string, projectId?: string) => void;
  onUseAsProject?: (absolutePath: string) => void;
  instructionRow?: React.ReactNode;
  pinnedRows?: React.ReactNode;
  scopeProjectId?: string;
  workspaceRootPath?: string;
  projects?: ReadonlyArray<Project>;
  onOpenProject?: (projectId: string) => void;
  renderProjectInstructionRow?: (project: Project, depth: number) => React.ReactNode;
}

const renderTree = (opts: RenderTreeOptions = {}) =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <FolderTree
          onSelectFile={opts.onSelectFile ?? vi.fn()}
          onUseAsProject={opts.onUseAsProject ?? vi.fn()}
          {...(opts.instructionRow !== undefined ? { instructionRow: opts.instructionRow } : {})}
          {...(opts.pinnedRows !== undefined ? { pinnedRows: opts.pinnedRows } : {})}
          {...(opts.scopeProjectId ? { scopeProjectId: opts.scopeProjectId } : {})}
          {...(opts.workspaceRootPath !== undefined ? { workspaceRootPath: opts.workspaceRootPath } : {})}
          {...(opts.projects !== undefined ? { projects: opts.projects } : {})}
          {...(opts.onOpenProject !== undefined ? { onOpenProject: opts.onOpenProject } : {})}
          {...(opts.renderProjectInstructionRow !== undefined ? { renderProjectInstructionRow: opts.renderProjectInstructionRow } : {})}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.restoreAllMocks();
});

describe('FolderTree', () => {
  it('renders the instructionRow slot pinned above the folders/files', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.listDir') return [{ name: 'src', kind: 'dir' }];
      return [];
    });
    renderTree({ instructionRow: <div data-testid="instruction-row-slot">Instructions</div> });
    expect(await screen.findByTestId('instruction-row-slot')).toBeInTheDocument();
    expect(await screen.findByText('src')).toBeInTheDocument();
  });

  it('renders the pinnedRows slot between instructionRow and the folders/files', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.listDir') return [{ name: 'src', kind: 'dir' }];
      return [];
    });
    renderTree({ pinnedRows: <div data-testid="pinned-rows-slot">Skills/Agents/Hooks/MCP</div> });
    expect(await screen.findByTestId('pinned-rows-slot')).toBeInTheDocument();
    expect(await screen.findByText('src')).toBeInTheDocument();
  });

  it('lists the root folders on mount, filtering out files — folders-only, for now', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }];
      }
      return [];
    });
    renderTree();
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  it('lists both folders and files when scoped to a Project', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'project.listDir' && (params as { projectId: string }).projectId === 'p1') {
        return [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }];
      }
      return [];
    });
    renderTree({ scopeProjectId: 'p1' });
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(await screen.findByText('README.md')).toBeInTheDocument();
  });

  it('expands a folder node on click, fetching its children, when scoped to a Project', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'project.listDir' && path === '') return [{ name: 'src', kind: 'dir' }];
      if (method === 'project.listDir' && path === 'src') return [{ name: 'index.ts', kind: 'file' }];
      return [];
    });
    renderTree({ scopeProjectId: 'p1' });
    await user.click(await screen.findByText('src'));
    expect(await screen.findByText('index.ts')).toBeInTheDocument();
  });

  it('does not expand a root-level folder in the (unscoped) workspace listing — flat, no depth, for now', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'src', kind: 'dir' }];
      if (method === 'workspace.listDir' && path === 'src') return [{ name: 'index.ts', kind: 'file' }];
      return [];
    });
    renderTree();
    await user.click(await screen.findByText('src'));
    expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.listDir', { path: 'src' });
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });

  it('calls onSelectFile with the file\'s relative path and Project id when clicked, when scoped to a Project', async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([{ name: 'README.md', kind: 'file' }]);
    renderTree({ onSelectFile, scopeProjectId: 'p1' });
    await user.click(await screen.findByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith('README.md', 'p1');
  });

  it('calls onSelectFile with the matched Project id for a file inside a root folder expanded in place — not the (unset) screen scope', async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir' && (params as { projectId: string; path: string }).projectId === 'p1') {
        if ((params as { path: string }).path === '') return [{ name: 'README.md', kind: 'file' }];
      }
      return [];
    });
    renderTree({
      onSelectFile,
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      onOpenProject: vi.fn(),
    });
    await user.click(await screen.findByText('apps'));
    await user.click(await screen.findByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith('README.md', 'p1');
  });

  it('"Use as Project" on a folder node calls onUseAsProject with the resolved absolute path', async () => {
    const user = userEvent.setup();
    const onUseAsProject = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.listDir') return [{ name: 'apps', kind: 'dir' }];
      if (method === 'workspace.resolvePath') return { absolutePath: '/repos/monorepo/apps' };
      return [];
    });
    renderTree({ onUseAsProject });
    await user.click(await screen.findByTestId('tree-node-use-as-project-apps'));
    await waitFor(() => expect(onUseAsProject).toHaveBeenCalledWith('/repos/monorepo/apps'));
  });

  it('"Use as Project" is keyboard-operable via Enter', async () => {
    const user = userEvent.setup();
    const onUseAsProject = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.listDir') return [{ name: 'apps', kind: 'dir' }];
      if (method === 'workspace.resolvePath') return { absolutePath: '/repos/monorepo/apps' };
      return [];
    });
    renderTree({ onUseAsProject });
    const control = await screen.findByTestId('tree-node-use-as-project-apps');
    control.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onUseAsProject).toHaveBeenCalledWith('/repos/monorepo/apps'));
  });

  it('shows an error toast when resolving the absolute path fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.listDir') return [{ name: 'apps', kind: 'dir' }];
      if (method === 'workspace.resolvePath') throw new Error('boom');
      return [];
    });
    renderTree();
    await user.click(await screen.findByTestId('tree-node-use-as-project-apps'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
  });

  it('shows an error state when the root listing fails', async () => {
    vi.spyOn(ipc, 'callIpc').mockRejectedValue(new Error('EACCES'));
    renderTree();
    expect(await screen.findByTestId('folder-tree-error')).toBeInTheDocument();
  });

  it('shows an inline error indicator when a folder\'s children fail to load, when scoped to a Project', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'project.listDir' && path === '') return [{ name: 'src', kind: 'dir' }];
      if (method === 'project.listDir' && path === 'src') throw new Error('boom');
      return [];
    });
    renderTree({ scopeProjectId: 'p1' });
    await user.click(await screen.findByText('src'));
    expect(await screen.findByTestId('tree-node-error-src')).toBeInTheDocument();
  });

  it('"Use as Project" appears on root-level folders in the (unscoped) workspace listing', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'src', kind: 'dir' }];
      return [];
    });
    renderTree();
    expect(await screen.findByTestId('tree-node-use-as-project-src')).toBeInTheDocument();
  });

  it('lists the root via project.listDir and hides "Use as Project" when scoped to a project', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'project.listDir' && (params as { projectId: string }).projectId === 'p1') {
        return [{ name: 'src', kind: 'dir' }];
      }
      return [];
    });
    renderTree({ scopeProjectId: 'p1' });
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(ipc.callIpc).toHaveBeenCalledWith('project.listDir', { projectId: 'p1', path: '' });
    expect(screen.queryByTestId('tree-node-use-as-project-src')).not.toBeInTheDocument();
  });

  it('swaps "Use as Project" for "Abrir customizations do projeto" on a root folder already registered as a Project', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'workspace.listDir' && path === '') {
        return [{ name: 'apps', kind: 'dir' }, { name: 'other', kind: 'dir' }];
      }
      return [];
    });
    renderTree({
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      onOpenProject: vi.fn(),
    });
    expect(await screen.findByTestId('tree-node-open-project-apps')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-use-as-project-apps')).not.toBeInTheDocument();
    // Unmatched sibling folder keeps the normal "Use as Project" affordance.
    expect(await screen.findByTestId('tree-node-use-as-project-other')).toBeInTheDocument();
  });

  it('clicking "Abrir customizations do projeto" calls onOpenProject with the matched Project id', async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'apps', kind: 'dir' }];
      return [];
    });
    renderTree({
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      onOpenProject,
    });
    await user.click(await screen.findByTestId('tree-node-open-project-apps'));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('shows a running-session badge on a root folder row already registered as a Project with an active session', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params?: unknown) => {
      const path = (params as { path?: string } | undefined)?.path;
      if (method === 'workspace.listDir' && path === '') {
        return [{ name: 'apps', kind: 'dir' }, { name: 'other', kind: 'dir' }];
      }
      if (method === 'session.list') {
        return [
          {
            sessionId: 'project:p1',
            anchor: { kind: 'project', projectId: 'p1' },
            cwd: '/repos/monorepo/apps',
            label: 'apps',
            status: 'running',
          },
        ];
      }
      return [];
    });
    renderTree({
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      onOpenProject: vi.fn(),
    });
    expect(await screen.findByText('Ativa')).toBeInTheDocument();
    // Only "apps" has a session — the sibling "other" folder gets no badge.
    expect(screen.getAllByText('Ativa')).toHaveLength(1);
  });

  it('clicking a root folder row already registered as a Project expands it in place, fetching its own children, instead of navigating away', async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir' && (params as { projectId: string; path: string }).projectId === 'p1') {
        const path = (params as { path: string }).path;
        if (path === '') return [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }];
      }
      return [];
    });
    renderTree({
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      onOpenProject,
    });
    await user.click(await screen.findByText('apps'));
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(await screen.findByText('README.md')).toBeInTheDocument();
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('renders renderProjectInstructionRow pinned above a Project folder\'s own children once expanded in place, without "entering" it', async () => {
    const user = userEvent.setup();
    const renderProjectInstructionRow = vi.fn((project: Project, _depth: number) => (
      <div data-testid={`instruction-row-${project.name}`}>{project.name}/INSTRUCTIONS</div>
    ));
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir' && (params as { projectId: string }).projectId === 'p1') {
        return [{ name: 'src', kind: 'dir' }];
      }
      return [];
    });
    renderTree({
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      onOpenProject: vi.fn(),
      renderProjectInstructionRow,
    });
    expect(screen.queryByTestId('instruction-row-apps')).not.toBeInTheDocument();
    await user.click(await screen.findByText('apps'));
    expect(await screen.findByTestId('instruction-row-apps')).toBeInTheDocument();
    expect(renderProjectInstructionRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'apps' }), 1);
  });

  it('does not call renderProjectInstructionRow for a root-level folder that is not a registered Project', async () => {
    const renderProjectInstructionRow = vi.fn(() => <div data-testid="never-rendered" />);
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path?: string } | undefined)?.path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'plain', kind: 'dir' }];
      return [];
    });
    renderTree({ renderProjectInstructionRow });
    expect(screen.queryByTestId('never-rendered')).not.toBeInTheDocument();
    expect(renderProjectInstructionRow).not.toHaveBeenCalled();
  });

  it('expands a grandchild of a root-level Project row using paths relative to the Project, not the workspace', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'apps', kind: 'dir' }];
      }
      if (method === 'project.listDir' && (params as { projectId: string; path: string }).projectId === 'p1') {
        const path = (params as { path: string }).path;
        if (path === '') return [{ name: 'src', kind: 'dir' }];
        if (path === 'src') return [{ name: 'index.ts', kind: 'file' }];
      }
      return [];
    });
    renderTree({
      workspaceRootPath: '/repos/monorepo',
      projects: [{ id: 'p1', name: 'apps', path: '/repos/monorepo/apps', createdAt: '' }],
      onOpenProject: vi.fn(),
    });
    await user.click(await screen.findByText('apps'));
    await user.click(await screen.findByText('src'));
    expect(await screen.findByText('index.ts')).toBeInTheDocument();
  });

});
