import { describe, expect, it } from 'vitest';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { OpenEditorsService, OPEN_EDITORS_FILE } from '../../../../src/main/application/services/open-editors-service.js';

const DIR = '/ws/.ai-companion';

function setup() {
  const fs = new InMemoryFileSystem();
  return { fs, service: new OpenEditorsService(fs, DIR) };
}

describe('OpenEditorsService', () => {
  it('loads an empty state when nothing was saved', async () => {
    const { service } = setup();
    expect(await service.load()).toEqual({ tabs: [], activeTabId: null });
  });

  it('round-trips the tabs, their order and the active tab', async () => {
    const { service } = setup();
    const state = {
      tabs: [
        { id: 'file:a.ts', kind: 'file', relPath: 'a.ts' },
        { id: 'entity:urn:skill:x', kind: 'entity', entityKind: 'skill', urn: 'urn:skill:x', inherited: false },
        { id: 'terminal:t1', kind: 'terminal', terminalId: 't1' },
        { id: 'git-diff:index:a.ts', kind: 'git-diff', path: 'a.ts', source: { kind: 'index' } },
        { id: 'history', kind: 'history' },
        { id: 'diagnostico', kind: 'area', area: 'diagnostico' },
      ],
      activeTabId: 'file:a.ts',
    };
    await service.save(state);
    expect(await service.load()).toEqual(state);
  });

  it('drops malformed and duplicate tabs instead of failing', async () => {
    const { service } = setup();
    await service.save({
      tabs: [
        { id: 'file:a.ts', kind: 'file', relPath: 'a.ts' },
        { id: 'file:a.ts', kind: 'file', relPath: 'a.ts' },
        { id: 'x', kind: 'unknown' },
        { id: 'file:b', kind: 'file' },
        { kind: 'history' },
        'nope',
      ],
      activeTabId: 42,
    });
    expect(await service.load()).toEqual({ tabs: [{ id: 'file:a.ts', kind: 'file', relPath: 'a.ts' }], activeTabId: null });
  });

  it('treats a corrupt file as nothing open', async () => {
    const { fs, service } = setup();
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(`${DIR}/${OPEN_EDITORS_FILE}`, '{not json');
    expect(await service.load()).toEqual({ tabs: [], activeTabId: null });
  });
});
