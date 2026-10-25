import { describe, expect, it } from 'vitest';
import { restoreTabs, toPersisted, type OpenTab, type RestoreContext } from '../../../../src/renderer/screens/workspace/open-tabs.js';
import type { Skill } from '../../../../src/shared/entity.js';

const skill = { urn: 'urn:skill:x', name: 'x', content: 'fresh from disk' } as unknown as Skill;

const ctx = (over: Partial<RestoreContext> = {}): RestoreContext => ({
  entitiesByUrn: new Map([[skill.urn, skill]]),
  terminalIds: new Set(['t1']),
  sessionIds: new Set(['s1']),
  fileExists: async (p) => p !== 'gone.ts',
  ...over,
});

describe('toPersisted', () => {
  it('keeps references, and skips tabs that cannot be rebuilt from one', () => {
    const tabs: OpenTab[] = [
      { id: 'file:a.ts', kind: 'file', relPath: 'a.ts', dirty: true },
      { id: 'entity-new:skill:1', kind: 'skill', entity: skill, isCreate: true },
      { id: 'entity:urn:skill:x', kind: 'skill', entity: skill, isCreate: false },
      { id: 'preview:entity:urn', kind: 'preview', label: 'x', source: { kind: 'entity', body: 'b' } },
      { id: 'preview:file:a.md', kind: 'preview', label: 'a.md', source: { kind: 'file', path: 'a.md' } },
      { id: 'browser:1', kind: 'browser', tabId: '1' },
      { id: 'diagnostico', kind: 'diagnostico' },
    ];
    expect(toPersisted(tabs).map((t) => t.id)).toEqual(['file:a.ts', 'entity:urn:skill:x', 'preview:file:a.md', 'diagnostico']);
  });
});

describe('restoreTabs', () => {
  it('drops tabs whose file, entity, terminal or session no longer exists, keeping order', async () => {
    const restored = await restoreTabs(
      [
        { id: 'file:gone.ts', kind: 'file', relPath: 'gone.ts' },
        { id: 'file:a.ts', kind: 'file', relPath: 'a.ts' },
        { id: 'entity:urn:skill:y', kind: 'entity', entityKind: 'skill', urn: 'urn:skill:y', inherited: false },
        { id: 'terminal:t2', kind: 'terminal', terminalId: 't2' },
        { id: 'session:s2', kind: 'session', anchor: { kind: 'personal' }, sessionId: 's2', label: 'l' },
        { id: 'terminal:t1', kind: 'terminal', terminalId: 't1' },
        { id: 'session:s1', kind: 'session', anchor: { kind: 'personal' }, sessionId: 's1', label: 'l' },
      ],
      ctx(),
    );
    expect(restored.map((t) => t.id)).toEqual(['file:a.ts', 'terminal:t1', 'session:s1']);
  });

  it('rebuilds an entity tab with the entity as it is on disk now', async () => {
    const [tab] = await restoreTabs([{ id: 'inherited:urn:skill:x', kind: 'entity', entityKind: 'skill', urn: skill.urn, inherited: true }], ctx());
    expect(tab).toMatchObject({ kind: 'skill', entity: skill, isCreate: false, inherited: true });
  });
});
