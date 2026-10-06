import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC_CHANNEL, type IpcResult } from '../shared/ipc-contract.js';
import {
  SESSION_OUTPUT_CHANNEL,
  SESSION_EXIT_CHANNEL,
  type SessionOutputEvent,
  type SessionExitEvent,
} from '../shared/session.js';
import { ENTITY_CHANGED_CHANNEL, type EntityChangedEvent } from '../shared/entity.js';
import {
  LAUNCH_PROCESS_OUTPUT_CHANNEL,
  LAUNCH_PROCESS_EXIT_CHANNEL,
  type LaunchProcessOutputEvent,
  type LaunchProcessExitEvent,
} from '../shared/launch-config.js';

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
    /** Unfiltered exit listener — for a consolidated session list, which doesn't know every sessionId up front. */
    onAnyExit: (listener: (sessionId: string, exitCode: number) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: SessionExitEvent): void => listener(payload.sessionId, payload.exitCode);
      ipcRenderer.on(SESSION_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(SESSION_EXIT_CHANNEL, wrapped);
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
  launchConfig: {
    onOutput: (processId: string, listener: (stream: 'stdout' | 'stderr', chunk: string) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: LaunchProcessOutputEvent): void => {
        if (payload.processId === processId) listener(payload.stream, payload.chunk);
      };
      ipcRenderer.on(LAUNCH_PROCESS_OUTPUT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(LAUNCH_PROCESS_OUTPUT_CHANNEL, wrapped);
    },
    onExit: (processId: string, listener: (exitCode: number | null, signal: string | null) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: LaunchProcessExitEvent): void => {
        if (payload.processId === processId) listener(payload.exitCode, payload.signal);
      };
      ipcRenderer.on(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
    },
    /** Unfiltered — for the renderer-side launch-process store, which doesn't know every live processId up front. */
    onAnyExit: (listener: (processId: string, exitCode: number | null, signal: string | null) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: LaunchProcessExitEvent): void => listener(payload.processId, payload.exitCode, payload.signal);
      ipcRenderer.on(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(LAUNCH_PROCESS_EXIT_CHANNEL, wrapped);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
