import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { WorkspaceScreen } from '../../../../src/renderer/screens/workspace/WorkspaceScreen.js';
import { navigateWorkspaceHistory, resetWorkspaceHistoryForTests } from '../../../../src/renderer/lib/workspace-history-store.js';
import { openManualTab, resetBrowserTabsForTests } from '../../../../src/renderer/lib/browser-tabs-store.js';
import { confirmDiscardUnsavedTabs } from '../../../../src/renderer/lib/workspace-tabs-guard.js';
import { toggleWorkspacePanel, type WorkspacePanelSide } from '../../../../src/renderer/lib/workspace-shell-store.js';
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
    registerLinkProvider = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn();
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));

// Most tests exercise an open workspace, since that's where the file browser
// renders — see the "Início" describe block below for `workspace.getActive`
// answering `null` (no workspace open).
const projectWorkspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '' };

/** `workspace.listDir` over a small tree: an `apps/` folder holding `a.md`. */
const appsTree = (params: unknown): unknown => {
  const path = (params as { path?: string } | undefined)?.path ?? '';
  if (path === '') return [{ name: 'apps', kind: 'dir' }];
  if (path === 'apps') return [{ name: 'a.md', kind: 'file' }];
  return [];
};

/** Waits for the workspace to settle (the Customizations list remounts per scope), then opens the Control Panel's "+" menu. */
const openNewMenu = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await waitFor(() => expect(screen.getByTestId('control-panel-kicker')).toHaveTextContent('Workspace · Acme'));
  await user.click(screen.getByTestId('control-panel-new'));
};

const renderScreen = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <WorkspaceScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );

// The panel toggles live in the TopNav now, outside this screen — they reach
// it through the shell store, exactly as the TopNav buttons do.
const togglePanel = (side: WorkspacePanelSide) => act(() => toggleWorkspacePanel(side));

// Every Workbench tab button except the pinned "Visão geral" one.
const OPEN_TAB_BUTTONS = /^workbench-tab-(?!close-|dirty-|overview$)/;

// Expands the "apps" folder and opens one of its files.
const openFolderFile = async (user: ReturnType<typeof userEvent.setup>, fileName: string) => {
  await user.click(await screen.findByText('apps'));
  await user.click(await screen.findByText(fileName));
};

// Shared by the "Unsaved changes guard" and "Workbench history" suites — both
// need a dirty file tab.
const openDirtyFileTab = async (user: ReturnType<typeof userEvent.setup>) => {
  (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
    if (method === 'workspace.getActive') return projectWorkspace;
    if (method === 'workspace.listDir') return appsTree(params);
    if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hello' };
    if (method === 'workspace.writeFile') return undefined;
    return undefined;
  });
  renderScreen();
  await openFolderFile(user, 'a.md');
  await screen.findByText('hello');
  const editor = document.querySelector('[data-testid="body-editor"] .cm-content') as HTMLElement;
  editor.focus();
  // skipClick: user-event's default type() clicks the target first to
  // resolve a caret position, which needs real layout — jsdom has none,
  // so let the .focus() above stand in for it instead.
  await user.type(editor, 'x', { skipClick: true });
  await waitFor(() => expect(screen.getByTestId('workbench-tab-dirty-file:apps/a.md')).toBeInTheDocument());
};

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  resetWorkspaceHistoryForTests();
  resetBrowserTabsForTests();
  mockApi();
  vi.spyOn(ipc, 'callIpc').mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') return projectWorkspace;
    if (method === 'workspace.listDir') return [];
    if (method === 'session.list') return [];
    if (method === 'browser.list') return [];
    return undefined;
  });
});

