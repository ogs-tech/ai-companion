import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import {
  getLaunchProcessesSnapshot,
  markLaunchProcessExited,
  registerLaunchProcess,
  subscribeLaunchProcesses,
} from '../lib/launch-process-store.js';
import type { LaunchProcessSnapshot } from '../../shared/launch-config.js';

export function useRunLaunchConfig() {
  return useMutation({
    mutationFn: (args: { projectId: string; configName: string }) => callIpc<LaunchProcessSnapshot>('launchConfig.run', args),
    onSuccess: (snapshot) => registerLaunchProcess(snapshot),
  });
}

export function useKillLaunchProcess() {
  return useMutation({
    mutationFn: (processId: string) => callIpc<void>('launchConfig.kill', { processId }),
  });
}

/** Every launch process run this renderer session, running and exited alike — see `launch-process-store.ts` for why this isn't a `launchConfig.list`-backed query. */
export function useLaunchProcesses(): readonly LaunchProcessSnapshot[] {
  const { processes } = useSyncExternalStore(subscribeLaunchProcesses, getLaunchProcessesSnapshot);
  useEffect(() => {
    return window.api.launchConfig.onAnyExit((processId, exitCode) => {
      markLaunchProcessExited(processId, exitCode);
    });
  }, []);
  return processes;
}

interface LaunchProcessOutputLine {
  stream: 'stdout' | 'stderr';
  chunk: string;
}

/**
 * Live streamed output + terminal status for one launch process — replays
 * `launchConfig.status`'s captured buffer first, then appends whatever
 * streams in afterward over the push channel.
 */
export function useLaunchProcessOutput(processId: string): {
  lines: LaunchProcessOutputLine[];
  status: LaunchProcessSnapshot['status'] | undefined;
} {
  const [lines, setLines] = useState<LaunchProcessOutputLine[]>([]);
  const [status, setStatus] = useState<LaunchProcessSnapshot['status'] | undefined>(undefined);

  // Resets in the render phase when `processId` changes (rather than inside
  // the effect below) — React's documented pattern for "adjusting state when
  // a prop changes", so a switch between two processIds' output never shows
  // a stale flash of the previous one's lines.
  const [lastProcessId, setLastProcessId] = useState(processId);
  if (lastProcessId !== processId) {
    setLastProcessId(processId);
    setLines([]);
    setStatus(undefined);
  }

  useEffect(() => {
    let cancelled = false;
    void callIpc<(LaunchProcessSnapshot & { outputBuffer: string }) | null>('launchConfig.status', { processId }).then(
      (snapshot) => {
        if (cancelled || !snapshot) return;
        setStatus(snapshot.status);
        if (snapshot.outputBuffer) setLines([{ stream: 'stdout', chunk: snapshot.outputBuffer }]);
      },
    );
    const unsubscribeOutput = window.api.launchConfig.onOutput(processId, (stream, chunk) => {
      setLines((prev) => [...prev, { stream, chunk }]);
    });
    const unsubscribeExit = window.api.launchConfig.onExit(processId, () => {
      setStatus('exited');
    });
    return () => {
      cancelled = true;
      unsubscribeOutput();
      unsubscribeExit();
    };
  }, [processId]);

  return { lines, status };
}
