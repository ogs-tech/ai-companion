import { vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { IpcErrorKind, IpcResult } from '../../src/shared/ipc-contract.js';
import { ThemeModeProvider } from '../../src/renderer/lib/theme-mode-context.js';
import { createAppTheme } from '../../src/renderer/theme.js';

export type CallSpy = ReturnType<typeof vi.fn>;

export function mockApi(): CallSpy {
  const call = vi.fn();
  const onInstructionGenerateProgress = vi.fn(() => () => {});
  const session = {
    onOutput: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    onAnyExit: vi.fn(() => () => {}),
  };
  Object.defineProperty(window, 'api', {
    value: { call, onInstructionGenerateProgress, session },
    writable: true,
    configurable: true,
  });
  return call;
}

export const ok = <T,>(data: T): IpcResult<T> => ({ ok: true, data });
export const fail = (kind: IpcErrorKind, message: string): IpcResult<never> => ({
  ok: false,
  error: { kind, message },
});

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithQuery(
  ui: ReactElement,
  options?: RenderOptions & { client?: QueryClient },
) {
  const { client: providedClient, ...rest } = options ?? {};
  const client = providedClient ?? makeTestQueryClient();
  return {
    client,
    ...render(ui, {
      ...rest,
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ThemeProvider theme={createAppTheme('light')}>{children}</ThemeProvider>
        </QueryClientProvider>
      ),
    }),
  };
}

/** Renders inside the static OGS ThemeProvider only — for pure component tests that access theme.ogs but need no QueryClient. */
export function renderWithTheme(ui: ReactElement, options?: RenderOptions) {
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <ThemeProvider theme={createAppTheme('light')}>{children}</ThemeProvider>
    ),
  });
}

/** Renders inside ThemeModeProvider + QueryClientProvider — for shell/screen tests. */
export function renderWithShell(
  ui: ReactElement,
  options?: RenderOptions & { client?: QueryClient },
) {
  const { client: providedClient, ...rest } = options ?? {};
  const client = providedClient ?? makeTestQueryClient();
  return {
    client,
    ...render(ui, {
      ...rest,
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ThemeModeProvider>{children}</ThemeModeProvider>
        </QueryClientProvider>
      ),
    }),
  };
}
