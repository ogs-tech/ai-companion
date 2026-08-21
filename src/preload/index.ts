import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNEL, type IpcResult } from '../shared/ipc-contract.js';
import {
  INSTRUCTION_GENERATE_PROGRESS_CHANNEL,
  type GenerateDraftProgressEvent,
} from '../shared/instruction-generation.js';
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
  onInstructionGenerateProgress: (listener: (event: GenerateDraftProgressEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: GenerateDraftProgressEvent): void => listener(payload);
    ipcRenderer.on(INSTRUCTION_GENERATE_PROGRESS_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(INSTRUCTION_GENERATE_PROGRESS_CHANNEL, wrapped);
  },
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
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
