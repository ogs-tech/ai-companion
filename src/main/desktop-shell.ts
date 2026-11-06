import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { app, BrowserWindow, dialog, Menu, screen, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron';
import { brand } from '../shared/brand.js';
import type { Workspace } from '../shared/workspace.js';
import {
  MENU_COMMAND_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  QUIT_REQUEST_CHANNEL,
  RECOVERY_CHANNEL,
  type MenuCommand,
  type MenuCommandEvent,
  type OpenWorkspaceEvent,
  type QuitRequestEvent,
  type RecoveryEvent,
} from '../shared/desktop.js';
import type { LoggerPort } from './application/ports/logger-port.js';
import type { WindowState, WindowStatePort } from './application/ports/window-state-port.js';
import { QuitCoordinator } from './application/desktop/quit-coordinator.js';
import { CrashRecovery } from './application/desktop/crash-recovery.js';
import { buildMenuTemplate, type MenuItemTemplate } from './application/desktop/menu-template.js';
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, resolveWindowState } from './application/desktop/window-bounds.js';

const MAX_RECENT_WORKSPACES = 10;
const STATE_SAVE_DEBOUNCE_MS = 500;
/** Gives the renderer time to mount its `onRecovery` listener after the reload finishes. */
const RECOVERY_SEND_DELAY_MS = 500;

export interface DesktopShellOptions {
  logger: LoggerPort;
  windowState: WindowStatePort;
  isDev: boolean;
  getMainWindow: () => BrowserWindow | null;
}

/**
 * Electron glue for the desktop basics (menu, window state, quit confirmation, crash recovery).
 * The decisions live in `application/desktop/*`; this file only wires them to `electron` events.
 */
