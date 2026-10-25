import { defineConfig } from '@playwright/test';

// Docs screenshots only — run with `npm run docs:screenshots`. Kept out of `e2e/` so `test:e2e` never
// regenerates committed images. Needs the dev app closed: both bind CDP port 9333 (src/main/index.ts).
export default defineConfig({
  testDir: '.',
  testMatch: /capture\.spec\.ts/,
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
});
