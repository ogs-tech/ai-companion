import { describe, it, expect } from 'vitest';
import { restoreTabs, toPersisted, type OpenTab } from '../../../../src/renderer/screens/workspace/open-tabs.js';

describe('file tabs: pinned and external', () => {
  it('persists the pinned flag only when set, and never an external tab', () => {
    const tabs: OpenTab[] = [
      { id: 'file:a.ts', kind: 'file', relPath: 'a.ts', pinned: true },
      { id: 'file:b.ts', kind: 'file', relPath: 'b.ts' },
      { id: 'ext:/tmp/c.ts', kind: 'file', relPath: '/tmp/c.ts', external: true },
    ];
    expect(toPersisted(tabs)).toEqual([
      { id: 'file:a.ts', kind: 'file', relPath: 'a.ts', pinned: true },
      { id: 'file:b.ts', kind: 'file', relPath: 'b.ts' },
    ]);
  });

  it('restores the pinned flag and keeps a retargeted tab id', async () => {
    const restored = await restoreTabs([{ id: 'file:old.ts', kind: 'file', relPath: 'new.ts', pinned: true }], {
      entitiesByUrn: new Map(),
      terminalIds: new Set(),
      sessionIds: new Set(),
      fileExists: async () => true,
    });
    expect(restored).toEqual([{ id: 'file:old.ts', kind: 'file', relPath: 'new.ts', pinned: true }]);
  });
});
