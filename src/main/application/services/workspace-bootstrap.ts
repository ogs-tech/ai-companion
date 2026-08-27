import type { FileSystemMutator } from '../ports/file-system-mutator.js';
import { WorkspacePaths } from '../../../shared/settings.js';
import { brand } from '../../../shared/brand.js';
import { workspaceIndexMarkerPath } from '../../../shared/brand-paths.js';

const joinPosix = (...parts: string[]): string =>
  parts.join('/').replace(/\/+/g, '/');

const AI_COMPANION_INDEX_CONTENT = `# ${brand.displayName}

This folder is managed by the ${brand.displayName} app. Files here are generated or
symlinked automatically — edit skills, agents, and instructions from the app,
not by hand.
`;

export class WorkspaceBootstrapService {
  constructor(private readonly mutator: FileSystemMutator) {}

  async create(workspacePath: string): Promise<void> {
    for (const sub of WorkspacePaths) {
      await this.mutator.mkdirRecursive(joinPosix(workspacePath, sub));
    }
    await this.mutator.writeFile(workspaceIndexMarkerPath(workspacePath), AI_COMPANION_INDEX_CONTENT);
  }
}
