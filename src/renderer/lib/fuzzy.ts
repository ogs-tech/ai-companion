export interface FuzzyMatch {
  score: number;
  /** Indices of `target` that matched, ascending — what the UI highlights. */
  indices: number[];
}

const SEPARATORS = new Set(['/', '.', '-', '_', ' ']);

/**
 * Subsequence match of `query` against a file path, case-insensitive. Higher
 * is better: runs of consecutive characters, matches that start a word or the
 * file name, and matches inside the base name outrank scattered ones. Returns
 * `null` when the query is not a subsequence of the path. Greedy left-to-right
 * with a base-name-first retry — fast enough for tens of thousands of paths
 * without a dependency.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query === '') return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const baseStart = target.lastIndexOf('/') + 1;

  const attempt = (from: number): FuzzyMatch | null => {
    const indices: number[] = [];
    let score = 0;
    let ti = from;
    let previous = -2;
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found === -1) return null;
      indices.push(found);
      if (found === previous + 1) score += 8;
      if (found === 0 || SEPARATORS.has(target[found - 1] ?? '')) score += 6;
      if (found >= baseStart) score += 3;
      score -= Math.min(found - ti, 3);
      previous = found;
      ti = found + 1;
    }
    // Shorter paths and earlier matches win ties.
    score -= target.length * 0.05;
    return { score, indices };
  };

  const inBase = baseStart > 0 ? attempt(baseStart) : null;
  const whole = attempt(0);
  if (inBase && (!whole || inBase.score + 10 >= whole.score)) return { ...inBase, score: inBase.score + 10 };
  return whole;
}

/** The best `limit` matches, best first. */
export function fuzzyFilter<T>(query: string, items: readonly T[], pathOf: (item: T) => string, limit = 50): Array<{ item: T; match: FuzzyMatch }> {
  const scored: Array<{ item: T; match: FuzzyMatch }> = [];
  for (const item of items) {
    const match = fuzzyMatch(query, pathOf(item));
    if (match) scored.push({ item, match });
  }
  return scored.sort((a, b) => b.match.score - a.match.score).slice(0, limit);
}
