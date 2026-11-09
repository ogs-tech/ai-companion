import { useSyncExternalStore } from 'react';
import { openWorkspaceArea } from './workspace-area-store.js';

/**
 * Deep-link into Diagnósticos. The app has no router (a `View` union plus area tabs), so a ⚠ in the
 * tree records which item it came from and asks the shell to open the area; HealthScreen reads it back.
 */
let focusUrn: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openDiagnosticsFor(urn: string): void {
  focusUrn = urn;
  emit();
  openWorkspaceArea('diagnostico');
}

export function clearDiagnosticsFocus(): void {
  focusUrn = null;
  emit();
}

export function useDiagnosticsFocus(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => focusUrn,
    () => null,
  );
}
