import { relative, sep } from 'node:path';
import type { EntityKind } from '../../../shared/entity.js';

export interface WatchedEntityTarget {
  kind: EntityKind;
  name: string;
}

/**
 * Reverse of `FsEntityRepository`'s private `fileFor`/instruction path
 * conventions — maps an absolute path a file watcher reports back under
 * `dataDir` to the entity it belongs to, or `null` for any path that isn't
 * one of the four canonical entity source files (a `meta.json` sidecar, an
 * unrelated file inside a skill's own directory, etc.).
 */
export function mapFilePathToEntity(dataDir: string, absolutePath: string): WatchedEntityTarget | null {
  const rel = relative(dataDir, absolutePath);
  if (rel.startsWith('..') || rel === '') return null;
  const parts = rel.split(sep);

  if (parts.length === 3 && parts[0] === 'skills' && parts[2] === 'SKILL.md') {
    return { kind: 'skill', name: parts[1]! };
  }
  if (parts.length === 2 && parts[0] === 'agents' && parts[1]!.endsWith('.md')) {
    return { kind: 'agent', name: parts[1]!.slice(0, -'.md'.length) };
  }
  if (parts.length === 2 && parts[0] === 'instructions' && parts[1] === 'default.md') {
    return { kind: 'instruction', name: 'default' };
  }
  if (parts.length === 4 && parts[0] === 'instructions' && parts[1] === 'project' && parts[3] === 'INSTRUCTION.md') {
    return { kind: 'instruction', name: parts[2]! };
  }
  return null;
}
