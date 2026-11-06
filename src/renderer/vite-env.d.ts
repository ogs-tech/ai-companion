/// <reference types="vite/client" />

import type { IpcResult } from '../shared/ipc-contract.js';
import type { EntityChangedEvent } from '../shared/entity.js';
import type { WorkspaceTreeChangedEvent } from '../shared/file-ops.js';
import type { MenuCommand } from '../shared/desktop.js';

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
        onAnyActivity(listener: (sessionId: string) => void): () => void;
        onOpenRequest(listener: (target: { id: string; external: boolean }) => void): () => void;
      };
      externalSession: {
        onChanged(listener: () => void): () => void;
      };
      externalLink: {
        onOpen(listener: (url: string) => void): () => void;
      };
      entity: {
        onChanged(listener: (event: EntityChangedEvent) => void): () => void;
      };
      workspace: {
        onTreeChanged(listener: (event: WorkspaceTreeChangedEvent) => void): () => void;
      };
      desktop: {
        onMenuCommand(listener: (command: MenuCommand) => void): () => void;
        onOpenWorkspace(listener: (workspaceId: string) => void): () => void;
        onQuitRequest(listener: (requestId: string) => void): () => void;
        onRecovery(listener: (details: string) => void): () => void;
      };
      terminal: {
        onOutput(terminalId: string, listener: (chunk: string) => void): () => void;
        onExit(terminalId: string, listener: (exitCode: number | null, signal: string | null) => void): () => void;
        onAnyExit(listener: (terminalId: string, exitCode: number | null, signal: string | null) => void): () => void;
      };
    };
  }
}

export {};
