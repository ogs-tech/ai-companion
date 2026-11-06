// Remembers the files opened most recently, so quick open can offer them first.
// Per viewer (localStorage); a path from another workspace simply never shows
// because the palette only lists files that exist in the open one.

const STORAGE_KEY = 'ai-companion.quickOpen.recent';
const MAX_RECENT = 30;

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function getRecentFiles(): string[] {
  return read();
}

export function noteRecentFile(relPath: string): void {
  const next = [relPath, ...read().filter((p) => p !== relPath)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: quick open just loses its recents.
  }
}
