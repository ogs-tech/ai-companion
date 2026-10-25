import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConventionSourcePort } from '../../application/ports/convention-source-port.js';

/** `ConventionSourcePort` over the workspace folder on disk. */
export class FsConventionSource implements ConventionSourcePort {
  async list(root: string, dir: string): Promise<string[]> {
    try {
      const entries = await readdir(join(root, dir), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async read(root: string, relPath: string): Promise<string | null> {
    try {
      return await readFile(join(root, relPath), 'utf8');
    } catch {
      return null;
    }
  }
}
