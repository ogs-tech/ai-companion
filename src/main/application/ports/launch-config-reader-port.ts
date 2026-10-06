import type { LaunchConfig } from '../../../shared/launch-config.js';

export type LaunchConfigReadResult = { configs: LaunchConfig[] } | { error: string };

export interface LaunchConfigReaderPort {
  /** Reads and parses `<projectPath>/.vscode/launch.json`. No file → `{ configs: [] }` (not an error). */
  read(projectPath: string): Promise<LaunchConfigReadResult>;
}
