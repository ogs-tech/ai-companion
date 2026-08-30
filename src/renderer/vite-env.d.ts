/// <reference types="vite/client" />

import type { IpcResult } from '../shared/ipc-contract.js';
import type { EntityChangedEvent } from '../shared/entity.js';

declare global {
  interface Window {
    api: {
      call<T>(method: string, params: unknown): Promise<IpcResult<T>>;
      isDev: boolean;
      session: {
        onOutput(sessionId: string, listener: (chunk: string) => void): () => void;
        onExit(sessionId: string, listener: (exitCode: number) => void): () => void;
        onAnyExit(listener: (sessionId: string, exitCode: number) => void): () => void;
      };
      entity: {
        onChanged(listener: (event: EntityChangedEvent) => void): () => void;
      };
    };
  }
}

export {};
