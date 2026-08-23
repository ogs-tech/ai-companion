import type { Entity } from '../../../shared/entity.js';

/**
 * How the FileMaterializer detects "app-owned" for the `write` strategy.
 *  - `startsWith`: ownership marker must be a prefix of the file (default;
 *    used by AGENTS.md with the HTML comment marker).
 *  - `includes`: marker may appear anywhere; used when the file format
 *    requires a specific top-of-file structure (e.g. `.mdc` frontmatter,
 *    `.json` root object) and the marker sits inside it.
 */
export type OwnershipCheck = 'startsWith' | 'includes';

export type AdapterDestination =
  | { scope: 'personal' | 'project' | 'workspace'; destination: string; strategy: 'symlink' }
  | {
      scope: 'personal' | 'project' | 'workspace';
      destination: string;
      strategy: 'write';
      content: string;
      /**
       * When present, overrides the default GENERATED_FILE_MARKER used by the
       * FileMaterializer to detect app-owned files. Required when the target
       * file format doesn't tolerate the default marker at position 0 (e.g.
       * `.mdc` frontmatter or `.json` root object).
       */
      ownershipMarker?: string;
      /**
       * Where the marker is expected in the file. Defaults to `startsWith`.
       */
      ownershipCheck?: OwnershipCheck;
    };

export interface Adapter {
  adapterId: string;
  /**
   * Resolve the concrete on-disk destinations for an entity. Personal-scoped
   * entities go to the adapter's home surface; project/workspace-scoped
   * instructions resolve their target path via `resolveScopePath` and fan out
   * to that single path.
   */
  resolveEntityDestinations(args: {
    entity: Entity;
  }): Promise<AdapterDestination[]> | AdapterDestination[];
}
