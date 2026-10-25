export interface CommitConvention {
  /** Markdown excerpts that talk about commits (CONTRIBUTING, AGENTS, CLAUDE…). */
  guidance?: string;
  /** Formal config (commitlint, commit template), as written. */
  config?: string;
  kind: 'conventional' | 'examples' | 'default';
  /** Recent subjects to imitate — only when `kind === 'examples'`. */
  examples?: string[];
}

export interface ConventionFile {
  path: string;
  content: string;
}

export interface ConventionInputs {
  /** Markdown candidates in precedence order; only commit-related sections are kept. */
  markdown: ConventionFile[];
  /** Formal config files and the commit template, in precedence order. */
  config: ConventionFile[];
  /** Newest first; `[]` on an unborn branch. */
  subjects: string[];
}

export const GUIDANCE_MAX_CHARS = 3_000;
export const CONFIG_MAX_CHARS = 2_000;
export const CONVENTIONAL_RATIO = 0.6;
const HISTORY_WINDOW = 30;
const EXAMPLE_COUNT = 10;
const CONVENTIONAL_SUBJECT = /^\w+(\([^)]+\))?!?: .+/;

/**
 * Picks the commit convention a prompt should enforce. Markdown guidance and
 * formal config add up; the history-based kinds only apply when neither was
 * found. Pure — callers read the inputs.
 */
export function detectCommitConvention(inputs: ConventionInputs): CommitConvention {
  const guidance = collectGuidance(inputs.markdown);
  const config = collectConfig(inputs.config);
  const found = {
    ...(guidance !== undefined ? { guidance } : {}),
    ...(config !== undefined ? { config } : {}),
  };

  const recent = inputs.subjects.slice(0, HISTORY_WINDOW);
  const conventional = recent.filter((s) => CONVENTIONAL_SUBJECT.test(s)).length;
  if (recent.length > 0 && conventional / recent.length >= CONVENTIONAL_RATIO) {
    return { ...found, kind: 'conventional' };
  }
  const hasExplicitSource = guidance !== undefined || config !== undefined;
  if (hasExplicitSource || recent.length === 0) return { ...found, kind: 'default' };
  return { kind: 'examples', examples: recent.slice(0, EXAMPLE_COUNT) };
}

/**
 * Sections (heading + body up to the next heading of the same or higher
 * level) whose heading or body mentions "commit". Per-file text is truncated,
 * in file order, once the shared budget runs out.
 */
function collectGuidance(files: ConventionFile[]): string | undefined {
  let budget = GUIDANCE_MAX_CHARS;
  const parts: string[] = [];
  for (const file of files) {
    if (budget <= 0) break;
    const sections = extractCommitSections(file.content);
    if (sections.length === 0) continue;
    const text = `From ${file.path}:\n${sections.join('\n\n')}`.slice(0, budget);
    parts.push(text);
    budget -= text.length;
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export function extractCommitSections(markdown: string): string[] {
  const lines = markdown.split('\n');
  const sections: string[][] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = (): void => {
    if (current.length > 0) sections.push(current);
    current = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^#{1,6}\s/.test(line)) flush();
    current.push(line);
  }
  flush();
  return sections
    .map((s) => s.join('\n').trim())
    .filter((s) => /commit/i.test(s));
}

function collectConfig(files: ConventionFile[]): string | undefined {
  if (files.length === 0) return undefined;
  const text = files.map((f) => `${f.path}:\n${f.content.trim()}`).join('\n\n');
  return text.slice(0, CONFIG_MAX_CHARS);
}
