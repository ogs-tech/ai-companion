import { defineConfig } from '@playwright/test';

// Electron E2E only — isolated from the real ~/.claude via a temp HOME (see e2e/fixtures/app.ts).
//
// One Playwright project per area (= one folder under e2e/product/ and e2e/technical/; same area names as docs/).
// In `npm run e2e:ui` they show up as checkboxes, and `npm run e2e -- --project=sessions` runs a single area.
// Conversations started outside the app (CLI hooks, no UI journey) are tagged `@integration`; `--grep-invert @integration` skips them.
const AREAS = ['sessions', 'channels', 'workspaces', 'customizations', 'editor'] as const;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  projects: AREAS.map((area) => ({
    name: area,
    testMatch: `{product,technical}/${area}/**/*.spec.ts`,
  })),
});
