import { describe, expect, it } from 'vitest';
import { buildCommitPrompt } from '../../../../../src/main/application/services/git/commit-prompt.js';

const base = { stat: ' a.ts | 2 +-', diff: 'diff --git a/a.ts b/a.ts', diffTruncated: false };

describe('buildCommitPrompt', () => {
  it('states the output contract and includes stat and diff', () => {
    const prompt = buildCommitPrompt({ ...base, convention: { kind: 'default' } });
    expect(prompt).toContain('Output ONLY the commit message');
    expect(prompt).toContain('a.ts | 2 +-');
    expect(prompt).toContain('diff --git a/a.ts');
    expect(prompt).toContain('Conventional Commits');
  });

  it('adds a truncation note only when the diff was cut', () => {
    expect(buildCommitPrompt({ ...base, convention: { kind: 'default' } })).not.toContain('diff truncated');
    expect(buildCommitPrompt({ ...base, diffTruncated: true, convention: { kind: 'default' } })).toContain('diff truncated');
  });

  it('renders guidance and config instead of the default rules', () => {
    const prompt = buildCommitPrompt({ ...base, convention: { kind: 'default', guidance: 'G-TEXT', config: 'C-TEXT' } });
    expect(prompt).toContain('G-TEXT');
    expect(prompt).toContain('C-TEXT');
    expect(prompt).not.toContain('optional body explaining why');
  });

  it('renders examples as a style to match', () => {
    const prompt = buildCommitPrompt({ ...base, convention: { kind: 'examples', examples: ['Fix bug', 'Add thing'] } });
    expect(prompt).toContain('- Fix bug');
    expect(prompt).toContain('- Add thing');
  });
});
