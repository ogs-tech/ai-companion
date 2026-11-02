import { describe, it, expect } from 'vitest';
import { basename, folderColor, FOLDER_PALETTE, SHARED_COLOR } from '../../../src/renderer/lib/folder-identity.js';

describe('folder identity', () => {
  it('names a folder by its last segment', () => {
    expect(basename('/repos/acme')).toBe('acme');
    expect(basename('/repos/acme/')).toBe('acme');
  });

  it('colours the shared set neutrally and folders by position', () => {
    const folders = ['/a', '/b'];
    expect(folderColor(folders, undefined)).toBe(SHARED_COLOR);
    expect(folderColor(folders, '/a')).toBe(FOLDER_PALETTE[0]);
    expect(folderColor(folders, '/b')).toBe(FOLDER_PALETTE[1]);
  });

  it('wraps around the palette', () => {
    const many = Array.from({ length: FOLDER_PALETTE.length + 1 }, (_, i) => `/f${i}`);
    expect(folderColor(many, many[many.length - 1])).toBe(FOLDER_PALETTE[0]);
  });
});
