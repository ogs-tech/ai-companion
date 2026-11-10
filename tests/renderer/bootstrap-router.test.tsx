import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/renderer/App.js';
import { ThemeModeProvider } from '../../src/renderer/lib/theme-mode-context.js';
import { mockApi, ok, type CallSpy } from './test-utils.js';
import type { Settings } from '../../src/shared/settings.js';

const validSettings: Settings = {
  adapters: {
    claude: { enabled: true },
    cursor: { enabled: false }, lmstudio: { enabled: false },
  },  ui: { theme: 'system' },
  language: 'off',
};

let call: CallSpy;

beforeEach(() => {
  call = mockApi();
});

const route = (overrides: Record<string, unknown>) => {
  call.mockImplementation((method: string) => {
    if (method in overrides) return Promise.resolve(overrides[method]);
    return Promise.resolve(ok(undefined));
  });
};

describe('<App> bootstrap router', () => {
  it('renders <Main> when settings.get returns persisted settings', async () => {
    route({
      'settings.get': ok(validSettings),
      'repo.list': ok([]),
      'customization.list': ok([]),
    });
    render(
      <ThemeModeProvider>
        <App />
      </ThemeModeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('main-screen')).toBeInTheDocument(),
    );
  });

  it('renders <Main> after seeding defaults when settings.get returns null', async () => {
    route({
      'settings.get': ok(null),
      'settings.merge': ok(validSettings),
      'repo.list': ok([]),
      'customization.list': ok([]),
    });
    render(
      <ThemeModeProvider>
        <App />
      </ThemeModeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('main-screen')).toBeInTheDocument(),
    );
  });
});
