import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { FolderTree } from '../../../../src/renderer/components/workspace/FolderTree.js';

const renderTree = (onSelectFile = vi.fn(), onUseAsProject = vi.fn()) =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <FolderTree onSelectFile={onSelectFile} onUseAsProject={onUseAsProject} />
      </ThemeProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.restoreAllMocks();
});

describe('FolderTree', () => {
  it('lists the root on mount', async () => {
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.listDir' && (params as { path: string }).path === '') {
        return [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }];
      }
      return [];
    });
    renderTree();
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(await screen.findByText('README.md')).toBeInTheDocument();
  });

  it('expands a folder node on click, fetching its children', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'src', kind: 'dir' }];
      if (method === 'workspace.listDir' && path === 'src') return [{ name: 'index.ts', kind: 'file' }];
      return [];
    });
    renderTree();
    await user.click(await screen.findByText('src'));
    expect(await screen.findByText('index.ts')).toBeInTheDocument();
  });

  it('calls onSelectFile with the file\'s relative path when clicked', async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockResolvedValue([{ name: 'README.md', kind: 'file' }]);
    renderTree(onSelectFile);
    await user.click(await screen.findByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith('README.md');
  });

  it('"Use as Project" on a folder node calls onUseAsProject with the resolved absolute path', async () => {
    const user = userEvent.setup();
    const onUseAsProject = vi.fn();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
      if (method === 'workspace.listDir') return [{ name: 'apps', kind: 'dir' }];
      if (method === 'workspace.resolvePath') return { absolutePath: '/repos/monorepo/apps' };
      return [];
    });
    renderTree(vi.fn(), onUseAsProject);
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
    renderTree(vi.fn(), onUseAsProject);
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

  it('shows an inline error indicator when a folder\'s children fail to load', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
      const path = (params as { path: string }).path;
      if (method === 'workspace.listDir' && path === '') return [{ name: 'src', kind: 'dir' }];
      if (method === 'workspace.listDir' && path === 'src') throw new Error('boom');
      return [];
    });
    renderTree();
    await user.click(await screen.findByText('src'));
    expect(await screen.findByTestId('tree-node-error-src')).toBeInTheDocument();
  });
});