describe('WorkspaceScreen', () => {
  describe('Visão geral tab', () => {
    it('is pinned icon-only at index 0, active on entering a context, with no close control', async () => {
      renderScreen();
      const tab = await screen.findByTestId('workbench-tab-overview');
      expect(screen.getAllByTestId(/^workbench-tab-(?!close-|dirty-)/)[0]).toBe(tab);
      expect(tab).toHaveAttribute('aria-pressed', 'true');
      expect(tab).not.toHaveTextContent('Visão geral');
      expect(tab).toHaveAccessibleName('Visão geral');
      expect(screen.queryByTestId('workbench-tab-close-overview')).not.toBeInTheDocument();
      expect(await screen.findByTestId('workspace-overview')).toBeInTheDocument();
    });

    it('renders the Início cards at Início', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        if (method === 'workspace.list') return [];
        return undefined;
      });
      renderScreen();
      expect(await screen.findByTestId('home-overview')).toBeInTheDocument();
    });

    it('becomes active again when the last other tab closes', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return appsTree(params);
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hi' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      expect(await screen.findByTestId('workbench-tab-file:apps/a.md')).toHaveAttribute('aria-pressed', 'true');
      await user.click(screen.getByTestId('workbench-tab-close-file:apps/a.md'));
      expect(screen.getByTestId('workbench-tab-overview')).toHaveAttribute('aria-pressed', 'true');
    });

    it('survives a reset of every tab (a context switch) and is the one left active', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return appsTree(params);
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hi' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      await screen.findByTestId('workbench-tab-file:apps/a.md');
      act(() => {
        expect(confirmDiscardUnsavedTabs()).toBe(true);
      });
      await waitFor(() => expect(screen.queryByTestId('workbench-tab-file:apps/a.md')).not.toBeInTheDocument());
      expect(screen.getByTestId('workbench-tab-overview')).toHaveAttribute('aria-pressed', 'true');
    });

    it('⌘0 activates it', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return appsTree(params);
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hi' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      expect(await screen.findByTestId('workbench-tab-file:apps/a.md')).toHaveAttribute('aria-pressed', 'true');
      fireEvent.keyDown(window, { key: '0', metaKey: true });
      expect(screen.getByTestId('workbench-tab-overview')).toHaveAttribute('aria-pressed', 'true');
    });

    it('"Ver alterações" leaves the Explorer showing the git toolbar over the tree', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'git.status') {
          return { isRepo: true, head: { name: 'main', oid: 'abc', ahead: 0, behind: 0 }, state: 'clean', files: [], truncated: false };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('overview-show-git'));
      expect(await screen.findByTestId('git-head')).toHaveTextContent('main');
      expect(screen.getByTestId('folder-tree')).toBeInTheDocument();
    });
  });

  it('opening a session on the workspace root calls session.spawn with a workspace anchor, opening its Workbench tab', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'workspace.getActive') return projectWorkspace;
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

  describe('browser tabs', () => {
    it('a session’s browser toggle opens a sibling Workbench tab rendering BrowserPane', async () => {
      const user = userEvent.setup();
      const session = {
        sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme',
        label: 'Acme', status: 'running', outputBuffer: '', browserEnabled: false,
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'session.spawn' || method === 'session.status') return session;
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      await screen.findByTestId('workbench-tab-session:sess-1');

      await user.click(await screen.findByTestId('session-browser-toggle'));

      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('browser.enable', { sessionId: 'sess-1' }));
      expect(await screen.findByTestId('workbench-tab-browser:sess-1')).toBeInTheDocument();
      // Two sibling tabs now — the terminal is not replaced or hidden by the browser.
      expect(screen.getByTestId('workbench-tab-session:sess-1')).toBeInTheDocument();
      expect(await screen.findByTestId('browser-pane')).toBeInTheDocument();
    });

    it('closing a session’s browser Workbench tab calls browser.disable, not browser.closeTab, and leaves the session tab alone', async () => {
      const user = userEvent.setup();
      const session = {
        sessionId: 'sess-1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme',
        label: 'Acme', status: 'running', outputBuffer: '', browserEnabled: false,
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'session.spawn' || method === 'session.status') return session;
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      await user.click(await screen.findByTestId('session-browser-toggle'));
      await screen.findByTestId('workbench-tab-browser:sess-1');

      await user.click(await screen.findByTestId('workbench-tab-close-browser:sess-1'));

      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('browser.disable', { sessionId: 'sess-1' }));
      expect(ipc.callIpc).not.toHaveBeenCalledWith('browser.closeTab', expect.anything());
      expect(screen.queryByTestId('workbench-tab-browser:sess-1')).toBeNull();
      expect(screen.getByTestId('workbench-tab-session:sess-1')).toBeInTheDocument();
    });

    it('a manually opened tab (TopNav button, or a redirected external link) shows up as a Workbench tab and closes via browser.closeTab', async () => {
      const user = userEvent.setup();
      renderScreen();
      await screen.findByTestId('workspace-screen');
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'browser.openTab') return { tabId: 'tab-1' };
        return undefined;
      });

      await act(async () => {
        await openManualTab('https://example.com');
      });

      expect(await screen.findByTestId('workbench-tab-browser:tab-1')).toBeInTheDocument();
      expect(await screen.findByTestId('browser-pane')).toBeInTheDocument();

      await user.click(await screen.findByTestId('workbench-tab-close-browser:tab-1'));

      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('browser.closeTab', { tabId: 'tab-1' }));
      expect(screen.queryByTestId('workbench-tab-browser:tab-1')).toBeNull();
    });
  });

  describe('"New Action" context menu', () => {
    it('on the workspace INSTRUCTIONS row: resolves its path, spawns a workspace-anchored session, and writes the draft once ready (non-empty outputBuffer)', async () => {
      const user = userEvent.setup();
      const workspaceInstruction = {
        urn: 'urn:instruction:w1', kind: 'instruction', name: 'w1', description: '',
        scopes: ['workspace'], scopeId: 'w1',
        metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' }, content: '',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'instruction.list') return [workspaceInstruction];
        if (method === 'instruction.resolvePath') return { absolutePath: '/repos/acme/.ai-companion/instructions/project/w1/INSTRUCTION.md' };
        if (method === 'session.spawn') {
          return {
            sessionId: 'sess-new-action', anchor: { kind: 'workspace', workspaceId: 'w1' },
            cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: 'Welcome to claude\n',
          };
        }
        return undefined;
      });
      renderScreen();
      const row = await screen.findByTestId(`workspace-instruction-row-${workspaceInstruction.name}`);
      fireEvent.contextMenu(row);
      const item = await screen.findByTestId('row-context-menu-new-action');
      await user.click(item);

      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'workspace', workspaceId: 'w1' } }),
      );
      expect(await screen.findByTestId('workbench-tab-session:sess-new-action')).toBeInTheDocument();
      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('session.write', {
          sessionId: 'sess-new-action',
          data: '@/repos/acme/.ai-companion/instructions/project/w1/INSTRUCTION.md — describe the new action you want to create based on this',
        }),
      );
    });

    it('on a workspace-scoped Skill row: anchors the session to the skill\'s own workspace', async () => {
      const user = userEvent.setup();
      const workspaceSkill = {
        urn: 'urn:skill:helper', kind: 'skill', name: 'helper', description: '',
        scopes: ['workspace'], scopeId: 'w1',
        metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' }, content: '',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'skill.list') return [workspaceSkill];
        if (method === 'skill.resolvePath') return { absolutePath: '/repos/acme/.ai-companion/skills/helper/SKILL.md' };
        if (method === 'session.spawn') {
          return {
            sessionId: 'sess-skill', anchor: { kind: 'workspace', workspaceId: 'w1' },
            cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: 'ready\n',
          };
        }
        return undefined;
      });
      renderScreen();
      const row = await screen.findByTestId('tree-skill-helper');
      fireEvent.contextMenu(row);
      const item = await screen.findByTestId('row-context-menu-new-action');
      await user.click(item);

      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'workspace', workspaceId: 'w1' } }),
      );
      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('session.write', {
          sessionId: 'sess-skill',
          data: '@/repos/acme/.ai-companion/skills/helper/SKILL.md — describe the new action you want to create based on this',
        }),
      );
    });

    it('on a file row: uses its workspace-relative path directly (no resolvePath round trip) and defers the write until the session emits its first output', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return appsTree(params);
        if (method === 'session.list') return [];
        if (method === 'session.spawn') {
          return {
            sessionId: 'sess-file', anchor: { kind: 'workspace', workspaceId: 'w1' },
            cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '',
          };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByText('apps'));
      const row = await screen.findByText('a.md');
      fireEvent.contextMenu(row);
      const item = await screen.findByTestId('row-context-menu-new-action');
      await user.click(item);

      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('session.spawn', { anchor: { kind: 'workspace', workspaceId: 'w1' } }),
      );
      expect(ipc.callIpc).not.toHaveBeenCalledWith('workspace.resolvePath', expect.anything());
      // Nothing written yet — outputBuffer was empty, so it's waiting on the session's first live output.
      expect(ipc.callIpc).not.toHaveBeenCalledWith('session.write', expect.anything());

      // SessionPanel itself also subscribes to onOutput once it mounts for
      // this tab — with no guaranteed ordering against our own subscription
      // — so fire every listener registered for this sessionId rather than
      // assuming which one is "ours".
      const onOutputCalls = (window.api.session.onOutput as Mock).mock.calls as [string, (chunk: string) => void][];
      const listenersForSession = onOutputCalls.filter(([id]) => id === 'sess-file').map(([, listener]) => listener);
      expect(listenersForSession.length).toBeGreaterThan(0);
      listenersForSession.forEach((listener) => listener('$ '));

      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('session.write', {
          sessionId: 'sess-file',
          data: '@apps/a.md — describe the new action you want to create based on this',
        }),
      );
    });
  });

  it('"Abrir como workspace" on a folder opens it via workspace.open and discards the open tabs', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'workspace.listDir') return appsTree(params);
      if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hi' };
      if (method === 'workspace.resolvePath') return { absolutePath: '/repos/acme/apps' };
      if (method === 'workspace.open') return { id: 'w2', name: 'apps', rootPath: '/repos/acme/apps', createdAt: '' };
      return undefined;
    });
    renderScreen();
    await openFolderFile(user, 'a.md');
    fireEvent.contextMenu(await screen.findByText('apps'));
    await user.click(await screen.findByTestId('row-context-menu-open-as-workspace'));
    await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.open', { path: '/repos/acme/apps' }));
    expect(screen.queryByTestId('workbench-tab-file:apps/a.md')).not.toBeInTheDocument();
    expect(await screen.findByTestId('toast')).toHaveTextContent('Workspace aberto: apps');
  });

  it('shows an error toast when "Abrir como workspace" fails', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'workspace.listDir') return appsTree(params);
      if (method === 'workspace.resolvePath') return { absolutePath: '/repos/acme/apps' };
      if (method === 'workspace.open') throw new Error('boom');
      return undefined;
    });
    renderScreen();
    fireEvent.contextMenu(await screen.findByText('apps'));
    await user.click(await screen.findByTestId('row-context-menu-open-as-workspace'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
  });

  it('reaching Home via the external "Início" nav (switcher, ⌘K) clears the open tabs through the registered guard', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'workspace.listDir') return appsTree(params);
      if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hi' };
      return undefined;
    });
    renderScreen();
    await openFolderFile(user, 'a.md');
    expect(await screen.findByTestId('workbench-tab-file:apps/a.md')).toBeInTheDocument();

    // `useAreaNavigation`'s "Início" branch (AppShell/CommandPalette) reaches
    // this screen only through the registered guard, then goes home on its own.
    expect(confirmDiscardUnsavedTabs()).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('workbench-tab-file:apps/a.md')).not.toBeInTheDocument());
  });

  describe('Instruction group (right panel)', () => {
    it('with no workspace instruction yet, "+" opens a new instruction editor', async () => {
      const user = userEvent.setup();
      renderScreen();
      await openNewMenu(user);
      await user.click(await screen.findByTestId('control-panel-new-instruction'));
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
    });

    it('lists the workspace instructions by name; deleting one asks for confirmation first', async () => {
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
        if (method === 'workspace.listDir') return [];
        if (method === 'instruction.list') return [workspaceInstruction];
        if (method === 'instruction.delete') return { ok: true };
        return undefined;
      });
      renderScreen();
      expect(await screen.findByTestId('workspace-instruction-row-acme')).toHaveTextContent('acme');
      await user.click(screen.getByTestId('workspace-instruction-row-acme-delete'));
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('acme'));
      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('instruction.delete', { name: 'acme', removeSymlinks: true }),
      );
      confirmSpy.mockRestore();
    });

    it('is no longer a row in the left file tree', async () => {
      renderScreen();
      await screen.findByTestId('folder-tree');
      expect(within(screen.getByTestId('workspace-files-panel')).queryByText('INSTRUCTIONS')).not.toBeInTheDocument();
    });
  });

  describe('folder tree', () => {
    it('offers "Abrir como workspace" in a folder\'s context menu and no Project shortcuts at all', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return appsTree(params);
        return undefined;
      });
      renderScreen();
      fireEvent.contextMenu(await screen.findByText('apps'));
      expect(await screen.findByTestId('row-context-menu-open-as-workspace')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-node-open-project-apps')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tree-node-use-as-project-apps')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tree-node-instructions-apps')).not.toBeInTheDocument();
    });

    it('expands any folder and opens its files through the workspace\'s own IPC calls', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return appsTree(params);
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hello' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      await screen.findByText('hello');
      expect(ipc.callIpc).toHaveBeenCalledWith('workspace.listDir', { path: 'apps' });
      expect(ipc.callIpc).toHaveBeenCalledWith('workspace.readFile', { path: 'apps/a.md' });
    });
  });

  describe('Launch Configurations', () => {
    it("shows the workspace's Launch Configurations group pinned once; running a config opens a Workbench tab", async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'launchConfig.list') {
          return { workspaceId: 'w1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] };
        }
        if (method === 'launchConfig.run') {
          return { processId: 'proc-1', workspaceId: 'w1', configName: 'Run server', status: 'running', exitCode: null };
        }
        if (method === 'launchConfig.status') {
          return { processId: 'proc-1', workspaceId: 'w1', configName: 'Run server', status: 'running', exitCode: null, outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-launch-configs-Acme'));
      await user.click(await screen.findByTestId('tree-launch-config-Acme-Run server'));
      expect(await screen.findByTestId('workbench-tab-launch-process:proc-1')).toBeInTheDocument();
      expect(ipc.callIpc).toHaveBeenCalledWith('launchConfig.run', { configName: 'Run server' });
    });

    it("does not duplicate the Launch Configurations group across several expanded top-level folders", async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path;
          return path ? [] : [{ name: 'apps', kind: 'dir' }, { name: 'libs', kind: 'dir' }];
        }
        if (method === 'launchConfig.list') {
          return { workspaceId: 'w1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByText('apps'));
      await user.click(await screen.findByText('libs'));
      expect(screen.getAllByTestId('tree-group-launch-configs-Acme')).toHaveLength(1);
    });

    it('closing a launch-process tab removes it from the Workbench', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'launchConfig.list') {
          return { workspaceId: 'w1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] };
        }
        if (method === 'launchConfig.run') {
          return { processId: 'proc-1', workspaceId: 'w1', configName: 'Run server', status: 'running', exitCode: null };
        }
        if (method === 'launchConfig.status') {
          return { processId: 'proc-1', workspaceId: 'w1', configName: 'Run server', status: 'exited', exitCode: 0, outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('tree-group-launch-configs-Acme'));
      await user.click(await screen.findByTestId('tree-launch-config-Acme-Run server'));
      expect(await screen.findByTestId('workbench-tab-launch-process:proc-1')).toBeInTheDocument();
      await user.click(screen.getByTestId('workbench-tab-close-launch-process:proc-1'));
      expect(screen.queryByTestId('workbench-tab-launch-process:proc-1')).not.toBeInTheDocument();
    });
  });

  it('never shows a Control Panel scope chip — a workspace is a single folder', async () => {
    renderScreen();
    await screen.findByTestId('workspace-customizations');
    expect(screen.queryByTestId('control-panel-scope-chip')).not.toBeInTheDocument();
  });

  describe('Início (no workspace open)', () => {
    it('shows the Workspaces/App sections on the left and the Personal Instruction on the right, never a file tree', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        return undefined;
      });
      renderScreen();
      const managementList = await screen.findByTestId('workspace-management-list');
      expect(managementList).toContainElement(await screen.findByTestId('explorer-area-diagnostico'));
      expect(managementList).not.toContainElement(screen.getByTestId('personal-instruction-row'));
      expect(screen.getByTestId('workspace-customizations')).toContainElement(screen.getByTestId('personal-instruction-row'));
      expect(screen.queryByTestId('folder-tree')).not.toBeInTheDocument();
    });

    it('kicks the right panel off with "Global", and its Sessões list Global\'s own sessions only', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        if (method === 'session.list') {
          return [
            { sessionId: 'personal', claudeSessionId: 'c1', anchor: { kind: 'personal' }, cwd: '/home/u', label: 'Início', status: 'running', browserEnabled: false },
            { sessionId: 'workspace:w9', claudeSessionId: 'c2', anchor: { kind: 'workspace', workspaceId: 'w9' }, cwd: '/repos/x', label: 'X', status: 'running', browserEnabled: false },
          ];
        }
        return undefined;
      });
      renderScreen();
      await waitFor(() => expect(screen.getByTestId('control-panel-kicker')).toHaveTextContent('Global'));
      expect(await screen.findByTestId('tree-session-personal')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-session-workspace:w9')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(ipc.callIpc).toHaveBeenCalledWith('sessionHistory.list', expect.objectContaining({ scope: { kind: 'personal' } })),
      );
    });

    it('lists every registered workspace in the management card', async () => {
      const acmeWorkspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '' };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        if (method === 'workspace.list') return [acmeWorkspace];
        return undefined;
      });
      renderScreen();
      expect(await screen.findByTestId('workspace-list-row-w1')).toHaveTextContent('Acme');
    });

    it('switching workspaces from the management card refreshes the screen in place, with no extra navigation needed', async () => {
      const user = userEvent.setup();
      const acmeWorkspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', createdAt: '' };
      let active: typeof acmeWorkspace | null = null;
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return active;
        if (method === 'workspace.list') return [acmeWorkspace];
        if (method === 'workspace.listDir') return [];
        if (method === 'workspace.switchTo') {
          active = (params as { id: string }).id === 'w1' ? acmeWorkspace : null;
          return active;
        }
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-list-row-w1');
      await user.click(screen.getByTestId('workspace-list-row-w1'));
      // The screen re-renders in place for the newly opened workspace — its
      // file tree and overview show up and the Início-only list is gone.
      expect(await screen.findByTestId('workspace-overview')).toBeInTheDocument();
      expect(await screen.findByTestId('folder-tree')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-management-list')).not.toBeInTheDocument();
    });

    it('shows the Personal Instruction row, empty, and opens the editor on click', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        if (method === 'workspace.list') return [];
        if (method === 'instruction.list') return [];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('personal-instruction-row'));
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
    });

    it('shows the workspace list in its own toggleable Files panel, matching the open-workspace treatment', async () => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        if (method === 'workspace.list') return [];
        return undefined;
      });
      renderScreen();
      const panel = await screen.findByTestId('workspace-files-panel');
      expect(panel).toContainElement(await screen.findByTestId('workspace-management-list'));
      // The panel is collapsible, not unmounted, so it stays in the DOM
      // (react-resizable-panels shrinks it to 0 rather than removing it).
      togglePanel('explorer');
      await waitFor(() => expect(screen.getByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'true'));
      togglePanel('explorer');
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
        if (method === 'workspace.getActive') return null;
        if (method === 'workspace.list') return [];
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
    it('shows one editable "Global" section at Início, with the type chips and no "Do Global" section', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        if (method === 'workspace.list') return [];
        if (method === 'session.list') return [];
        return undefined;
      });
      renderScreen();
      await screen.findByTestId('workspace-management-list');
      expect(screen.getByTestId('control-panel-section-local')).toHaveTextContent('Global');
      expect(screen.queryByTestId('control-panel-section-global')).not.toBeInTheDocument();
      for (const id of ['all', 'skill', 'agent', 'integrations']) {
        expect(screen.getByTestId(`control-panel-chip-${id}`)).toBeInTheDocument();
      }
      expect(screen.getByTestId('personal-instruction-row')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-sessions-panel')).toBeInTheDocument();

      // Integrações (hooks, MCP, plugins) hides the instruction row.
      await user.click(screen.getByTestId('control-panel-chip-integrations'));
      expect(screen.queryByTestId('personal-instruction-row')).not.toBeInTheDocument();
      expect(await screen.findByTestId('control-panel-empty')).toBeInTheDocument();
    });

    it('inside a workspace, keeps Global entities out of Skills and lists them read-only under a collapsed "Do Global"', async () => {
      const user = userEvent.setup();
      const globalSkill = { urn: 'urn:skill:global', kind: 'skill', name: 'global', description: '', scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: '# Global body' };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.list') {
          return [
            { urn: 'urn:skill:local', kind: 'skill', name: 'local', description: '', scopes: ['workspace'], scopeId: 'w1', metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: '' },
            globalSkill,
          ];
        }
        return undefined;
      });
      renderScreen();
      await waitFor(() => expect(screen.getByTestId('control-panel-kicker')).toHaveTextContent('Workspace · Acme'));
      expect(await screen.findByTestId('tree-skill-local')).toBeInTheDocument();
      expect(screen.queryByTestId('tree-skill-global')).not.toBeInTheDocument();

      // Collapsed by default.
      expect(screen.getByTestId('tree-inherited-skill-global')).not.toBeVisible();
      await user.click(screen.getByTestId('control-panel-section-global'));
      await user.click(await screen.findByTestId('tree-inherited-skill-global'));

      // Opens read-only, with the way to edit it at Início.
      expect(await screen.findByTestId('workbench-tab-inherited:urn:skill:global')).toBeInTheDocument();
      expect(screen.getByTestId('inherited-notice')).toBeInTheDocument();
      expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
    });

    it('"Editar no Início" goes home and opens the entity there, editable', async () => {
      const user = userEvent.setup();
      const globalSkill = { urn: 'urn:skill:global', kind: 'skill', name: 'global', description: '', scopes: ['personal'], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' }, content: '# Global body' };
      let active: typeof projectWorkspace | null = projectWorkspace;
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return active;
        if (method === 'workspace.listDir') return [];
        if (method === 'workspace.goHome') {
          active = null;
          return undefined;
        }
        if (method === 'skill.list') return [globalSkill];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('control-panel-section-global'));
      await user.click(await screen.findByTestId('tree-inherited-skill-global'));
      await user.click(await screen.findByTestId('inherited-edit-at-home'));

      await waitFor(() => expect(ipc.callIpc).toHaveBeenCalledWith('workspace.goHome', {}));
      expect(await screen.findByTestId('workbench-tab-entity:urn:skill:global')).toBeInTheDocument();
      expect(screen.queryByTestId('workbench-tab-inherited:urn:skill:global')).not.toBeInTheDocument();
      expect(screen.queryByTestId('inherited-notice')).not.toBeInTheDocument();
    });
  });

  describe('Session tabs', () => {
    it('clicking "+" twice in a row spawns two independent sessions, each its own Workbench tab (regression: coexistence, not refocus)', async () => {
      const user = userEvent.setup();
      let spawnCount = 0;
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
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

      const tabButtons = screen.getAllByTestId(OPEN_TAB_BUTTONS);
      expect(tabButtons).toHaveLength(2);
    });

    it('closing a session tab drops it from the Workbench without affecting other open tabs', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
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
      expect(screen.getByTestId('workbench-tab-overview')).toHaveAttribute('aria-pressed', 'true');
    });

    it('labels the close action "Minimizar" while the session is still running', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
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
      await openNewMenu(user);
      await user.click(await screen.findByTestId('control-panel-new-instruction'));
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tabs')).toBeInTheDocument();
      expect(screen.getByTestId('folder-tree')).toBeInTheDocument();
    });

    it('creating a new skill opens a tab without replacing the tree group', async () => {
      const user = userEvent.setup();
      renderScreen();
      await openNewMenu(user);
      await user.click(await screen.findByTestId('control-panel-new-skill'));
      expect(await screen.findByTestId('editor-panel')).toBeInTheDocument();
      expect(screen.getByTestId('control-panel-customizations')).toBeInTheDocument();
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
        if (method === 'workspace.listDir') return [];
        if (method === 'instruction.list') return [workspaceInstruction];
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-instruction-row-acme'));
      await user.click(await screen.findByTestId('workspace-instruction-row-acme'));
      const tabButtons = screen.getAllByTestId(OPEN_TAB_BUTTONS);
      expect(tabButtons).toHaveLength(1);
    });
  });

  describe('Tab breadcrumb', () => {
    it('shows the file path for a file tab, and updates when switching to a different tab', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path ?? '';
          return path === '' ? [{ name: 'apps', kind: 'dir' }] : path === 'apps' ? [{ name: 'a.md', kind: 'file' }] : [];
        }
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hi' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      expect(await screen.findByTestId('workbench-breadcrumb')).toHaveTextContent('apps/a.md');

      // The pinned Workspace INSTRUCTIONS row's own tab has no relation to
      // "apps" — the breadcrumb must follow the newly active tab, not stick
      // to the previous one.
      await openNewMenu(user);
      await user.click(await screen.findByTestId('control-panel-new-instruction'));
      expect(await screen.findByTestId('workbench-breadcrumb')).toHaveTextContent('Acme › INSTRUCTIONS');
    });

    it('shows no breadcrumb for a session tab', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') return [];
        if (method === 'session.spawn') {
          return { sessionId: 'sess-w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running', outputBuffer: '' };
        }
        return undefined;
      });
      renderScreen();
      await user.click(await screen.findByTestId('workspace-sessions-new'));
      await screen.findByTestId('workbench-tab-session:sess-w1');
      expect(screen.queryByTestId('workbench-breadcrumb')).not.toBeInTheDocument();
    });
  });

  describe('Preview via right-click', () => {
    it('right-clicking a file row opens a separate, read-only preview tab alongside its own editing tab', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path ?? '';
          return path === '' ? [{ name: 'apps', kind: 'dir' }] : path === 'apps' ? [{ name: 'a.md', kind: 'file' }] : [];
        }
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: '# Hello' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      await screen.findByTestId('workbench-tab-file:apps/a.md');

      const folderTree = await screen.findByTestId('folder-tree');
      fireEvent.contextMenu(await within(folderTree).findByText('a.md'));
      await user.click(await screen.findByTestId('row-context-menu-preview'));

      // Both tabs coexist — opening the preview never disturbed the editing tab.
      expect(await screen.findByTestId('workbench-tab-preview:file:apps/a.md')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tab-file:apps/a.md')).toBeInTheDocument();
      expect(screen.queryByTestId('workbench-tab-dirty-preview:file:apps/a.md')).not.toBeInTheDocument();
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
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.list') return [acmeSkill];
        return undefined;
      });
      renderScreen();
      fireEvent.contextMenu(await screen.findByTestId('tree-skill-acme'));
      await user.click(await screen.findByTestId('row-context-menu-preview'));

      expect(await screen.findByTestId('workbench-tab-preview:entity:urn:skill:acme')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
      expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
    });

    it('right-clicking a configured workspace INSTRUCTIONS row opens its content as a read-only preview tab', async () => {
      const user = userEvent.setup();
      const workspaceInstruction = {
        urn: 'urn:instruction:w1', kind: 'instruction' as const, name: 'Acme',
        description: '', scopes: ['workspace' as const], scopeId: 'w1',
        metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '# Team instructions',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'instruction.list') return [workspaceInstruction];
        return undefined;
      });
      renderScreen();
      fireEvent.contextMenu(await screen.findByTestId('workspace-instruction-row-Acme'));
      await user.click(await screen.findByTestId('row-context-menu-preview'));

      expect(await screen.findByTestId('workbench-tab-preview:entity:urn:instruction:w1')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
      expect(screen.queryByTestId('body-editor')).not.toBeInTheDocument();
    });
  });

  describe('Properties via right-click', () => {
    it('right-clicking a skill row opens (or focuses) its editing tab and shows the Properties modal', async () => {
      const user = userEvent.setup();
      const acmeSkill = {
        urn: 'urn:skill:acme', kind: 'skill' as const, name: 'acme', description: '',
        scopes: ['workspace' as const], scopeId: 'w1', metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '# Skill body',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.list') return [acmeSkill];
        return undefined;
      });
      renderScreen();
      fireEvent.contextMenu(await screen.findByTestId('tree-skill-acme'));
      await user.click(await screen.findByTestId('row-context-menu-properties'));

      expect(await screen.findByTestId('workbench-tab-entity:urn:skill:acme')).toBeInTheDocument();
      expect(screen.getByTestId('properties-modal')).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('acme');
    });

    it('right-clicking a configured workspace INSTRUCTIONS row opens its editing tab and shows the Properties modal', async () => {
      const user = userEvent.setup();
      const workspaceInstruction = {
        urn: 'urn:instruction:w1', kind: 'instruction' as const, name: 'Acme',
        description: '', scopes: ['workspace' as const], scopeId: 'w1',
        metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '# Team instructions',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'instruction.list') return [workspaceInstruction];
        return undefined;
      });
      renderScreen();
      fireEvent.contextMenu(await screen.findByTestId('workspace-instruction-row-Acme'));
      await user.click(await screen.findByTestId('row-context-menu-properties'));

      expect(await screen.findByTestId('workbench-tab-entity:urn:instruction:w1')).toBeInTheDocument();
      expect(screen.getByTestId('properties-modal')).toBeInTheDocument();
    });

    it('never offers Properties on the Personal Instruction row — every field is fixed there', async () => {
      const personal = {
        urn: 'urn:instruction:default', kind: 'instruction' as const, name: 'default',
        description: '', scopes: ['personal' as const], metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
        source: { kind: 'workspace' as const }, content: '# Personal',
      };
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return null;
        if (method === 'workspace.list') return [];
        if (method === 'instruction.list') return [personal];
        if (method === 'instruction.get') return personal;
        return undefined;
      });
      renderScreen();
      // The row renders before the instruction loads; it only offers a menu once it has one.
      await waitFor(() => {
        fireEvent.contextMenu(screen.getByTestId('personal-instruction-row'));
        expect(screen.getByTestId('row-context-menu-preview')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('row-context-menu-properties')).not.toBeInTheDocument();
    });
  });

  describe('Files panel', () => {
    it('can be hidden and shown again from the TopNav toggle', async () => {
      renderScreen();
      expect(await screen.findByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'false');
      togglePanel('explorer');
      await waitFor(() => expect(screen.getByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'true'));
      togglePanel('explorer');
      await waitFor(() => expect(screen.getByTestId('workspace-files-panel')).toHaveAttribute('data-collapsed', 'false'));
    });

    it('opening two files keeps both tabs mounted and toggles which is visible', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path ?? '';
          return path === '' ? [{ name: 'apps', kind: 'dir' }] : path === 'apps' ? [{ name: 'a.md', kind: 'file' }, { name: 'b.md', kind: 'file' }] : [];
        }
        if (method === 'workspace.readFile') {
          const path = (params as { path: string }).path;
          return { previewable: true, kind: 'text', truncated: false, content: `content of ${path}` };
        }
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      expect(await screen.findByText('content of apps/a.md')).toBeVisible();

      await user.click(await screen.findByText('b.md'));
      expect(await screen.findByText('content of apps/b.md')).toBeVisible();
      expect(screen.getByText('content of apps/a.md')).not.toBeVisible();

      const tabButtons = screen.getAllByTestId(OPEN_TAB_BUTTONS);
      expect(tabButtons).toHaveLength(2);
      await user.click(tabButtons[0]!);
      expect(screen.getByText('content of apps/a.md')).toBeVisible();
      expect(screen.getByText('content of apps/b.md')).not.toBeVisible();
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
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.save') return { skill: savedSkill, syncReport: [] };
        return undefined;
      });
      renderScreen();
      await openNewMenu(user);
      await user.click(await screen.findByTestId('control-panel-new-skill'));
      await screen.findByTestId('editor-panel');
      await user.keyboard('{Control>}s{/Control}');
      await waitFor(() => expect(screen.getAllByTestId(OPEN_TAB_BUTTONS)).toHaveLength(1));
    });

    it('closing the last file tab removes it and falls back to the Visão geral tab', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string, params: unknown) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path ?? '';
          return path === '' ? [{ name: 'apps', kind: 'dir' }] : path === 'apps' ? [{ name: 'a.md', kind: 'file' }] : [];
        }
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hello' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      await screen.findByText('hello');
      await user.click(screen.getByLabelText(/^Fechar /));
      expect(screen.queryByText('hello')).not.toBeInTheDocument();
      expect(screen.getByTestId('workbench-tab-overview')).toHaveAttribute('aria-pressed', 'true');
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
      expect(screen.getByTestId('workbench-tab-file:apps/a.md')).toBeInTheDocument();
    });

    it('closes a tab with unsaved edits once the user confirms discarding them', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await user.click(screen.getByLabelText(/^Fechar /));
      expect(screen.queryByTestId('workbench-tab-file:apps/a.md')).not.toBeInTheDocument();
    });

    it('clears the dirty dot once the edit is saved', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      await user.keyboard('{Control>}s{/Control}');
      await waitFor(() => expect(screen.queryByTestId('workbench-tab-dirty-file:apps/a.md')).not.toBeInTheDocument());
    });

    it('a context switch with unsaved edits asks for confirmation first, and declining changes nothing', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      let allowed = true;
      act(() => {
        allowed = confirmDiscardUnsavedTabs();
      });
      expect(allowed).toBe(false);
      expect(confirmSpy).toHaveBeenCalled();
      expect(screen.getByTestId('workbench-tab-file:apps/a.md')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tab-dirty-file:apps/a.md')).toBeInTheDocument();
    });

    it('confirming the discard on a context switch clears the tabs', async () => {
      const user = userEvent.setup();
      await openDirtyFileTab(user);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      act(() => {
        expect(confirmDiscardUnsavedTabs()).toBe(true);
      });
      await waitFor(() => expect(screen.queryByTestId('workbench-tab-file:apps/a.md')).not.toBeInTheDocument());
    });

    const openDirtyEntityTab = async (user: ReturnType<typeof userEvent.setup>) => {
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        return undefined;
      });
      renderScreen();
      await openNewMenu(user);
      await user.click(await screen.findByTestId('control-panel-new-skill'));
      await screen.findByTestId('editor-panel');
      // A brand new entity opens straight into its Properties modal (Name is
      // required before it can be saved) — close it to reach the body editor.
      await user.click(screen.getByLabelText('Fechar'));
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
        if (method === 'workspace.listDir') return [];
        if (method === 'skill.save') return { skill: savedSkill, syncReport: [] };
        return undefined;
      });
      renderScreen();
      await openNewMenu(user);
      await user.click(await screen.findByTestId('control-panel-new-skill'));
      await screen.findByTestId('editor-panel');
      await user.click(screen.getByLabelText('Fechar'));
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
        if (method === 'workspace.listDir') {
          const path = (params as { path?: string } | undefined)?.path ?? '';
          return path === '' ? [{ name: 'apps', kind: 'dir' }] : path === 'apps' ? [{ name: 'a.md', kind: 'file' }, { name: 'b.md', kind: 'file' }] : [];
        }
        if (method === 'workspace.readFile') return { previewable: true, kind: 'text', truncated: false, content: 'hello' };
        return undefined;
      });
      renderScreen();
      await openFolderFile(user, 'a.md');
      await screen.findByTestId('workbench-tab-file:apps/a.md');
      await user.click(await screen.findByText('b.md'));
      await screen.findByTestId('workbench-tab-file:apps/b.md');
    };

    it('going back re-selects the previously active Workbench tab', async () => {
      const user = userEvent.setup();
      await renderWithTwoFiles(user);
      expect(screen.getByTestId('workbench-tab-file:apps/b.md')).toHaveAttribute('aria-pressed', 'true');
      await act(async () => {
        await navigateWorkspaceHistory('back');
      });
      expect(screen.getByTestId('workbench-tab-file:apps/a.md')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('workbench-tab-file:apps/b.md')).toHaveAttribute('aria-pressed', 'false');
    });

    it('going forward after going back re-selects the later tab again', async () => {
      const user = userEvent.setup();
      await renderWithTwoFiles(user);
      await act(async () => {
        await navigateWorkspaceHistory('back');
        await navigateWorkspaceHistory('forward');
      });
      expect(screen.getByTestId('workbench-tab-file:apps/b.md')).toHaveAttribute('aria-pressed', 'true');
    });

    it('skips a history step pointing at a tab that has since been closed', async () => {
      const user = userEvent.setup();
      await renderWithTwoFiles(user);
      await user.click(screen.getByTestId('workbench-tab-close-file:apps/a.md'));
      expect(screen.queryByTestId('workbench-tab-file:apps/a.md')).not.toBeInTheDocument();
      // History is [root, a.md (which also derives project scope), b.md];
      // a.md's step is now stale (its tab closed), so going back from b.md
      // skips it and lands on the root step instead — b.md stays open, just
      // no longer active.
      await act(async () => {
        await navigateWorkspaceHistory('back');
      });
      expect(screen.getByTestId('workbench-tab-file:apps/b.md')).toBeInTheDocument();
      expect(screen.getByTestId('workbench-tab-file:apps/b.md')).toHaveAttribute('aria-pressed', 'false');
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
      await waitFor(() => expect(screen.getByTestId('workbench-tab-dirty-file:apps/b.md')).toBeInTheDocument());
      const confirmSpy = vi.spyOn(window, 'confirm');
      await act(async () => {
        await navigateWorkspaceHistory('back');
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('workbench-tab-file:apps/b.md')).toBeInTheDocument();
    });
  });

  describe('Explorer Panel / Control Panel identity', () => {
    it('renders each side panel as a title-less card inside its own resizable Panel', async () => {
      renderScreen();
      const explorerCard = await screen.findByTestId('workspace-explorer-panel-label');
      const controlCard = await screen.findByTestId('workspace-control-panel-label');
      expect(screen.getByTestId('workspace-files-panel')).toContainElement(explorerCard);
      expect(screen.getByTestId('workspace-customizations-aside')).toContainElement(controlCard);
      expect(explorerCard).not.toHaveTextContent('Explorer Panel');
      expect(controlCard).not.toHaveTextContent('Control Panel');
    });

    it('puts the "Reler do disco" refresh button on the Explorer toolbar', async () => {
      renderScreen();
      const refresh = await screen.findByTestId('workspace-refresh-files');
      expect(screen.getByTestId('explorer-toolbar')).toContainElement(refresh);
    });

    it('no longer carries the workspace name, path or a "⋮" menu — those live in the TopNav switcher', async () => {
      renderScreen();
      const filesPanel = await screen.findByTestId('workspace-files-panel');
      await screen.findByTestId('folder-tree');
      expect(screen.queryByTestId('workspace-header-menu-button')).not.toBeInTheDocument();
      expect(filesPanel).not.toHaveTextContent('/repos/acme');
    });
  });

  describe('Customizations aside', () => {
    it('can be collapsed and expanded from the TopNav toggle', async () => {
      renderScreen();
      expect(await screen.findByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'false');
      togglePanel('control');
      await waitFor(() => expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'true'));
      togglePanel('control');
      await waitFor(() => expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'false'));
    });

    it('collapses to 0 width the same way the Explorer Panel does, and stays in the DOM (react-resizable-panels shrinks it, never unmounts it)', async () => {
      renderScreen();
      const panel = await screen.findByTestId('workspace-customizations-aside');
      expect(panel).toContainElement(await screen.findByTestId('workspace-control-panel-label'));
      togglePanel('control');
      await waitFor(() => expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'true'));
      togglePanel('control');
      await waitFor(() => expect(screen.getByTestId('workspace-customizations-aside')).toHaveAttribute('data-collapsed', 'false'));
    });

    it('places Sessões before the Customizations list, with its own local collapse independent of the aside', async () => {
      const user = userEvent.setup();
      (ipc.callIpc as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return projectWorkspace;
        if (method === 'workspace.listDir') return [];
        if (method === 'session.list') {
          return [{ sessionId: 'workspace:w1', anchor: { kind: 'workspace', workspaceId: 'w1' }, cwd: '/repos/acme', label: 'Acme', status: 'running' }];
        }
        return undefined;
      });
      renderScreen();
      const sessionsPanel = await screen.findByTestId('workspace-sessions-panel');
      const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows(sessionsPanel, screen.getByTestId('control-panel-customizations'))).toBe(true);
      expect(follows(screen.getByTestId('control-panel-section-local'), screen.getByTestId('control-panel-section-global'))).toBe(true);
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

});

