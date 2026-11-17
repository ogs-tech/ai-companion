import { parse, stringify } from 'yaml';

const DELIMITER = '---';

export interface FrontmatterDocument<T = Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

/**
 * Strict YAML first; when that fails, a line-based read of the top-level `key: value` pairs. Claude Code
 * reads plugin and skill frontmatter leniently (`description: Use when: x`, `argument-hint: [a] [b]` are
 * not valid YAML), so a file that works there must not vanish here. Values stay plain strings.
 */
function parseFrontmatterText(fmText: string): Record<string, unknown> {
  try {
    return (parse(fmText) ?? {}) as Record<string, unknown>;
  } catch (err) {
    const lenient = parseLenient(fmText);
    // A flow collection that never closes (`tools: [a, b`) is a real mistake, not Claude-style looseness.
    if (Object.keys(lenient).length === 0 || Object.values(lenient).some(hasUnbalancedBrackets)) throw err;
    return lenient;
  }
}

function hasUnbalancedBrackets(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const count = (ch: string): number => value.split(ch).length - 1;
  return count('[') !== count(']') || count('{') !== count('}');
}

function parseLenient(fmText: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let current: string | null = null;
  for (const line of fmText.split('\n')) {
    const pair = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (pair !== null) {
      current = pair[1] as string;
      out[current] = unquote((pair[2] as string).trim());
    } else if (current !== null && line.trim() !== '') {
      out[current] = `${String(out[current])} ${line.trim()}`.trim();
    }
  }
  return out;
}

function unquote(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted !== null ? (quoted[2] as string) : value;
}

export function parseMarkdown<T = Record<string, unknown>>(
  raw: string,
): FrontmatterDocument<T> {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== DELIMITER) {
    return { frontmatter: {} as T, body: raw };
  }
  const closingIndex = lines.findIndex((line, idx) => idx > 0 && line === DELIMITER);
  if (closingIndex === -1) {
    return { frontmatter: {} as T, body: raw };
  }
  const fmText = lines.slice(1, closingIndex).join('\n');
  const body = lines.slice(closingIndex + 1).join('\n').replace(/^\n/, '');
  return { frontmatter: parseFrontmatterText(fmText) as T, body };
}

export function serializeMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const fmText = stringify(frontmatter).trimEnd();
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  return `${DELIMITER}\n${fmText}\n${DELIMITER}\n${normalizedBody}`;
}
