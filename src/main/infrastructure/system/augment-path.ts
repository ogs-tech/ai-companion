/**
 * Where Homebrew (Apple silicon, then Intel) installs CLIs such as `git` and
 * `claude`. A packaged macOS app launched from Finder or the Dock inherits
 * launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), which has none of
 * them — `/usr/bin/git` is only the Xcode CLT shim.
 */
const MAC_EXTRA_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

/**
 * Appends the usual user bin dirs missing from `current` on macOS. Appended,
 * not prepended, so a PATH inherited from a terminal (`npm run dev`) keeps its
 * own precedence. Other platforms are returned unchanged.
 */
export function augmentPath(
  current: string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== 'darwin') return current;
  const entries = (current ?? '').split(':').filter((e) => e.length > 0);
  const missing = MAC_EXTRA_BIN_DIRS.filter((dir) => !entries.includes(dir));
  return [...entries, ...missing].join(':');
}
