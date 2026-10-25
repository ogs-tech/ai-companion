export const DEFAULT_MAX_SCROLLBACK_CHARS = 200_000;

/** Appends `chunk` to `buf` in place, trimming from the head so the total stays within `maxChars`. */
export function appendToScrollback(buf: string[], chunk: string, maxChars: number): void {
  buf.push(chunk);
  let total = buf.reduce((n, c) => n + c.length, 0);
  while (total > maxChars) {
    const head = buf[0]!;
    const excess = total - maxChars;
    if (head.length <= excess) {
      buf.shift();
      total -= head.length;
    } else {
      buf[0] = head.slice(excess);
      total -= excess;
    }
  }
}
