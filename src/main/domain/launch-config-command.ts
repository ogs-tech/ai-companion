import { DomainError } from './errors.js';
import type { LaunchConfig } from '../../shared/launch-config.js';

export class UnsupportedLaunchTypeError extends DomainError {
  override readonly name = 'UnsupportedLaunchTypeError';
  constructor(message: string, details?: { type?: string; request?: string }) {
    super('validation', message, details);
  }
}

/** Replaces every `${workspaceFolder}` occurrence — the only VS Code variable this feature resolves. */
export function substituteVariables(value: string, vars: { workspaceFolder: string }): string {
  return value.replaceAll('${workspaceFolder}', vars.workspaceFolder);
}

export interface ResolvedLaunchCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

/**
 * Turns a `launch.json` config into a plain child-process invocation. Only
 * `type: 'node'`, `request: 'launch'` configs are runnable — this app has no
 * debug adapter, so anything else has no known launch command and throws.
 * Re-derives support from `type`/`request` itself rather than trusting the
 * config's own precomputed `supported` flag — defense in depth alongside the
 * renderer already disabling the row.
 */
export function resolveLaunchCommand(config: LaunchConfig, projectPath: string): ResolvedLaunchCommand {
  if (config.type !== 'node' || config.request !== 'launch') {
    throw new UnsupportedLaunchTypeError(
      `Unsupported launch config '${config.name}': type '${config.type}', request '${config.request}'`,
      { type: config.type, request: config.request },
    );
  }
  const vars = { workspaceFolder: projectPath };
  const sub = (value: string): string => substituteVariables(value, vars);
  return {
    command: 'node',
    args: [sub(config.program), ...config.args.map(sub)],
    cwd: sub(config.cwd ?? projectPath),
    ...(config.env ? { env: config.env } : {}),
  };
}