export function createDesktopShell(options: DesktopShellOptions) {
  const { logger, windowState, isDev, getMainWindow } = options;
  let cachedState: WindowState | null = null;
  let approved = false;
  let quitPending = false;
  let asking = false;
  let recentWorkspaces: Workspace[] = [];

  const liveWindow = (): BrowserWindow | null => {
    const win = getMainWindow();
    return win !== null && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null;
  };

  const quitCoordinator = new QuitCoordinator({
    send: (requestId) => {
      const win = liveWindow();
      if (win === null || win.webContents.isCrashed()) return false;
      const event: QuitRequestEvent = { requestId };
      win.webContents.send(QUIT_REQUEST_CHANNEL, event);
      return true;
    },
    newId: randomUUID,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  });

  /** Asks once; on "proceed" marks the close as approved and resumes whichever of quit / window close started it. */
  const askBeforeClosing = (): void => {
    if (asking) return;
    asking = true;
    void quitCoordinator.request().then((proceed) => {
      asking = false;
      const wasQuit = quitPending;
      quitPending = false;
      if (!proceed) return;
      approved = true;
      if (wasQuit) app.quit();
      else getMainWindow()?.close();
    });
  };

  const crashRecovery = new CrashRecovery({
    now: () => Date.now(),
    log: (message) => logger.error({ process: 'main', message }),
    reload: () => liveWindow()?.webContents.reload(),
    askUser: async (details) => {
      const win = liveWindow();
      const box = {
        type: 'error' as const,
        title: brand.displayName,
        message: `${brand.displayName} encontrou um problema`,
        detail: `${details}\n\nAs sessões de terminal continuam rodando. Os detalhes foram salvos em ${logger.directory}.`,
        buttons: ['Recarregar', 'Sair'],
        defaultId: 0,
        cancelId: 1,
      };
      const result = win !== null ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
      return result.response === 0 ? 'reload' : 'quit';
    },
    quit: () => {
      approved = true;
      app.quit();
    },
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  });

  const sendToRenderer = (channel: string, payload: unknown): void => {
    liveWindow()?.webContents.send(channel, payload);
  };

  const showAbout = (): void => {
    const box = {
      type: 'info' as const,
      title: `Sobre ${brand.displayName}`,
      message: brand.displayName,
      detail: `Versão ${app.getVersion()}\n${brand.companyLine}\n${brand.companyUrl}`,
      buttons: ['OK'],
    };
    const win = liveWindow();
    void (win !== null ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box));
  };

  const openLogsFolder = async (): Promise<void> => {
    mkdirSync(logger.directory, { recursive: true });
    const failure = await shell.openPath(logger.directory);
    if (failure !== '') logger.error({ process: 'main', message: `Could not open logs folder: ${failure}` });
  };

  const installMenu = (): void => {
    const recents = [...recentWorkspaces]
      .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
      .slice(0, MAX_RECENT_WORKSPACES)
      .map((w) => ({ id: w.id, name: w.name }));
    const template: MenuItemTemplate[] = buildMenuTemplate({
      platform: process.platform,
      appName: brand.displayName,
      recentWorkspaces: recents,
      send: (command: MenuCommand) => {
        const event: MenuCommandEvent = { command };
        sendToRenderer(MENU_COMMAND_CHANNEL, event);
      },
      openWorkspace: (workspaceId) => {
        const event: OpenWorkspaceEvent = { workspaceId };
        sendToRenderer(OPEN_WORKSPACE_CHANNEL, event);
      },
      showAbout,
      openLogsFolder: () => void openLogsFolder(),
    });
    const electronTemplate = template as MenuItemConstructorOptions[];
    if (isDev) {
      // The custom menu replaces Electron's default one, which carried reload/devtools in dev.
      electronTemplate.push({ label: 'Dev', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] });
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(electronTemplate));
  };

  const saveState = (win: BrowserWindow): void => {
    if (win.isDestroyed()) return;
    const { x, y, width, height } = win.getNormalBounds();
    const state: WindowState = { x, y, width, height, maximized: win.isMaximized() };
    cachedState = state;
    windowState.save(state);
  };

  return {
    /** Respond path for IPC `desktop.respondToQuit`. */
    respondToQuit: (requestId: string, proceed: boolean): void => quitCoordinator.respond(requestId, proceed),
    setWindowTitle: (title: string, edited: boolean): void => {
      const win = liveWindow();
      if (win === null) return;
      win.setTitle(title);
      if (process.platform === 'darwin') win.setDocumentEdited(edited);
    },
    openLogsFolder,

    /** Call once, before the app is ready and before any other `before-quit` listener is registered. */
    registerProcessHandlers: (): void => {
      process.on('uncaughtException', (error) => {
        logger.error({ process: 'main', message: `uncaughtException: ${error.message}`, stack: error.stack });
      });
      process.on('unhandledRejection', (reason) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        logger.error({ process: 'main', message: `unhandledRejection: ${error.message}`, stack: error.stack });
      });
      app.on('before-quit', (event) => {
        if (approved || liveWindow() === null) return;
        event.preventDefault();
        quitPending = true;
        askBeforeClosing();
      });
    },

    /** Replaces the menu's "Abrir recente" list; call at startup and whenever the workspace list may have changed. */
    setRecentWorkspaces: (workspaces: Workspace[]): void => {
      recentWorkspaces = workspaces;
      installMenu();
    },

    /** Size/position for a new window, validated against the connected displays. */
    windowOptions: (): BrowserWindowConstructorOptions => {
      cachedState ??= windowState.load();
      const state = resolveWindowState(
        cachedState,
        screen.getAllDisplays().map((d) => d.workArea),
      );
      return {
        width: state.width,
        height: state.height,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
      };
    },

    /** Wires state persistence, the close confirmation and crash recovery to a freshly created window. */
    attachWindow: (win: BrowserWindow): void => {
      approved = false;
      quitPending = false;
      if (cachedState?.maximized === true) win.maximize();

      let saveTimer: NodeJS.Timeout | null = null;
      const scheduleSave = (): void => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveState(win), STATE_SAVE_DEBOUNCE_MS);
      };
      win.on('resize', scheduleSave);
      win.on('move', scheduleSave);

      win.on('close', (event) => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveState(win);
        if (approved) return;
        event.preventDefault();
        askBeforeClosing();
      });

      const contents = win.webContents;
      contents.on('render-process-gone', (_event, details) => {
        crashRecovery.onGone(`${details.reason} (exit code ${details.exitCode})`);
      });
      contents.on('unresponsive', () => crashRecovery.onUnresponsive());
      contents.on('responsive', () => crashRecovery.onResponsive());
      contents.on('did-finish-load', () => {
        const details = crashRecovery.takeRecovery();
        if (details === null) return;
        const event: RecoveryEvent = { details: `${details}\nLog: ${logger.directory}` };
        setTimeout(() => sendToRenderer(RECOVERY_CHANNEL, event), RECOVERY_SEND_DELAY_MS);
      });
    },
  };
}

export type DesktopShell = ReturnType<typeof createDesktopShell>;
