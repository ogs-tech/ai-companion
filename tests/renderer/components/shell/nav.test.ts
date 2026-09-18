import { describe, it, expect } from 'vitest';
import { NAV_AREAS } from '../../../../src/renderer/components/shell/nav.js';

describe('nav model', () => {
  it('exposes the four primary areas in order, Workspace ("Início") leading', () => {
    expect(NAV_AREAS.map((a) => a.area)).toEqual(['workspace', 'starter-pack', 'marketplaces', 'diagnostico']);
  });
});
