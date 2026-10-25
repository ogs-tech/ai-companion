import { describe, expect, it } from 'vitest';
import {
  CONFIG_MAX_CHARS,
  GUIDANCE_MAX_CHARS,
  detectCommitConvention,
  extractCommitSections,
} from '../../../../../src/main/application/services/git/commit-convention.js';

const conventional = (n: number): string[] => Array.from({ length: n }, (_, i) => `feat(x): thing ${i}`);
const free = (n: number): string[] => Array.from({ length: n }, (_, i) => `Did thing ${i}`);
const none = { markdown: [], config: [] };

describe('detectCommitConvention', () => {
  it('uses markdown guidance, keeping only commit-related sections', () => {
    const content = '# Setup\nrun npm i\n\n## Commit messages\nUse imperative mood.\n\n## Release\nTag it.';
    const result = detectCommitConvention({ markdown: [{ path: 'CONTRIBUTING.md', content }], config: [], subjects: [] });
    expect(result.guidance).toContain('Use imperative mood.');
    expect(result.guidance).not.toContain('run npm i');
    expect(result.guidance).not.toContain('Tag it.');
  });

  it('keeps a section whose body (not heading) mentions commit', () => {
    expect(extractCommitSections('# Flow\nPlease commit small.\n\n# Other\nnothing')).toEqual(['# Flow\nPlease commit small.']);
  });

  it('ignores headings inside code fences', () => {
    const md = '# A\n```\n# not a heading\n```\ncommit here';
    expect(extractCommitSections(md)).toHaveLength(1);
  });

  it('skips files with no commit section', () => {
    const result = detectCommitConvention({ markdown: [{ path: 'AGENTS.md', content: '# Style\ntabs' }], config: [], subjects: [] });
    expect(result.guidance).toBeUndefined();
  });

  it('caps guidance and truncates later files first', () => {
    const big = (name: string): { path: string; content: string } => ({ path: name, content: `# Commit\n${'x'.repeat(5_000)}` });
    const result = detectCommitConvention({ markdown: [big('A.md'), big('B.md')], config: [], subjects: [] });
    expect(result.guidance!.length).toBeLessThanOrEqual(GUIDANCE_MAX_CHARS);
    expect(result.guidance).toContain('From A.md');
    expect(result.guidance).not.toContain('From B.md');
  });

  it('passes formal config as-is, capped, and adds it to guidance', () => {
    const result = detectCommitConvention({
      markdown: [{ path: 'CLAUDE.md', content: '## Commits\nkeep short' }],
      config: [{ path: 'commitlint.config.js', content: 'y'.repeat(5_000) }],
      subjects: [],
    });
    expect(result.guidance).toContain('keep short');
    expect(result.config!.length).toBe(CONFIG_MAX_CHARS);
  });

  it('flags conventional history at exactly 60%', () => {
    expect(detectCommitConvention({ ...none, subjects: [...conventional(18), ...free(12)] }).kind).toBe('conventional');
  });

  it('does not flag conventional history just under 60% (17 of 30)', () => {
    const subjects = [...conventional(17), ...free(13)];
    expect(detectCommitConvention({ ...none, subjects }).kind).toBe('examples');
  });

  it('only looks at the newest 30 subjects', () => {
    const subjects = [...free(30), ...conventional(100)];
    expect(detectCommitConvention({ ...none, subjects }).kind).toBe('examples');
  });

  it('passes the newest 10 subjects as examples for free-form history', () => {
    const result = detectCommitConvention({ ...none, subjects: free(30) });
    expect(result.examples).toEqual(free(10));
  });

  it('adds the conventional history signal on top of explicit sources', () => {
    const result = detectCommitConvention({
      markdown: [{ path: 'CLAUDE.md', content: '## Commits\nx' }],
      config: [],
      subjects: conventional(5),
    });
    expect(result.kind).toBe('conventional');
    expect(result.guidance).toBeDefined();
  });

  it('does not add examples when explicit sources exist', () => {
    const result = detectCommitConvention({
      markdown: [{ path: 'CLAUDE.md', content: '## Commits\nx' }],
      config: [],
      subjects: free(5),
    });
    expect(result.kind).toBe('default');
    expect(result.examples).toBeUndefined();
  });

  it('falls back to the default on an unborn branch', () => {
    expect(detectCommitConvention({ ...none, subjects: [] })).toEqual({ kind: 'default' });
  });
});
