import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { ProjectRegistryFile } from '../../../shared/project.js';
import type { ProjectRegistry } from '../../application/ports/project-registry.js';

const hasErrnoCode = (err: unknown, code: string): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;

export class FsProjectRegistry implements ProjectRegistry {
  constructor(private readonly filePath: string) {}

  async load(): Promise<ProjectRegistryFile | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as ProjectRegistryFile;
    } catch (err) {
      if (hasErrnoCode(err, 'ENOENT')) return null;
      throw err;
    }
  }

  async save(file: ProjectRegistryFile): Promise<void> {
    const dir = dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const name = basename(this.filePath);
    const tempPath = join(dir, `.${name}.${randomBytes(8).toString('hex')}.tmp`);

    await fs.writeFile(tempPath, JSON.stringify(file, null, 2), 'utf8');
    try {
      await fs.rename(tempPath, this.filePath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
  }
}
