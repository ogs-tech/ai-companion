import { QueryClient, focusManager } from '@tanstack/react-query';

/**
 * Drives react-query's focus tracking from the events an Electron renderer
 * actually gets.
 *
 * React Query v5's built-in setup listens to `visibilitychange` alone, and a
 * BrowserWindow never fires it when the user simply switches to another
 * application — the window stays on screen, so `document.visibilityState`
 * stays `'visible'` and `refetchOnWindowFocus` would silently never fire.
 * Chromium does fire the DOM `focus`/`blur` events on the renderer's window
 * for that case, so those carry the app-switch signal; `visibilitychange` is
 * kept for the minimize/restore path it does cover.
 */
export function electronFocusSetup(onFocusChange: (focused: boolean) => void): () => void {
  const handleFocus = (): void => onFocusChange(true);
  const handleBlur = (): void => onFocusChange(false);
  const handleVisibilityChange = (): void =>
    onFocusChange(document.visibilityState === 'visible');

  window.addEventListener('focus', handleFocus);
  window.addEventListener('blur', handleBlur);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

focusManager.setEventListener(electronFocusSetup);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
