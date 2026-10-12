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
  instructionRow?: React.ReactNode;
  pinnedRows?: React.ReactNode;
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
          {...(opts.instructionRow !== undefined ? { instructionRow: opts.instructionRow } : {})}
          {...(opts.pinnedRows !== undefined ? { pinnedRows: opts.pinnedRows } : {})}
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
  it('renders the instructionRow slot pinned above the folders/files', async () => {
    listing({ '': [{ name: 'src', kind: 'dir' }] });
    renderTree({ instructionRow: <div data-testid="instruction-row-slot">Instructions</div> });
    expect(await screen.findByTestId('instruction-row-slot')).toBeInTheDocument();
    expect(await screen.findByText('src')).toBeInTheDocument();
  });

  it('renders the pinnedRows slot between instructionRow and the folders/files', async () => {
    listing({ '': [{ name: 'src', kind: 'dir' }] });
    renderTree({ pinnedRows: <div data-testid="pinned-rows-slot">Launch Configurations</div> });
    expect(await screen.findByTestId('pinned-rows-slot')).toBeInTheDocument();
    expect(await screen.findByText('src')).toBeInTheDocument();
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
    expect(ipc.callIpc).toHaveBeenCalledWith('workspace.listDir', { path: 'apps/web' });
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

  it('"Abrir como workspace" on a folder calls onOpenAsWorkspace with its resolved absolute path', async () => {
    const user = userEvent.setup();
    const onOpenAsWorkspace = vi.fn();
    listing({ '': [{ name: 'apps', kind: 'dir' }] }, { 'workspace.resolvePath': { absolutePath: '/repos/monorepo/apps' } });
    renderTree({ onOpenAsWorkspace });
    await user.click(await screen.findByTestId('tree-node-open-as-workspace-apps'));
    await waitFor(() => expect(onOpenAsWorkspace).toHaveBeenCalledWith('/repos/monorepo/apps'));
  });

  it('"Abrir como workspace" is offered on nested folders too, never on files', async () => {
    const user = userEvent.setup();
    listing({ '': [{ name: 'apps', kind: 'dir' }, { name: 'README.md', kind: 'file' }], apps: [{ name: 'web', kind: 'dir' }] });
    renderTree();
    await user.click(await screen.findByText('apps'));
    expect(await screen.findByTestId('tree-node-open-as-workspace-web')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-node-open-as-workspace-README.md')).not.toBeInTheDocument();
  });

  it('"Abrir como workspace" is keyboard-operable via Enter', async () => {
    const user = userEvent.setup();
    const onOpenAsWorkspace = vi.fn();
    listing({ '': [{ name: 'apps', kind: 'dir' }] }, { 'workspace.resolvePath': { absolutePath: '/repos/monorepo/apps' } });
    renderTree({ onOpenAsWorkspace });
    const control = await screen.findByTestId('tree-node-open-as-workspace-apps');
    control.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenAsWorkspace).toHaveBeenCalledWith('/repos/monorepo/apps'));
  });

  it('shows an error toast when resolving the absolute path fails', async () => {
    const user = userEvent.setup();
    listing({ '': [{ name: 'apps', kind: 'dir' }] }, { 'workspace.resolvePath': new Error('boom') });
    renderTree();
    await user.click(await screen.findByTestId('tree-node-open-as-workspace-apps'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
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
