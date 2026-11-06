import { Component, type ErrorInfo, type ReactNode } from 'react';
import { callIpc } from '../lib/ipc.js';
import { RecoveryScreen } from './RecoveryScreen.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Last line of defence around the renderer root: a render error shows the recovery screen instead of a blank window, and is logged by main. */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = [error.stack, info.componentStack].filter(Boolean).join('\n');
    // Logging is best effort: a failure to log must never replace the recovery screen.
    void callIpc('desktop.reportError', { source: 'renderer', message: error.message, stack }).catch(() => undefined);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const details = `${error.stack ?? error.message}\nrenderer · ${new Date().toISOString()}`;
    return <RecoveryScreen details={details} onReload={() => window.location.reload()} />;
  }
}
