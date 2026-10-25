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

  it('derives a single key for the personal anchor (Início)', () => {
    const anchor: SessionAnchor = { kind: 'personal' };
    expect(sessionAnchorKey(anchor)).toBe('personal');
  });
});
