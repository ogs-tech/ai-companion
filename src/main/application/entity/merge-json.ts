import { createHash } from 'node:crypto';

/** JSON.stringify with sorted keys, so equal values hash equal regardless of key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashValue(value: unknown): string {
  return createHash('sha1').update(stableStringify(value)).digest('hex');
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Reads `a.b.0.c`-style paths; numeric segments index arrays. */
export function getByPath(root: unknown, dotted: string): unknown {
  let cur: unknown = root;
  for (const seg of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function matchesIdentity(item: unknown, identity: Record<string, unknown>): boolean {
  return Object.entries(identity).every(([path, expected]) => deepEqual(getByPath(item, path), expected));
}

export interface JsonLayout {
  indent: string | number;
  trailingNewline: boolean;
}

/** Infers the indent and trailing newline of an existing file so a re-serialize keeps its look. */
export function detectLayout(raw: string): JsonLayout {
  const match = /^([ \t]+)\S/m.exec(raw);
  const indent = match?.[1];
  return {
    indent: indent === undefined ? 2 : indent.includes('\t') ? '\t' : indent.length,
    trailingNewline: raw.endsWith('\n'),
  };
}

export function renderJson(value: unknown, layout: JsonLayout): string {
  const body = JSON.stringify(value, null, layout.indent);
  return layout.trailingNewline ? `${body}\n` : body;
}
