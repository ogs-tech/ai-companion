import { describe, it, expect } from 'vitest';
import { languageForPath } from '../../../src/renderer/lib/code-language.js';

describe('languageForPath', () => {
  it.each([
    ['README.md', 'markdown'],
    ['notes.markdown', 'markdown'],
    ['doc.mdx', 'markdown'],
    ['index.js', 'javascript'],
    ['App.tsx', 'javascript'],
    ['config.json', 'json'],
    ['styles.css', 'css'],
    ['page.html', 'html'],
    ['page.htm', 'html'],
  ] as const)('maps %s to %s', (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it('is case-insensitive on the extension', () => {
    expect(languageForPath('README.MD')).toBe('markdown');
  });

  it('falls back to plain for an unknown or missing extension', () => {
    expect(languageForPath('Makefile')).toBe('plain');
    expect(languageForPath('archive.tar.gz')).toBe('plain');
  });

  it('handles a nested relative path', () => {
    expect(languageForPath('src/main/index.ts')).toBe('javascript');
  });
});
