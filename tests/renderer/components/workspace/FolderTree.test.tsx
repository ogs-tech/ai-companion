import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { FolderTree } from '../../../../src/renderer/components/workspace/FolderTree.js';

const renderTree = (onSelectFile = vi.fn(), onUseAsProject = vi.fn()) =>
  render(
    <QueryClientProvider client={queryClient}>
      <FolderTree onSelectFile={onSelectFile} onUseAsProject={onUseAsProject} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
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
});
