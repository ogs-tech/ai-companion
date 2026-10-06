import type { LaunchProcessSnapshot } from '../../shared/launch-config.js';

/**
 * Module-scoped, not React state — same reasoning as `browser-tabs-store.ts`:
 * a launch process is spawned from deep inside a `FolderTree`/pinnedRows row,
 * but its status badge and its own Workbench tab both need to see it too,
 * with no prop path connecting them. There is no `launchConfig.listProcesses`
 * IPC method (unlike sessions' `session.list`), so this store IS the
 * renderer's only record of what has been run this session — entries persist
 * (running or exited) for the renderer's lifetime, never refetched fresh from
 * the main process.
 */
export interface LaunchProcessesSnapshot {
  readonly processes: readonly LaunchProcessSnapshot[];
}

let processes: LaunchProcessSnapshot[] = [];
let snapshot: LaunchProcessesSnapshot = { processes };
const listeners = new Set<() => void>();

function notify(): void {
  snapshot = { processes };
  listeners.forEach((listener) => listener());
}

export function subscribeLaunchProcesses(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLaunchProcessesSnapshot(): LaunchProcessesSnapshot {
  return snapshot;
}

/** Records a freshly spawned process — called once `launchConfig.run` resolves. */
export function registerLaunchProcess(process: LaunchProcessSnapshot): void {
  processes = [...processes.filter((p) => p.processId !== process.processId), process];
  notify();
}

/** Updates a known process's status — called from the `launchProcess:exit` push-channel listener. */
export function markLaunchProcessExited(processId: string, exitCode: number | null): void {
  const idx = processes.findIndex((p) => p.processId === processId);
  if (idx === -1) return;
  processes = [...processes.slice(0, idx), { ...processes[idx]!, status: 'exited', exitCode }, ...processes.slice(idx + 1)];
  notify();
}

/** Test-only: clears the whole module-scoped singleton between test files. */
export function resetLaunchProcessesForTests(): void {
  processes = [];
  snapshot = { processes };
  listeners.clear();
}
