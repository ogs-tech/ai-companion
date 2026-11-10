import { describe, it, expect } from 'vitest';
import { parseSearchQuery, searchCustomizations, searchSessions } from '../../../src/renderer/lib/palette-search.js';
import type { Entity } from '../../../src/shared/entity.js';
import type { SessionSnapshot } from '../../../src/shared/session.js';

const session = (over: Partial<SessionSnapshot>): SessionSnapshot =>
  ({
    sessionId: 'x', harness: 'claude', conversationId: 'c', anchor: { kind: 'personal' }, cwd: '/', label: 'Untitled',
    status: 'running', scopeId: null, ...over,
  }) as SessionSnapshot;

const entity = (name: string, description: string): Entity =>
  ({ urn: `urn:skill:${name}`, kind: 'skill', name, description, scopes: ['personal'], metadata: {} }) as unknown as Entity;

describe('parseSearchQuery', () => {
  it('reads a one-character prefix into a mode and strips it from the term', () => {
    expect(parseSearchQuery('@palette', 'all')).toEqual({ mode: 'files', prefix: '@', term: 'palette' });
    expect(parseSearchQuery('#deploy', 'all')).toEqual({ mode: 'sessions', prefix: '#', term: 'deploy' });
    expect(parseSearchQuery('/review', 'all')).toEqual({ mode: 'customizations', prefix: '/', term: 'review' });
    expect(parseSearchQuery('>sync', 'files')).toEqual({ mode: 'commands', prefix: '>', term: 'sync' });
    expect(parseSearchQuery(':42', 'files')).toEqual({ mode: 'line', prefix: ':', term: '42' });
  });

  it('keeps the base mode when there is no prefix', () => {
    expect(parseSearchQuery('header', 'all')).toEqual({ mode: 'all', prefix: '', term: 'header' });
    expect(parseSearchQuery('', 'files')).toEqual({ mode: 'files', prefix: '', term: '' });
  });
});

describe('searchSessions', () => {
  const needs = session({ sessionId: 'a', label: 'Needs you', activity: 'needs-input', activitySince: 5 });
  const working = session({ sessionId: 'b', label: 'Busy one', activity: 'working' });
  const idle = session({ sessionId: 'c', label: 'Quiet' });
  const gone = session({ sessionId: 'd', label: 'Old header work', status: 'exited' });

  it('with no term lists live sessions only, most urgent first', () => {
    expect(searchSessions([idle, gone, working, needs], '').map((h) => h.session.sessionId)).toEqual(['a', 'b', 'c']);
  });

  it('with a term matches labels case-insensitively, including exited sessions', () => {
    expect(searchSessions([needs, gone], 'HEADER').map((h) => h.session.sessionId)).toEqual(['d']);
  });

  it('caps the result', () => {
    expect(searchSessions([needs, working, idle], '', 2)).toHaveLength(2);
  });
});

describe('searchCustomizations', () => {
  const list = [entity('deploy-helper', 'ships things'), entity('review', 'checks deploy plans')];

  it('matches name or description, name matches first', () => {
    expect(searchCustomizations(list, 'deploy').map((e) => e.name)).toEqual(['deploy-helper', 'review']);
  });

  it('never dumps the whole list for an empty term', () => {
    expect(searchCustomizations(list, '  ')).toEqual([]);
  });
});
