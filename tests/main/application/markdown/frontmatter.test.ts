import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../../../src/main/application/markdown/frontmatter.js';

describe('parseMarkdown lenient fallback', () => {
  it('keeps strict YAML results untouched', () => {
    const { frontmatter } = parseMarkdown('---\nname: a\ntools: [x, y]\n---\nbody');
    expect(frontmatter).toEqual({ name: 'a', tools: ['x', 'y'] });
  });

  it('reads an unquoted value containing ": " (invalid YAML, valid for Claude Code)', () => {
    const { frontmatter, body } = parseMarkdown('---\nname: hunter\ndescription: Use this agent when: reviewing a PR\n---\nBody');
    expect(frontmatter).toEqual({ name: 'hunter', description: 'Use this agent when: reviewing a PR' });
    expect(body).toBe('Body');
  });

  it('reads a bracketed hint as plain text', () => {
    const { frontmatter } = parseMarkdown('---\nargument-hint: [system] [--source <path>]\n---\nx');
    expect(frontmatter).toEqual({ 'argument-hint': '[system] [--source <path>]' });
  });

  it('joins continuation lines and unquotes simple values', () => {
    const { frontmatter } = parseMarkdown('---\ndescription: first: part\n  second part\ndisable-model-invocation: true\nname: "q"\n---\n');
    expect(frontmatter).toEqual({ description: 'first: part second part', 'disable-model-invocation': true, name: 'q' });
  });

  it('still throws on a flow list that never closes', () => {
    expect(() => parseMarkdown('---\nname: a\ntools: [x, y\n---\n')).toThrow();
  });

  it('still throws when nothing can be read', () => {
    expect(() => parseMarkdown('---\n: : [\n---\n')).toThrow();
  });
});
