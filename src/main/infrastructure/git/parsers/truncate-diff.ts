/**
 * Cuts a unified diff to at most `maxChars`, preferring to end on a file
 * boundary (`diff --git`) so no file's hunks are half-shown. When the first
 * file alone is over the budget it is cut mid-way rather than dropped.
 */
export function truncateDiff(diff: string, maxChars: number): { diff: string; truncated: boolean } {
  if (diff.length <= maxChars) return { diff, truncated: false };
  const window = diff.slice(0, maxChars);
  const boundary = window.lastIndexOf('\ndiff --git ');
  return { diff: boundary > 0 ? window.slice(0, boundary + 1) : window, truncated: true };
}
