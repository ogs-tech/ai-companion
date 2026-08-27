import { describe, it, expect } from 'vitest';
import {
  NAV_AREAS, WORKSPACE_SUBS, PLUGINS_SUBS, navTestId, defaultNav, areaHasSub, type Nav,
} from '../../../../src/renderer/components/shell/nav.js';

describe('nav model', () => {
  it('exposes the four primary areas in order', () => {
    expect(NAV_AREAS.map((a) => a.area)).toEqual(['workspace','starter-pack','plugins','diagnostico']);
  });
  it('lists the five workspace subs and two plugins subs', () => {
    expect(WORKSPACE_SUBS.map((s) => s.sub)).toEqual(['visao-geral','skills','agents','hooks','mcps']);
    expect(PLUGINS_SUBS.map((s) => s.sub)).toEqual(['plugins','marketplaces']);
  });
  it('builds nav-* testids', () => {
    expect(navTestId({ area: 'workspace', sub: 'skills' })).toBe('nav-skills');
    expect(navTestId({ area: 'starter-pack' })).toBe('nav-starter-pack');
    expect(navTestId({ area: 'diagnostico' })).toBe('nav-diagnostico');
  });
  it('lands on the Workspace overview by default', () => {
    expect(defaultNav).toEqual<Nav>({ area: 'workspace', sub: 'visao-geral' });
  });
  it('reports sub-having areas via areaHasSub, matching NAV_AREAS', () => {
    expect(NAV_AREAS.map((a) => ({ area: a.area, hasSub: areaHasSub(a.area) }))).toEqual([
      { area: 'workspace', hasSub: true },
      { area: 'starter-pack', hasSub: false },
      { area: 'plugins', hasSub: true },
      { area: 'diagnostico', hasSub: false },
    ]);
  });
});
