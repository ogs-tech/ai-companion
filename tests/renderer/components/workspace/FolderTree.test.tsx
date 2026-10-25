import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { FolderTree } from '../../../../src/renderer/components/workspace/FolderTree.js';

interface RenderTreeOptions {
  onSelectFile?: (relPath: string) => void;
  onOpenAsWorkspace?: (absolutePath: string) => void;
  onPreviewFile?: (relPath: string) => void;
  onNewAction?: (relPath: string) => void;
  onOpenTerminalHere?: (relDir: string) => void;
  isWorkspaceRoot?: (relPath: string) => boolean;
}

const renderTree = (opts: RenderTreeOptions = {}) =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <FolderTree
          onSelectFile={opts.onSelectFile ?? vi.fn()}
          onOpenAsWorkspace={opts.onOpenAsWorkspace ?? vi.fn()}
          {...(opts.onPreviewFile ? { onPreviewFile: opts.onPreviewFile } : {})}
          {...(opts.onNewAction ? { onNewAction: opts.onNewAction } : {})}
          {...(opts.onOpenTerminalHere ? { onOpenTerminalHere: opts.onOpenTerminalHere } : {})}
          {...(opts.isWorkspaceRoot ? { isWorkspaceRoot: opts.isWorkspaceRoot } : {})}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );

/** `workspace.listDir` answers from `tree` by path; anything else resolves `undefined`. */
const listing = (tree: Record<string, { name: string; kind: 'file' | 'dir' }[]>, extra: Record<string, unknown> = {}) =>
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
    if (method === 'workspace.listDir') return tree[(params as { path: string }).path] ?? [];
    if (method in extra) {
      const value = extra[method];
      if (value instanceof Error) throw value;
      return value;
    }
    return undefined;
  });

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.restoreAllMocks();
});

