/// <reference types="vite/client" />

import type { IpcResult } from '../shared/ipc-contract.js';
import type { EntityChangedEvent } from '../shared/entity.js';

declare global {
  interface Window {
    api: {
      call<T>(method: string, params: unknown): Promise<IpcResult<T>>;
      isDev: boolean;
      getPathForFile(file: File): string;
      session: {
        onOutput(sessionId: string, listener: (chunk: string) => void): () => void;
        onExit(sessionId: string, listener: (exitCode: number) => void): () => void;
        onAnyExit(listener: (sessionId: string, exitCode: number) => void): () => void;
      };
      entity: {
        onChanged(listener: (event: EntityChangedEvent) => void): () => void;
      };
      launchConfig: {
        onOutput(processId: string, listener: (stream: 'stdout' | 'stderr', chunk: string) => void): () => void;
        onExit(processId: string, listener: (exitCode: number | null, signal: string | null) => void): () => void;
        onAnyExit(listener: (processId: string, exitCode: number | null, signal: string | null) => void): () => void;
      };
    };
  }
}

export {};
