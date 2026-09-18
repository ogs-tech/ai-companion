import { describe, it, expect } from 'vitest';
import {
  categoryFor,
  curatedRank,
  preferenceKeyFor,
} from '../../../../src/main/application/open-with/catalog.js';

describe('categoryFor', () => {
  it('classifies a directory as dir regardless of its name', () => {
    expect(categoryFor('/repos/acme/src.backup', 'dir')).toBe('dir');
  });

  it('classifies source files as code', () => {
    expect(categoryFor('/repos/acme/src/index.ts', 'file')).toBe('code');
  });

  it('classifies markdown separately from other text', () => {
    expect(categoryFor('/repos/acme/README.md', 'file')).toBe('markdown');
  });

  it('classifies spreadsheets', () => {
    expect(categoryFor('/repos/acme/budget.xlsx', 'file')).toBe('spreadsheet');
  });

  it('ignores extension casing', () => {
    expect(categoryFor('/repos/acme/PHOTO.PNG', 'file')).toBe('image');
  });

  it('falls back to other for an unknown extension', () => {
    expect(categoryFor('/repos/acme/archive.qqq', 'file')).toBe('other');
  });

  it('falls back to other for a file with no extension', () => {
    expect(categoryFor('/repos/acme/LICENSE', 'file')).toBe('other');
  });

  it('does not treat a dotfile name as an extension', () => {
    expect(categoryFor('/repos/acme/.gitignore', 'file')).toBe('other');
  });
});

describe('preferenceKeyFor', () => {
  it('keys directories under a single shared key', () => {
    expect(preferenceKeyFor('/repos/acme/src', 'dir')).toBe('dir');
  });

  it('keys files by lowercased extension', () => {
    expect(preferenceKeyFor('/repos/acme/Notes.MD', 'file')).toBe('.md');
  });

  it('keys extensionless files under a single shared key', () => {
    expect(preferenceKeyFor('/repos/acme/LICENSE', 'file')).toBe('file');
  });
});

describe('curatedRank', () => {
  it('ranks a curated editor for code', () => {
    expect(curatedRank('com.microsoft.VSCode', 'code')).toBeTypeOf('number');
  });

  it('ranks Finder first for directories', () => {
    const finder = curatedRank('com.apple.finder', 'dir');
    const vscode = curatedRank('com.microsoft.VSCode', 'dir');
    expect(finder).toBeTypeOf('number');
    expect(vscode).toBeTypeOf('number');
    expect(finder as number).toBeLessThan(vscode as number);
  });

  it('leaves an app the catalog never mentions unranked', () => {
    expect(curatedRank('com.example.Unknown', 'code')).toBeUndefined();
  });

  it('leaves a curated app unranked for a category it does not handle', () => {
    expect(curatedRank('com.apple.QuickTimePlayerX', 'dir')).toBeUndefined();
  });
});
