import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import type { LaunchConfigReaderPort, LaunchConfigReadResult } from '../../application/ports/launch-config-reader-port.js';
import type { LaunchConfig } from '../../../shared/launch-config.js';

const MALFORMED: LaunchConfigReadResult = { error: 'malformed launch.json' };

/** `undefined` when absent, `null` when present but not an array of strings. */
function stringArray(raw: unknown): string[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((a): a is string => typeof a === 'string')) return null;
  return raw;
}

function toLaunchConfig(raw: unknown): LaunchConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const { name, type, request, program, runtimeExecutable } = obj;
  if (typeof name !== 'string' || typeof type !== 'string' || typeof request !== 'string') return null;
  if (program !== undefined && typeof program !== 'string') return null;
  if (runtimeExecutable !== undefined && typeof runtimeExecutable !== 'string') return null;
  const args = stringArray(obj['args']);
  const runtimeArgs = stringArray(obj['runtimeArgs']);
  if (args === null || runtimeArgs === null) return null;
  const cwd = obj['cwd'];
  const env = obj['env'];
  return {
    name,
    type,
    request,
    ...(program !== undefined ? { program } : {}),
    ...(runtimeExecutable !== undefined ? { runtimeExecutable } : {}),
    ...(runtimeArgs ? { runtimeArgs } : {}),
    args: args ?? [],
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof env === 'object' && env !== null ? { env: env as Record<string, string> } : {}),
    supported: type === 'node' && request === 'launch' && (program !== undefined || runtimeExecutable !== undefined),
  };
}

/**
 * Reads `<projectPath>/.vscode/launch.json`. JSONC (comments, trailing
 * commas), parsed with the same library VS Code itself uses for its own
 * `.vscode/*.json` files — see docs/superpowers/specs/2026-09-19-vscode-
 * launch-config-launcher-design.md §3.4. Any shape problem (parse error,
 * missing/wrong-typed `configurations`, a malformed entry) is reported as a
 * single explicit `{ error }` for the whole file — mirrors
 * `classifyExportFailure`'s "turn a raw failure into an explicit, typed
 * result" idiom (`src/main/infrastructure/spreadsheet/numbers-converter-
 * adapter.ts`) rather than silently dropping the bad entry.
 */
export class FsLaunchConfigReader implements LaunchConfigReaderPort {
  async read(projectPath: string): Promise<LaunchConfigReadResult> {
    let raw: string;
    try {
      raw = await readFile(join(projectPath, '.vscode', 'launch.json'), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { configs: [] };
      return MALFORMED;
    }
    const errors: ParseError[] = [];
    const parsed: unknown = parse(raw, errors, { allowTrailingComma: true });
    if (errors.length > 0) return MALFORMED;
    if (typeof parsed !== 'object' || parsed === null) return MALFORMED;
    const rawConfigurations = (parsed as Record<string, unknown>)['configurations'];
    if (!Array.isArray(rawConfigurations)) return MALFORMED;
    const configs: LaunchConfig[] = [];
    for (const entry of rawConfigurations) {
      const config = toLaunchConfig(entry);
      if (!config) return MALFORMED;
      configs.push(config);
    }
    return { configs };
  }
}
