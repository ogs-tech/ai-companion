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
