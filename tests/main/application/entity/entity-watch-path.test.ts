import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mapFilePathToEntity } from '../../../../src/main/application/entity/entity-watch-path.js';

const dataDir = '/home/user/.ai-companion';

describe('mapFilePathToEntity', () => {
  it('maps a skill SKILL.md path', () => {
    expect(mapFilePathToEntity(dataDir, join(dataDir, 'skills', 'demo', 'SKILL.md'))).toEqual({
      kind: 'skill',
      name: 'demo',
    });
  });

  it('maps an agent .md path', () => {
    expect(mapFilePathToEntity(dataDir, join(dataDir, 'agents', 'rev.md'))).toEqual({
      kind: 'agent',
      name: 'rev',
    });
  });

  it('maps the personal instruction path', () => {
    expect(mapFilePathToEntity(dataDir, join(dataDir, 'instructions', 'default.md'))).toEqual({
      kind: 'instruction',
      name: 'default',
    });
  });

  it('maps a project instruction body path', () => {
    expect(mapFilePathToEntity(dataDir, join(dataDir, 'instructions', 'project', 'acme', 'INSTRUCTION.md'))).toEqual({
      kind: 'instruction',
      name: 'acme',
    });
  });

  it('returns null for a project instruction meta.json path (not the entity body)', () => {
    expect(mapFilePathToEntity(dataDir, join(dataDir, 'instructions', 'project', 'acme', 'meta.json'))).toBeNull();
  });

  it('returns null for an unrelated path outside any watched convention', () => {
    expect(mapFilePathToEntity(dataDir, join(dataDir, 'settings.json'))).toBeNull();
  });

  it('returns null for a skill\'s non-SKILL.md file', () => {
    expect(mapFilePathToEntity(dataDir, join(dataDir, 'skills', 'demo', 'notes.md'))).toBeNull();
  });
});
