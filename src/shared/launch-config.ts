export interface LaunchConfig {
  name: string;
  type: string; // raw `type`, e.g. 'node', 'chrome' — determines `supported`
  request: string; // raw `request`, e.g. 'launch', 'attach'
  program: string; // raw, before ${workspaceFolder} substitution
  args: string[];
  cwd?: string; // raw, before substitution; defaults to the Project's path if absent
  env?: Record<string, string>;
  supported: boolean; // true only for type: 'node', request: 'launch'
}

export interface ProjectLaunchConfigs {
  projectId: string;
  configs: LaunchConfig[];
  error?: string; // malformed launch.json — surfaced per-project, doesn't break other projects
}

export type LaunchProcessStatus = 'running' | 'exited';

export interface LaunchProcessSnapshot {
  processId: string;
  projectId: string;
  configName: string;
  status: LaunchProcessStatus;
  exitCode?: number | null;
}

/** A `LaunchProcessSnapshot` plus the scrollback captured so far — returned only by `launchConfig.status` (a single-process lookup), never by any aggregate list. */
export interface LaunchProcessSnapshotWithOutput extends LaunchProcessSnapshot {
  outputBuffer: string;
}

export interface LaunchProcessOutputEvent {
  processId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface LaunchProcessExitEvent {
  processId: string;
  exitCode: number | null;
  // A signal name (e.g. 'SIGTERM'), typed as `string` rather than Node's own
  // `NodeJS.Signals` — this DTO also compiles under the renderer's web
  // tsconfig, which has no `node` types.
  signal: string | null;
}

/** Push channel main→renderer for live launch-process output (mirrors session:output). */
export const LAUNCH_PROCESS_OUTPUT_CHANNEL = 'launchProcess:output' as const;
/** Push channel main→renderer fired once when a launched process exits. */
export const LAUNCH_PROCESS_EXIT_CHANNEL = 'launchProcess:exit' as const;
