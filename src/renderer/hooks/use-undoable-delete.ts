import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ToastMessage } from '../components/Toast.js';

/** How long "Desfazer" stays available before the delete really happens — same window as removing a session. */
export const UNDO_DELETE_WINDOW_MS = 6000;

export interface UndoableDeleteRequest {
  /** The tree item's key: hidden while the delete is pending. */
  key: string;
  /** Toast text, e.g. `"tdd" excluído`. */
  message: string;
  /** The real delete, run when the window ends (or the list goes away). */
  commit: () => Promise<unknown>;
}

export interface UndoableDelete {
  pendingKeys: ReadonlySet<string>;
  requestDelete(request: UndoableDeleteRequest): void;
  toast: ToastMessage | null;
  dismissToast(): void;
}

/**
 * Optimistic delete with undo: the row disappears at once, "Desfazer" brings it back, and the delete only runs
 * when the window ends. A failed delete brings the row back with an error. Unmounting (closing the panel,
 * switching scope) commits whatever is pending — a delete the user saw happen must not silently vanish.
 */
export function useUndoableDelete(): UndoableDelete {
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => Promise<unknown> }>());

  const unmark = useCallback((key: string): void => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const run = useCallback(
    async (key: string, commit: () => Promise<unknown>): Promise<void> => {
      pending.current.delete(key);
      try {
        await commit();
      } catch (err) {
        setToast({ variant: 'error', message: `Não foi possível excluir: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        unmark(key);
      }
    },
    [unmark],
  );

  const requestDelete = useCallback(
    ({ key, message, commit }: UndoableDeleteRequest): void => {
      const previous = pending.current.get(key);
      if (previous !== undefined) clearTimeout(previous.timer);
      setPendingKeys((prev) => new Set(prev).add(key));
      const timer = setTimeout(() => void run(key, commit), UNDO_DELETE_WINDOW_MS);
      pending.current.set(key, { timer, commit });
      setToast({
        variant: 'success',
        message,
        action: {
          label: 'Desfazer',
          onClick: () => {
            clearTimeout(timer);
            pending.current.delete(key);
            unmark(key);
            setToast(null);
          },
        },
      });
    },
    [run, unmark],
  );

  useEffect(() => {
    const entries = pending.current;
    return () => {
      for (const { timer, commit } of entries.values()) {
        clearTimeout(timer);
        void commit().catch(() => undefined);
      }
      entries.clear();
    };
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);
  return { pendingKeys, requestDelete, toast, dismissToast };
}

/**
 * How rows reach the list's undoable delete without threading it through every tree group. Without a provider
 * (a row rendered on its own) the delete commits at once.
 */
export const UndoableDeleteContext = createContext<UndoableDelete['requestDelete']>(({ commit }) => {
  void commit();
});

export function useRequestDelete(): UndoableDelete['requestDelete'] {
  return useContext(UndoableDeleteContext);
}
