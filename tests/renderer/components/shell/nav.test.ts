import { describe, it, expect } from 'vitest';
import {
  NAV_AREAS, LIBRARY_SUBS, PLUGINS_SUBS, navTestId, defaultNav, type Nav,
} from '../../../../src/renderer/components/shell/nav.js';

describe('nav model', () => {
  it('exposes the five primary areas in order', () => {
    expect(NAV_AREAS.map((a) => a.area)).toEqual(['inicio','workspace','biblioteca','plugins','diagnostico']);
  });
  it('lists the five library subs and two plugins subs', () => {
    expect(LIBRARY_SUBS.map((s) => s.sub)).toEqual(['skills','agents','hooks','instructions','mcps']);
    expect(PLUGINS_SUBS.map((s) => s.sub)).toEqual(['plugins','marketplaces']);
  });
  it('builds nav-* testids', () => {
    expect(navTestId({ area: 'biblioteca', sub: 'skills' })).toBe('nav-skills');
    expect(navTestId({ area: 'inicio' })).toBe('nav-inicio');
    expect(navTestId({ area: 'diagnostico' })).toBe('nav-diagnostico');
  });
  it('lands on início by default', () => {
    expect(defaultNav).toEqual<Nav>({ area: 'inicio' });
  });
});
