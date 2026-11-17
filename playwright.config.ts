import { defineConfig } from '@playwright/test';

// Electron E2E only — isolated from the real ~/.claude via a temp HOME (see e2e/fixtures/app.ts).
//
// One Playwright project per product area (= one folder under e2e/). In `npm run e2e:ui` they show up as checkboxes,
// and `npm run e2e -- --project=sessions` runs a single area. `integration` covers the CLI hooks and IPC with no
// UI journey in it; untick it to see only what a user can do.
const AREAS = [
  'sessions',
  'channels',
  'workspace',
  'customizations',
  'workbench',
  'settings',
  'integration',
] as const;

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
