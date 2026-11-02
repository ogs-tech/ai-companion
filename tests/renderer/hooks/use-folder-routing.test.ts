import { describe, it, expect } from 'vitest';
import { folderRoutingFor } from '../../../src/renderer/hooks/use-folder-routing.js';

const WS = { id: 'w', name: 'W', rootPath: '/r/web', createdAt: '' };

describe('folderRoutingFor', () => {
  it('leaves paths untouched in a single-folder workspace', () => {
    const r = folderRoutingFor(WS);
    expect(r.multi).toBe(false);
    expect(r.split('src/a.ts')).toEqual({ folder: undefined, rel: 'src/a.ts' });
    expect(r.join('/r/web', 'src/a.ts')).toBe('src/a.ts');
  });

  it('routes by the alias in a multi-folder workspace, both ways', () => {
    const r = folderRoutingFor({ ...WS, extraFolders: ['/r/api'] });
    expect(r.multi).toBe(true);
    expect(r.split('api/src/a.ts')).toEqual({ folder: '/r/api', rel: 'src/a.ts' });
    expect(r.split('web')).toEqual({ folder: '/r/web', rel: '' });
    expect(r.join('/r/api', 'src/a.ts')).toBe('api/src/a.ts');
    expect(r.join('/r/api', '')).toBe('api');
  });

  it('does not route an unknown alias', () => {
    expect(folderRoutingFor({ ...WS, extraFolders: ['/r/api'] }).split('nope/x').folder).toBeUndefined();
  });

  it('is inert without a workspace', () => {
    expect(folderRoutingFor(null).multi).toBe(false);
  });
});
