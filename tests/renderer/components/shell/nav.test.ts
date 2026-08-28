import { describe, it, expect } from 'vitest';
import { NAV_AREAS, defaultNav, type Nav } from '../../../../src/renderer/components/shell/nav.js';

describe('nav model', () => {
  it('exposes the four primary areas in order', () => {
    expect(NAV_AREAS.map((a) => a.area)).toEqual(['workspace', 'starter-pack', 'marketplaces', 'diagnostico']);
  });
  it('lands on the Workspace overview by default', () => {
    expect(defaultNav).toEqual<Nav>({ area: 'workspace' });
  });
});
