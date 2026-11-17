import { useSyncExternalStore } from 'react';
import { openWorkspaceArea } from './workspace-area-store.js';

/**
 * Deep-link into Diagnósticos. The app has no router (a `View` union plus area tabs), so a ⚠ in the
 * tree records which item it came from and asks the shell to open the area; HealthScreen reads it back.
 */
export interface DiagnosticsFocus {
  /** The item the ⚠ came from; the screen names it. */
  urn: string;
  /** Every urn whose checks belong to it: the item itself, plus what it rolls up (a plugin's servers and hooks). */
  urns: readonly string[];
}

let focus: DiagnosticsFocus | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openDiagnosticsFor(urn: string, related: readonly string[] = []): void {
  focus = { urn, urns: [urn, ...related] };
  emit();
  openWorkspaceArea('diagnostico');
}

export function clearDiagnosticsFocus(): void {
  focus = null;
  emit();
}

export function useDiagnosticsFocus(): DiagnosticsFocus | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => focus,
    () => null,
  );
}
