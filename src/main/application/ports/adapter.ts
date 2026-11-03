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

/**
 * What a `merge` destination puts into a shared JSON file (`~/.claude.json`,
 * `~/.cursor/hooks.json`, …). The file also holds other keys and hand edits, so
 * the app only ever touches the one entry it names here.
 *
 *  - `object-key`: `value` is the property `key` of the object at `path`
 *    (e.g. path `['mcpServers']`, key `github`).
 *  - `array-item`: `value` is one element of the array at `path`
 *    (e.g. `['hooks', 'PreToolUse']`). The element is found again on later
 *    syncs by `identity` — dotted-path → expected value, e.g.
 *    `{ matcher: 'Bash', 'hooks.0.command': './check.sh' }`.
 */
export type MergeTarget =
  | { shape: 'object-key'; path: string[]; key: string; value: unknown }
  | { shape: 'array-item'; path: string[]; identity: Record<string, unknown>; value: unknown };

export type AdapterDestination =
  | { scope: 'personal' | 'workspace'; destination: string; strategy: 'symlink' }
  | {
      scope: 'personal' | 'workspace';
      /** The shared JSON file the entry is merged into. */
      destination: string;
      strategy: 'merge';
      target: MergeTarget;
      /** Top-level keys written only when the file does not exist yet (e.g. Cursor's `version: 1`). */
      seed?: Record<string, unknown>;
    }
  | {
      scope: 'personal' | 'workspace';
      destination: string;
      strategy: 'skip';
      /** Why this harness cannot express the entity; surfaced as a Sync-report warning. */
      reason: string;
    }
  | {
      scope: 'personal' | 'workspace';
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
   * entities go to the adapter's home surface; workspace-scoped
   * instructions resolve their target path via `resolveScopePath` and fan out
   * to that single path.
   */
  resolveEntityDestinations(args: {
    entity: Entity;
  }): Promise<AdapterDestination[]> | AdapterDestination[];
}
