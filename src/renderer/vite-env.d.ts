/// <reference types="vite/client" />

import type { IpcResult } from '../shared/ipc-contract.js';
import type { GenerateDraftProgressEvent } from '../shared/instruction-generation.js';

declare global {
  interface Window {
    api: {
      call<T>(method: string, params: unknown): Promise<IpcResult<T>>;
      isDev: boolean;
      onInstructionGenerateProgress(listener: (event: GenerateDraftProgressEvent) => void): () => void;
      session: {
        onOutput(sessionId: string, listener: (chunk: string) => void): () => void;
        onExit(sessionId: string, listener: (exitCode: number) => void): () => void;
      };
    };
  }
}

export {};
