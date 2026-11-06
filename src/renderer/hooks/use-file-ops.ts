import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import type {
  TransferConflict,
  TransferRecord,
  TransferRequest,
  TransferResult,
  TrashResult,
  UndoTransferResult,
} from '../../shared/file-ops.js';

export interface FileOps {
  createFile: (path: string) => Promise<void>;
  createDir: (path: string) => Promise<void>;
  /** Resolves to the new workspace-relative path. */
  rename: (path: string, newName: string) => Promise<string>;
  duplicate: (path: string) => Promise<string>;
  trash: (paths: string[]) => Promise<TrashResult>;
  planTransfer: (request: TransferRequest) => Promise<TransferConflict[]>;
  transfer: (request: TransferRequest) => Promise<TransferResult>;
  undoTransfer: (records: TransferRecord[]) => Promise<UndoTransferResult>;
}

/**
 * The Explorer's file operations as plain async calls. Every mutation re-reads
 * the file-browser queries afterwards, so the tree shows what is on disk.
 */
export function useFileOps(): FileOps {
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['workspace', 'listDir'] }),
    [queryClient],
  );
  return useMemo<FileOps>(() => {
    const after = async <T,>(promise: Promise<T>): Promise<T> => {
      try {
        return await promise;
      } finally {
        void refresh();
      }
    };
    return {
      createFile: (path) => after(callIpc<void>('workspace.createFile', { path })),
      createDir: (path) => after(callIpc<void>('workspace.createDir', { path })),
      rename: async (path, newName) => (await after(callIpc<{ path: string }>('workspace.renameEntry', { path, newName }))).path,
      duplicate: async (path) => (await after(callIpc<{ path: string }>('workspace.duplicate', { path }))).path,
      trash: (paths) => after(callIpc<TrashResult>('workspace.trash', { paths })),
      planTransfer: async (request) => (await callIpc<{ conflicts: TransferConflict[] }>('workspace.planTransfer', request)).conflicts,
      transfer: (request) => after(callIpc<TransferResult>('workspace.transfer', request)),
      undoTransfer: (records) => after(callIpc<UndoTransferResult>('workspace.undoTransfer', { records })),
    };
  }, [refresh]);
}
