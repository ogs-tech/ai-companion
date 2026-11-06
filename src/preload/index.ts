import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC_CHANNEL, type IpcResult } from '../shared/ipc-contract.js';
import {
  SESSION_OUTPUT_CHANNEL,
  SESSION_EXIT_CHANNEL,
  SESSION_ACTIVITY_CHANNEL,
  type SessionOutputEvent,
  type SessionExitEvent,
  type SessionActivityEvent,
} from '../shared/session.js';
import { EXTERNAL_LINK_CHANNEL, type ExternalLinkEvent } from '../shared/external-link.js';
import { ENTITY_CHANGED_CHANNEL, type EntityChangedEvent } from '../shared/entity.js';
import { WORKSPACE_TREE_CHANGED_CHANNEL, type WorkspaceTreeChangedEvent } from '../shared/file-ops.js';
import {
  TERMINAL_OUTPUT_CHANNEL,
  TERMINAL_EXIT_CHANNEL,
  type TerminalOutputEvent,
  type TerminalExitEvent,
} from '../shared/terminal.js';
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

const api = {
  call: <T>(method: string, params: unknown): Promise<IpcResult<T>> =>
    ipcRenderer.invoke(IPC_CHANNEL, { method, params }) as Promise<IpcResult<T>>,
  isDev: process.env['NODE_ENV'] === 'development',
  /** A dropped `File`'s real filesystem path — `File.path` itself is gone under `sandbox: true`, so a drag-and-drop attach has to go through `webUtils` here instead. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  session: {
    onOutput: (sessionId: string, listener: (chunk: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: SessionOutputEvent): void => {
        if (payload.sessionId === sessionId) listener(payload.chunk);
      };
      ipcRenderer.on(SESSION_OUTPUT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(SESSION_OUTPUT_CHANNEL, wrapped);
    },
    onExit: (sessionId: string, listener: (exitCode: number) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: SessionExitEvent): void => {
        if (payload.sessionId === sessionId) listener(payload.exitCode);
      };
      ipcRenderer.on(SESSION_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(SESSION_EXIT_CHANNEL, wrapped);
    },
    /** Fires when any running session's activity (working / idle / needs-input) changes. */
    onAnyActivity: (listener: (sessionId: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: SessionActivityEvent): void => {
        for (const id of payload.sessionIds) listener(id);
      };
      ipcRenderer.on(SESSION_ACTIVITY_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(SESSION_ACTIVITY_CHANNEL, wrapped);
    },
    /** Unfiltered exit listener — for a consolidated session list, which doesn't know every sessionId up front. */
    onAnyExit: (listener: (sessionId: string, exitCode: number) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: SessionExitEvent): void => listener(payload.sessionId, payload.exitCode);
      ipcRenderer.on(SESSION_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(SESSION_EXIT_CHANNEL, wrapped);
    },
  },
  externalLink: {
    /** URLs the session's CLI opened through the OS opener, routed here by main instead of the default browser. */
    onOpen: (listener: (url: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: ExternalLinkEvent): void => listener(payload.url);
      ipcRenderer.on(EXTERNAL_LINK_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(EXTERNAL_LINK_CHANNEL, wrapped);
    },
  },
  entity: {
    /** Unfiltered — the renderer doesn't know ahead of time which urn a watcher-detected external edit touched. */
    onChanged: (listener: (event: EntityChangedEvent) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: EntityChangedEvent): void => listener(payload);
      ipcRenderer.on(ENTITY_CHANGED_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(ENTITY_CHANGED_CHANNEL, wrapped);
    },
  },
  workspace: {
    /** Directories of the open workspace whose listing changed on disk (debounced). */
    onTreeChanged: (listener: (event: WorkspaceTreeChangedEvent) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: WorkspaceTreeChangedEvent): void => listener(payload);
      ipcRenderer.on(WORKSPACE_TREE_CHANGED_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(WORKSPACE_TREE_CHANGED_CHANNEL, wrapped);
    },
  },
  desktop: {
    /** A native menu item was clicked (or its accelerator pressed). */
    onMenuCommand: (listener: (command: MenuCommand) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: MenuCommandEvent): void => listener(payload.command);
      ipcRenderer.on(MENU_COMMAND_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(MENU_COMMAND_CHANNEL, wrapped);
    },
    /** "Abrir recente" picked a workspace. */
    onOpenWorkspace: (listener: (workspaceId: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: OpenWorkspaceEvent): void => listener(payload.workspaceId);
      ipcRenderer.on(OPEN_WORKSPACE_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(OPEN_WORKSPACE_CHANNEL, wrapped);
    },
    /** Main wants to close/quit; answer with IPC `desktop.respondToQuit`. */
    onQuitRequest: (listener: (requestId: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: QuitRequestEvent): void => listener(payload.requestId);
      ipcRenderer.on(QUIT_REQUEST_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(QUIT_REQUEST_CHANNEL, wrapped);
    },
    /** The window was reloaded after a crash or hang. */
    onRecovery: (listener: (details: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: RecoveryEvent): void => listener(payload.details);
      ipcRenderer.on(RECOVERY_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(RECOVERY_CHANNEL, wrapped);
    },
  },
  terminal: {
    onOutput: (terminalId: string, listener: (chunk: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: TerminalOutputEvent): void => {
        if (payload.terminalId === terminalId) listener(payload.chunk);
      };
      ipcRenderer.on(TERMINAL_OUTPUT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(TERMINAL_OUTPUT_CHANNEL, wrapped);
    },
    onExit: (terminalId: string, listener: (exitCode: number | null, signal: string | null) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: TerminalExitEvent): void => {
        if (payload.terminalId === terminalId) listener(payload.exitCode, payload.signal);
      };
      ipcRenderer.on(TERMINAL_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(TERMINAL_EXIT_CHANNEL, wrapped);
    },
    /** Unfiltered — for the renderer-side terminal list, which doesn't know every live terminalId up front. */
    onAnyExit: (listener: (terminalId: string, exitCode: number | null, signal: string | null) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: TerminalExitEvent): void => listener(payload.terminalId, payload.exitCode, payload.signal);
      ipcRenderer.on(TERMINAL_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(TERMINAL_EXIT_CHANNEL, wrapped);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
