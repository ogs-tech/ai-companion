import { describe, it, expect } from 'vitest';
import { sessionAnchorKey, type SessionAnchor } from '../../src/shared/session.js';

describe('sessionAnchorKey', () => {
  it('derives entity:<urn> for an entity anchor', () => {
    const anchor: SessionAnchor = { kind: 'entity', urn: 'urn:skill:demo' };
    expect(sessionAnchorKey(anchor)).toBe('entity:urn:skill:demo');
  });

  it('derives workspace:<id> for a workspace anchor', () => {
    const anchor: SessionAnchor = { kind: 'workspace', workspaceId: 'w1' };
    expect(sessionAnchorKey(anchor)).toBe('workspace:w1');
  });

  it('derives project:<id> for a project anchor', () => {
    const anchor: SessionAnchor = { kind: 'project', projectId: 'p1' };
    expect(sessionAnchorKey(anchor)).toBe('project:p1');
  });
});
