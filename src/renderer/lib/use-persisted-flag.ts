import { useCallback, useState } from 'react';

function read(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

/**
 * A boolean kept in `localStorage` under `key`, falling back to `fallback`
 * when nothing is stored or storage is unavailable. Used to remember which
 * tree groups the user left open.
 */
export function usePersistedFlag(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback));
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Storage unavailable — the choice just lasts for this session.
      }
    },
    [key],
  );
  return [value, set];
}
