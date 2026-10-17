export interface LaunchConfig {
  name: string;
  type: string; // raw `type`, e.g. 'node', 'chrome' — determines `supported`
  request: string; // raw `request`, e.g. 'launch', 'attach'
  program?: string; // raw, before ${workspaceFolder} substitution; absent for e.g. `runtimeExecutable` or Chrome (`url`) configs
  runtimeExecutable?: string; // raw — replaces `node` as the spawned command (e.g. 'pnpm')
  runtimeArgs?: string[]; // raw — passed to the executable before `program`/`args`
  args: string[];
  cwd?: string; // raw, before substitution; defaults to the workspace root if absent
  env?: Record<string, string>;
  supported: boolean; // true only for type: 'node', request: 'launch' with a `program` or `runtimeExecutable`
}

/** The active workspace's own `.vscode/launch.json`, read at its root. */
export interface WorkspaceLaunchConfigs {
  workspaceId: string;
  configs: LaunchConfig[];
  error?: string; // malformed launch.json — surfaced in place of the configs
}

export type LaunchProcessStatus = 'running' | 'exited';

export interface LaunchProcessSnapshot {
  processId: string;
  workspaceId: string;
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
