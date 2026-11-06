import { useCallback, useRef, useState } from 'react';
import { askConflict, askTrash, type ConflictDecision } from '../../lib/dialog-host.js';
import { callIpc } from '../../lib/ipc.js';
import { useFileOps } from '../../hooks/use-file-ops.js';
import { useUiPreferences } from '../../hooks/use-ui-settings.js';
import type { ToastMessage } from '../Toast.js';
import type {
  ConflictResolution,
  TransferConflict,
  TransferMode,
  TransferRecord,
  TransferRequest,
} from '../../../shared/file-ops.js';

/** A path change the open tabs must follow. */
export interface PathChange {
  from: string;
  to: string;
}

export interface ExplorerActionsOptions {
  /** Open tabs retarget their path (rename / move). */
  onRetarget: (changes: PathChange[]) => void;
  /** Files or folders went to the trash: open tabs under them are marked removed. */
  onRemoved: (paths: string[]) => void;
  /** Multi-folder workspaces: the folder alias is the first path segment, and a transfer between two folders always copies. */
  multi: boolean;
}

export type EditingState = { kind: 'rename'; path: string } | { kind: 'create'; parentDir: string; type: 'file' | 'dir' } | null;

interface Clipboard {
  mode: TransferMode;
  paths: string[];
}

export const baseName = (relPath: string): string => relPath.slice(relPath.lastIndexOf('/') + 1);
export const parentOf = (relPath: string): string => {
  const slash = relPath.lastIndexOf('/');
  return slash === -1 ? '' : relPath.slice(0, slash);
};
export const joinPath = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);
export const isInside = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);
const folderOf = (relPath: string): string => relPath.split('/')[0] ?? '';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Drops paths whose ancestor is already in the list — moving a folder already moves what is inside it. */
export function topLevelOnly(paths: readonly string[]): string[] {
  return paths.filter((p) => !paths.some((other) => other !== p && isInside(p, other)));
}

/**
 * The Explorer's file operations as one controller: selection, in-app
 * clipboard, inline create/rename, trash, drag-and-drop transfers with name
 * conflicts, and the single-level Undo. Nothing here touches disk itself —
 * every change goes through `workspace.*` and the tree re-reads afterwards.
 */
