import { describe, it, expect } from 'vitest';
import { folderAliases, workspaceFolders } from '../../src/shared/workspace.js';

describe('workspace folders', () => {
  it('lists the primary folder first, then the added ones', () => {
    expect(workspaceFolders({ rootPath: '/a' })).toEqual(['/a']);
    expect(workspaceFolders({ rootPath: '/a', extraFolders: ['/b', '/c'] })).toEqual(['/a', '/b', '/c']);
  });

  it('aliases folders by basename, made unique in order', () => {
    expect(folderAliases({ rootPath: '/x/app', extraFolders: ['/y/app', '/z/api', '/w/app/'] })).toEqual({
      '/x/app': 'app',
      '/y/app': 'app-2',
      '/z/api': 'api',
      '/w/app/': 'app-3',
    });
  });
});
