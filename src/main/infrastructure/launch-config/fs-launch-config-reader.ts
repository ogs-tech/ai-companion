import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import type { LaunchConfigReaderPort, LaunchConfigReadResult } from '../../application/ports/launch-config-reader-port.js';
import type { LaunchConfig } from '../../../shared/launch-config.js';

const MALFORMED: LaunchConfigReadResult = { error: 'malformed launch.json' };

function toLaunchConfig(raw: unknown): LaunchConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const { name, type, request, program } = obj;
  if (typeof name !== 'string' || typeof type !== 'string' || typeof request !== 'string' || typeof program !== 'string') {
    return null;
  }
  const rawArgs = obj['args'];
  const args = Array.isArray(rawArgs) ? rawArgs.filter((a): a is string => typeof a === 'string') : [];
  if (Array.isArray(rawArgs) && args.length !== rawArgs.length) return null;
  const cwd = obj['cwd'];
  const env = obj['env'];
  return {
    name,
    type,
    request,
    program,
    args,
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof env === 'object' && env !== null ? { env: env as Record<string, string> } : {}),
    supported: type === 'node' && request === 'launch',
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
