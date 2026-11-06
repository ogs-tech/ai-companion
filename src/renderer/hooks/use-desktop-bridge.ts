import { useEffect, useState, useSyncExternalStore } from 'react';
import { callIpc } from '../lib/ipc.js';
import { confirmQuit } from '../lib/workspace-tabs-guard.js';
import { getShellStatus, subscribeShellStatus } from '../lib/shell-status-store.js';
import { composeWindowTitle } from '../lib/window-title.js';

function report(message: string, stack?: string): void {
  void callIpc('desktop.reportError', { source: 'renderer', message, ...(stack !== undefined ? { stack } : {}) }).catch(() => undefined);
}

/**
 * Wires the renderer to the desktop shell in main, once, at the app root:
 * answers "may the window close?" with the unsaved-tabs question, logs errors
 * nobody caught, keeps the window title in sync, and surfaces the recovery
 * screen main asks for after a crash. Returns the recovery details, or null.
 */
export function useDesktopBridge(): string | null {
  const [recovery, setRecovery] = useState<string | null>(null);
  const status = useSyncExternalStore(subscribeShellStatus, getShellStatus);

  useEffect(() => {
    const { desktop } = window.api;
    const offQuit = desktop.onQuitRequest((requestId) => {
      void confirmQuit().then(
        (proceed) => callIpc('desktop.respondToQuit', { requestId, proceed }),
        () => callIpc('desktop.respondToQuit', { requestId, proceed: true }),
      );
    });
    const offRecovery = desktop.onRecovery(setRecovery);
    const onError = (event: ErrorEvent): void => report(event.message, event.error instanceof Error ? event.error.stack : undefined);
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason;
      report(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : undefined);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      offQuit();
      offRecovery();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const title = recovery !== null ? 'AI Companion' : composeWindowTitle(status);
  const edited = recovery === null && status.tab?.dirty === true;
  useEffect(() => {
    document.title = title;
    void callIpc('desktop.setWindowTitle', { title, edited }).catch(() => undefined);
  }, [title, edited]);

  return recovery;
}
