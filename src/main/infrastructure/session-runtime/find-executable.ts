import { access, constants } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * Whether `bin` resolves to an executable file: directly when it is a path,
 * otherwise through `PATH` plus `extraDirs` (where installers drop CLIs that a
 * GUI-launched app's trimmed `PATH` does not list, e.g. `~/.local/bin`).
 */
export async function isExecutableAvailable(
  bin: string,
  extraDirs: readonly string[] = [],
  pathEnv: string = process.env['PATH'] ?? '',
): Promise<boolean> {
  const candidates = isAbsolute(bin)
    ? [bin]
    : [...pathEnv.split(delimiter).filter((dir) => dir !== ''), ...extraDirs].map((dir) => join(dir, bin));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Not here — try the next directory.
    }
  }
  return false;
}
