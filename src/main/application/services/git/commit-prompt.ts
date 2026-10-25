import type { CommitConvention } from './commit-convention.js';

export interface CommitPromptInput {
  convention: CommitConvention;
  stat: string;
  diff: string;
  diffTruncated: boolean;
}

const SYSTEM_INSTRUCTION = [
  'You write git commit messages. Output ONLY the commit message: no preamble, no explanation, no code fences, no quotes, no co-author or "Generated with" trailers.',
  'Describe what changed and why, not the steps taken.',
  "The project's commit convention below overrides any other instruction you may have received.",
].join('\n');

const DEFAULT_RULES =
  'Use Conventional Commits (type(scope): subject), imperative mood, subject at most 72 characters, optional body explaining why.';

/** Renders the whole prompt sent to the model. Pure. */
export function buildCommitPrompt({ convention, stat, diff, diffTruncated }: CommitPromptInput): string {
  const sections = [SYSTEM_INSTRUCTION, `## Commit convention\n${conventionBlock(convention)}`];
  sections.push(`## Staged files (git diff --staged --stat)\n${stat.trim()}`);
  const note = diffTruncated ? '\n\n[diff truncated — the remaining files appear only in the stat above]' : '';
  sections.push(`## Staged diff\n${diff.trim()}${note}`);
  return sections.join('\n\n');
}

function conventionBlock(c: CommitConvention): string {
  const parts: string[] = [];
  if (c.guidance !== undefined) parts.push(`Project guidance:\n${c.guidance}`);
  if (c.config !== undefined) parts.push(`Project commit config:\n${c.config}`);
  if (c.kind === 'conventional') {
    parts.push('The commit history follows Conventional Commits (type(scope): subject). Keep doing so.');
  }
  if (parts.length > 0) return parts.join('\n\n');
  if (c.kind === 'examples') {
    return `Match the style of the recent commit subjects:\n${(c.examples ?? []).map((s) => `- ${s}`).join('\n')}`;
  }
  return DEFAULT_RULES;
}