export function useExplorerActions({ onRetarget, onRemoved, multi }: ExplorerActionsOptions) {
  const ops = useFileOps();
  const prefs = useUiPreferences();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const lastOp = useRef<TransferRecord[] | null>(null);

  const fail = useCallback((err: unknown) => setToast({ variant: 'error', message: errorMessage(err) }), []);

  // ── selection ────────────────────────────────────────────────────────────
  const select = useCallback((relPath: string, mode: 'replace' | 'toggle' | 'range', visible: readonly string[]) => {
    setSelection((prev) => {
      if (mode === 'toggle') {
        const next = new Set(prev);
        if (next.has(relPath)) next.delete(relPath);
        else next.add(relPath);
        anchorRef.current = relPath;
        return next;
      }
      if (mode === 'range' && anchorRef.current !== null) {
        const a = visible.indexOf(anchorRef.current);
        const b = visible.indexOf(relPath);
        if (a !== -1 && b !== -1) return new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1));
      }
      anchorRef.current = relPath;
      return new Set([relPath]);
    });
  }, []);
  const clearSelection = useCallback(() => setSelection(new Set()), []);

  // ── create / rename ──────────────────────────────────────────────────────
  const startCreate = useCallback((parentDir: string, type: 'file' | 'dir') => {
    setEditError(null);
    setEditing({ kind: 'create', parentDir, type });
  }, []);
  const startRename = useCallback((path: string) => {
    setEditError(null);
    setEditing({ kind: 'rename', path });
  }, []);
  const cancelEdit = useCallback(() => {
    setEditing(null);
    setEditError(null);
  }, []);

  /** Returns whether the edit finished; an invalid or used name keeps the field open with the message under it. */
  const commitEdit = useCallback(
    async (name: string): Promise<boolean> => {
      if (editing === null) return true;
      const trimmed = name.trim();
      if (trimmed === '') {
        setEditError('Digite um nome.');
        return false;
      }
      if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
        setEditError('O nome não pode ter barras nem ser "." ou "..".');
        return false;
      }
      try {
        if (editing.kind === 'create') {
          const path = joinPath(editing.parentDir, trimmed);
          if (editing.type === 'file') await ops.createFile(path);
          else await ops.createDir(path);
        } else if (trimmed !== baseName(editing.path)) {
          const to = await ops.rename(editing.path, trimmed);
          onRetarget([{ from: editing.path, to }]);
        }
        setEditing(null);
        setEditError(null);
        return true;
      } catch (err) {
        setEditError(errorMessage(err));
        return false;
      }
    },
    [editing, ops, onRetarget],
  );

  // ── duplicate / trash ────────────────────────────────────────────────────
  const duplicate = useCallback(
    async (path: string) => {
      try {
        await ops.duplicate(path);
      } catch (err) {
        fail(err);
      }
    },
    [ops, fail],
  );

  const trash = useCallback(
    async (paths: readonly string[]) => {
      const targets = topLevelOnly(paths);
      if (targets.length === 0) return;
      if (prefs.confirmTrash) {
        const decision = await askTrash(targets.map(baseName));
        if (!decision.confirmed) return;
        if (decision.dontAskAgain) prefs.setConfirmTrash(false);
      }
      try {
        const { failed } = await ops.trash(targets);
        const failedPaths = new Set(failed.map((f) => f.path));
        onRemoved(targets.filter((p) => !failedPaths.has(p)));
        setSelection(new Set());
        if (failed.length > 0) {
          setToast({ variant: 'error', message: `Não foi possível mover ${failed.map((f) => `"${baseName(f.path)}"`).join(', ')}: ${failed[0]?.message ?? ''}` });
        }
      } catch (err) {
        fail(err);
      }
    },
    [ops, prefs, onRemoved, fail],
  );

  // ── transfers (paste, drag and drop, import) ─────────────────────────────
  const undo = useCallback(async () => {
    const records = lastOp.current;
    if (records === null) return;
    lastOp.current = null;
    try {
      const result = await ops.undoTransfer(records);
      onRetarget(records.filter((r) => r.mode === 'move').map((r) => ({ from: r.to, to: r.from })));
      setToast(
        result.failed.length > 0
          ? { variant: 'error', message: `Não foi possível desfazer: ${result.failed[0]?.message ?? 'o estado mudou'}` }
          : { variant: 'success', message: 'Operação desfeita.' },
      );
    } catch (err) {
      fail(err);
    }
  }, [ops, onRetarget, fail]);

  /** Asks the user about each conflict (or applies one answer to all) and returns the target → resolution map; `null` = cancelled. */
  const resolveConflicts = useCallback(async (conflicts: TransferConflict[]): Promise<Record<string, ConflictResolution> | null> => {
    const resolutions: Record<string, ConflictResolution> = {};
    let all: ConflictDecision | null = null;
    for (const [index, conflict] of conflicts.entries()) {
      const mismatch = conflict.sourceKind !== conflict.targetKind;
      let decision: ConflictDecision | null = all;
      if (decision === null) {
        decision = await askConflict({ name: baseName(conflict.target), kindMismatch: mismatch, remaining: conflicts.length - index - 1 });
        if (decision === null) return null;
        if (decision.applyToAll) all = decision;
      }
      // "Replace" never applies to a file/folder clash: fall back to keeping both.
      resolutions[conflict.target] = mismatch && decision.resolution === 'replace' ? 'keep-both' : decision.resolution;
    }
    return resolutions;
  }, []);

  const transfer = useCallback(
    async (request: TransferRequest) => {
      try {
        let effective = request;
        // Between two workspace folders a move is always a copy.
        if (multi && request.mode === 'move' && !request.external) {
          const crossFolder = request.sources.some((s) => folderOf(s) !== folderOf(request.targetDir));
          if (crossFolder) effective = { ...request, mode: 'copy' };
        }
        const conflicts = await ops.planTransfer(effective);
        if (conflicts.length > 0) {
          const resolutions = await resolveConflicts(conflicts);
          if (resolutions === null) return;
          effective = { ...effective, resolutions };
        }
        const result = await ops.transfer(effective);
        const moved = result.done.filter((r) => r.mode === 'move');
        if (moved.length > 0) onRetarget(moved.map((r) => ({ from: r.from, to: r.to })));
        lastOp.current = result.done.length > 0 ? result.done : null;
        const replaced = result.done.some((r) => r.replaced);
        const verb = result.done.every((r) => r.mode === 'copy') ? 'copiado' : 'movido';
        if (result.failed.length > 0) {
          setToast({
            variant: 'error',
            message: `Não foi possível ${verb === 'copiado' ? 'copiar' : 'mover'} ${result.failed.map((f) => `"${baseName(f.path)}"`).join(', ')}: ${result.failed[0]?.message ?? ''}`,
          });
        } else if (result.done.length > 0) {
          setToast({
            variant: 'success',
            message:
              (result.done.length === 1 ? `"${baseName(result.done[0]?.to ?? '')}" ${verb}.` : `${result.done.length} itens ${verb}s.`) +
              (replaced ? ' Os originais substituídos continuam na lixeira.' : ''),
            action: { label: 'Desfazer', onClick: () => void undo() },
          });
        }
      } catch (err) {
        fail(err);
      }
    },
    [multi, ops, resolveConflicts, onRetarget, undo, fail],
  );

  // ── clipboard ────────────────────────────────────────────────────────────
  const copy = useCallback((paths: readonly string[]) => setClipboard({ mode: 'copy', paths: topLevelOnly(paths) }), []);
  const cut = useCallback((paths: readonly string[]) => setClipboard({ mode: 'move', paths: topLevelOnly(paths) }), []);
  const paste = useCallback(
    async (targetDir: string) => {
      if (clipboard === null || clipboard.paths.length === 0) return;
      await transfer({ sources: clipboard.paths, targetDir, mode: clipboard.mode });
      if (clipboard.mode === 'move') setClipboard(null);
    },
    [clipboard, transfer],
  );

  /** Files dropped from outside (Finder): granted by main first, then copied in. */
  const importExternal = useCallback(
    async (absolutePaths: string[], targetDir: string) => {
      try {
        const granted = await callIpc<string[]>('externalFile.grantDropped', { paths: absolutePaths });
        if (granted.length === 0) return;
        await transfer({ sources: granted, targetDir, mode: 'copy', external: true });
      } catch (err) {
        fail(err);
      }
    },
    [transfer, fail],
  );

  return {
    selection,
    select,
    clearSelection,
    editing,
    editError,
    startCreate,
    startRename,
    cancelEdit,
    commitEdit,
    duplicate,
    trash,
    clipboard,
    copy,
    cut,
    paste,
    transfer,
    importExternal,
    undo,
    canUndo: () => lastOp.current !== null,
    toast,
    setToast,
    fail,
  };
}

export type ExplorerActions = ReturnType<typeof useExplorerActions>;
