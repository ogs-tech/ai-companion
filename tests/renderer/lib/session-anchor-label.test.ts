import { describe, expect, it } from 'vitest';
import { anchorKindLabel } from '../../../src/renderer/lib/session-anchor-label.js';

describe('anchorKindLabel', () => {
  it('labels a workspace anchor', () => {
    expect(anchorKindLabel({ kind: 'workspace', workspaceId: 'w1' })).toBe('Workspace');
  });

  it('labels a project anchor', () => {
    expect(anchorKindLabel({ kind: 'project', projectId: 'p1' })).toBe('Project');
  });

  it('labels an entity anchor by its urn kind', () => {
    expect(anchorKindLabel({ kind: 'entity', urn: 'urn:skill:foo' })).toBe('Skill');
    expect(anchorKindLabel({ kind: 'entity', urn: 'urn:agent:bar' })).toBe('Agent');
    expect(anchorKindLabel({ kind: 'entity', urn: 'urn:instruction:default' })).toBe('Instruction');
  });

  it('falls back to "Entity" for an unrecognized urn kind', () => {
    expect(anchorKindLabel({ kind: 'entity', urn: 'urn:unknown:x' })).toBe('Entity');
  });
});
