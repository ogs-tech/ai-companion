import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNEL, type IpcResult } from '../shared/ipc-contract.js';
import {
  SESSION_OUTPUT_CHANNEL,
  SESSION_EXIT_CHANNEL,
  type SessionOutputEvent,
  type SessionExitEvent,
} from '../shared/session.js';

const api = {
  call: <T>(method: string, params: unknown): Promise<IpcResult<T>> =>
    ipcRenderer.invoke(IPC_CHANNEL, { method, params }) as Promise<IpcResult<T>>,
  isDev: process.env['NODE_ENV'] === 'development',
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
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