describe('FolderTree', () => {
  describe('context menu — Abrir terminal aqui', () => {
    it('opens a terminal in the folder that was right-clicked', async () => {
      const user = userEvent.setup();
      const onOpenTerminalHere = vi.fn();
      listing({ '': [{ name: 'apps', kind: 'dir' }] });
      renderTree({ onOpenTerminalHere });
      fireEvent.contextMenu(await screen.findByText('apps'));
      await user.click(await screen.findByText('Abrir terminal aqui'));
      expect(onOpenTerminalHere).toHaveBeenCalledWith('apps');
    });

    it('on a file, opens the containing folder — the root for a top-level file', async () => {
      const user = userEvent.setup();
      const onOpenTerminalHere = vi.fn();
      listing({ '': [{ name: 'apps', kind: 'dir' }, { name: 'README.md', kind: 'file' }], apps: [{ name: 'main.ts', kind: 'file' }] });
      renderTree({ onOpenTerminalHere });
      fireEvent.contextMenu(await screen.findByText('README.md'));
      await user.click(await screen.findByText('Abrir terminal aqui'));
      expect(onOpenTerminalHere).toHaveBeenLastCalledWith('');

      await user.click(await screen.findByText('apps'));
      fireEvent.contextMenu(await screen.findByText('main.ts'));
      await user.click(await screen.findByText('Abrir terminal aqui'));
      expect(onOpenTerminalHere).toHaveBeenLastCalledWith('apps');
    });

    it('is not offered without a handler', async () => {
      listing({ '': [{ name: 'apps', kind: 'dir' }] });
      renderTree();
      fireEvent.contextMenu(await screen.findByText('apps'));
      await screen.findByText('New Action');
      expect(screen.queryByText('Abrir terminal aqui')).not.toBeInTheDocument();
    });
  });

  it('lists both root folders and root files of the workspace', async () => {
    listing({ '': [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }] });
    renderTree();
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(await screen.findByText('README.md')).toBeInTheDocument();
  });

  it('expands any folder on click, fetching its children by workspace-relative path', async () => {
    const user = userEvent.setup();
    listing({
      '': [{ name: 'apps', kind: 'dir' }],
      apps: [{ name: 'web', kind: 'dir' }],
      'apps/web': [{ name: 'index.ts', kind: 'file' }],
    });
    renderTree();
    await user.click(await screen.findByText('apps'));
    await user.click(await screen.findByText('web'));
    expect(await screen.findByText('index.ts')).toBeInTheDocument();
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.listDir', { path: 'apps/web', showHidden: false });
  });

  it("calls onSelectFile with a nested file's workspace-relative path", async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    listing({ '': [{ name: 'src', kind: 'dir' }], src: [{ name: 'index.ts', kind: 'file' }] });
    renderTree({ onSelectFile });
    await user.click(await screen.findByText('src'));
    await user.click(await screen.findByText('index.ts'));
    expect(onSelectFile).toHaveBeenCalledWith('src/index.ts');
  });

  it('"Abrir como workspace" in a folder\'s context menu calls onOpenAsWorkspace with its resolved absolute path', async () => {
    const onOpenAsWorkspace = vi.fn();
    listing({ '': [{ name: 'apps', kind: 'dir' }] }, { 'workspace.resolvePath': { absolutePath: '/repos/monorepo/apps' } });
    renderTree({ onOpenAsWorkspace });
    fireEvent.contextMenu(await screen.findByText('apps'));
    fireEvent.click(await screen.findByTestId('row-context-menu-open-as-workspace'));
    await waitFor(() => expect(onOpenAsWorkspace).toHaveBeenCalledWith('/repos/monorepo/apps'));
  });

  it('"Abrir como workspace" is offered on folders only, never on files, and no longer as an inline row action', async () => {
    listing({ '': [{ name: 'apps', kind: 'dir' }, { name: 'README.md', kind: 'file' }] });
    renderTree();
    expect(await screen.findByText('apps')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-open-as-workspace-apps')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(await screen.findByTestId('row-context-menu-new-action')).toBeInTheDocument();
    expect(screen.queryByTestId('row-context-menu-open-as-workspace')).not.toBeInTheDocument();
  });

  it('shows an error toast when resolving the absolute path fails', async () => {
    listing({ '': [{ name: 'apps', kind: 'dir' }] }, { 'workspace.resolvePath': new Error('boom') });
    renderTree();
    fireEvent.contextMenu(await screen.findByText('apps'));
    fireEvent.click(await screen.findByTestId('row-context-menu-open-as-workspace'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
  });

  it('badges a sub-folder that is itself a registered workspace root', async () => {
    const user = userEvent.setup();
    listing({ '': [{ name: 'packages', kind: 'dir' }, { name: 'src', kind: 'dir' }], packages: [{ name: 'api', kind: 'dir' }] });
    renderTree({ isWorkspaceRoot: (relPath) => relPath === 'packages/api' });
    await user.click(await screen.findByText('packages'));
    expect(await screen.findByTestId('tree-node-workspace-badge-api')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-workspace-badge-packages')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-workspace-badge-src')).not.toBeInTheDocument();
  });

  it('shows an error state when the root listing fails', async () => {
    vi.spyOn(ipc, 'callIpc').mockRejectedValue(new Error('EACCES'));
    renderTree();
    expect(await screen.findByTestId('folder-tree-error')).toBeInTheDocument();
  });

  it("shows an inline error indicator when a folder's children fail to load", async () => {
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

  describe('context menu — New Action', () => {
    it('offers both "Preview" and "New Action" on a file row', async () => {
      const onPreviewFile = vi.fn();
      const onNewAction = vi.fn();
      listing({ '': [{ name: 'README.md', kind: 'file' }] });
      renderTree({ onPreviewFile, onNewAction });
      fireEvent.contextMenu(await screen.findByText('README.md'));
      expect(await screen.findByTestId('row-context-menu-preview')).toBeInTheDocument();
      fireEvent.click(await screen.findByTestId('row-context-menu-new-action'));
      expect(onNewAction).toHaveBeenCalledWith('README.md');
    });

    it('offers only "New Action" (no "Preview") on a folder row', async () => {
      const onPreviewFile = vi.fn();
      const onNewAction = vi.fn();
      listing({ '': [{ name: 'src', kind: 'dir' }] });
      renderTree({ onPreviewFile, onNewAction });
      fireEvent.contextMenu(await screen.findByText('src'));
      expect(screen.queryByTestId('row-context-menu-preview')).not.toBeInTheDocument();
      fireEvent.click(await screen.findByTestId('row-context-menu-new-action'));
      expect(onNewAction).toHaveBeenCalledWith('src');
    });
  });

  describe('open with', () => {
    const listOnly = (entries: { name: string; kind: 'file' | 'dir' }[]) =>
      vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
        const path = (params as { path?: string } | undefined)?.path;
        if (method === 'workspace.listDir' && path === '') return entries;
        if (method === 'openWith.suggest') return { primary: [], more: [] };
        return undefined;
      });

    it('offers "Abrir com" and "Revelar no Finder" on a file row', async () => {
      listOnly([{ name: 'README.md', kind: 'file' }]);
      renderTree();

      fireEvent.contextMenu(await screen.findByText('README.md'));

      expect(await screen.findByTestId('row-context-menu-open-with')).toBeInTheDocument();
      expect(screen.getByTestId('row-context-menu-reveal')).toBeInTheDocument();
    });

    it('offers "Abrir com" on a folder row too', async () => {
      listOnly([{ name: 'src', kind: 'dir' }]);
      renderTree();

      fireEvent.contextMenu(await screen.findByText('src'));

      expect(await screen.findByTestId('row-context-menu-open-with')).toBeInTheDocument();
    });

    it('offers "Abrir no navegador" on a file row', async () => {
      listOnly([{ name: 'README.md', kind: 'file' }]);
      renderTree();

      fireEvent.contextMenu(await screen.findByText('README.md'));

      expect(await screen.findByTestId('row-context-menu-open-in-browser')).toBeInTheDocument();
    });

    it('does not offer "Abrir no navegador" on a folder row', async () => {
      listOnly([{ name: 'src', kind: 'dir' }]);
      renderTree();

      fireEvent.contextMenu(await screen.findByText('src'));

      expect(await screen.findByTestId('row-context-menu-open-with')).toBeInTheDocument();
      expect(screen.queryByTestId('row-context-menu-open-in-browser')).not.toBeInTheDocument();
    });

    it('opens the row in the embedded browser, by relative path', async () => {
      const callIpc = vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
        const path = (params as { path?: string } | undefined)?.path;
        if (method === 'workspace.listDir' && path === '') return [{ name: 'README.md', kind: 'file' }];
        if (method === 'openWith.openInBrowser') return { tabId: 'tab-1' };
        return undefined;
      });
      renderTree();

      fireEvent.contextMenu(await screen.findByText('README.md'));
      fireEvent.click(await screen.findByTestId('row-context-menu-open-in-browser'));

      await waitFor(() =>
        expect(callIpc).toHaveBeenCalledWith('openWith.openInBrowser', { path: 'README.md' }),
      );
    });

    it('shows an error toast when opening the row in the embedded browser fails', async () => {
      vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string, params: unknown) => {
        const path = (params as { path?: string } | undefined)?.path;
        if (method === 'workspace.listDir' && path === '') return [{ name: 'README.md', kind: 'file' }];
        if (method === 'openWith.openInBrowser') throw new Error('boom');
        return undefined;
      });
      renderTree();

      fireEvent.contextMenu(await screen.findByText('README.md'));
      fireEvent.click(await screen.findByTestId('row-context-menu-open-in-browser'));

      expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
    });

    it('reveals the row in the file manager, by relative path', async () => {
      const callIpc = listOnly([{ name: 'README.md', kind: 'file' }]);
      renderTree();

      fireEvent.contextMenu(await screen.findByText('README.md'));
      fireEvent.click(await screen.findByTestId('row-context-menu-reveal'));

      await waitFor(() =>
        expect(callIpc).toHaveBeenCalledWith('openWith.reveal', { path: 'README.md' }),
      );
    });

    it('opens the suggestions submenu without closing the row menu', async () => {
      listOnly([{ name: 'README.md', kind: 'file' }]);
      renderTree();

      fireEvent.contextMenu(await screen.findByText('README.md'));
      fireEvent.click(await screen.findByTestId('row-context-menu-open-with'));

      expect(await screen.findByTestId('open-with-menu')).toBeInTheDocument();
      expect(screen.getByTestId('row-context-menu-open-with')).toBeInTheDocument();
    });
  });
});
