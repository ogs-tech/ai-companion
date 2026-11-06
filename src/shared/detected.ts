import type { EntityKind } from './entity.js';

export type DetectedHarness = 'claude' | 'cursor';
export type DetectedKind = Extract<EntityKind, 'skill' | 'agent' | 'mcp' | 'hook' | 'instruction'>;

/**
 * A customization found in a harness's own config files that is not (yet) a
 * canonical entity. Read-only until imported: `detected.import` turns it into
 * an `Entity`, which then propagates to every enabled harness.
 */
export interface DetectedEntity {
  /** Opaque and deterministic: the same item yields the same id across reads. */
  id: string;
  kind: DetectedKind;
  name: string;
  description: string;
  harness: DetectedHarness;
  scope: 'personal' | 'workspace';
  /**
   * Workspace folder the item was found in (workspace scope only). For an
   * `instruction` it is set only in a multi-folder workspace — where it names the
   * folder-level instruction — and absent for the workspace-wide one.
   */
  folder?: string;
  /** File the item was read from. */
  path: string;
  importable: boolean;
  /** Why it cannot be imported (when `importable` is false). */
  reason?: string;
  /** Kind-specific, display-only view of the definition (mcp `def`, hook `event`/`matcher`/`handler`, …). */
  preview: Record<string, unknown>;
}

export interface DetectedListParams {
  kinds?: DetectedKind[];
}