describe('Explorer Panel — re-reading the disk', () => {
  const callsTo = (method: string): number =>
    (ipc.callIpc as Mock).mock.calls.filter(([m]) => m === method).length;

  it('re-lists the workspace root when the refresh button is clicked', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(callsTo('workspace.listDir')).toBe(1));

    await user.click(await screen.findByTestId('workspace-refresh-files'));

    await waitFor(() => expect(callsTo('workspace.listDir')).toBe(2));
  });

  it('re-reads an open file tab too, not just the tree', async () => {
    const user = userEvent.setup();
    (ipc.callIpc as Mock).mockImplementation(async (method: string, params: unknown) => {
      if (method === 'workspace.getActive') return projectWorkspace;
      if (method === 'workspace.listDir') {
        const path = (params as { path?: string } | undefined)?.path ?? '';
        return path === '' ? [{ name: 'apps', kind: 'dir' }] : path === 'apps' ? [{ name: 'a.md', kind: 'file' }] : [];
      }
      if (method === 'workspace.readFile')
        return { previewable: true, kind: 'text', truncated: false, content: 'hello' };
      if (method === 'session.list') return [];
      return undefined;
    });
    renderScreen();
    await openFolderFile(user, 'a.md');
    await screen.findByText('hello');
    const readsBefore = callsTo('workspace.readFile');

    await user.click(screen.getByTestId('workspace-refresh-files'));

    await waitFor(() => expect(callsTo('workspace.readFile')).toBeGreaterThan(readsBefore));
  });
});
