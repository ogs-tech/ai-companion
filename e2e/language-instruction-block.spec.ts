import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A schema-valid `default` global instruction with two H2 sections and NO
// <language> block. Six non-empty body lines → the "6 lines" chip.
const SEED_GI = `---
name: default
type: global-instruction
description: Test profile for staleness repro.
scopes:
  - personal
version: 0.1.0
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
---
# Global instructions

Intro line for the test profile.

## How to work with me

- Reply concisely.

## Engineering defaults

- TDD where it fits.
`;

const SEED_SETTINGS = JSON.stringify(
  { adapters: { claude: { enabled: true } }, ui: { theme: 'system' }, language: 'off' },
  null,
  2,
);

let app: ElectronApplication;
let page: Page;
let giPath: string;

const linesOf = (text: string): string | undefined => /(\d+)\s+lines/.exec(text)?.[1];

test.beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), 'sde-e2e-'));
  const ws = join(home, '.ai-companion');
  mkdirSync(join(ws, 'global-instructions'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  giPath = join(ws, 'global-instructions', 'default.md');
  writeFileSync(giPath, SEED_GI, 'utf8');
  writeFileSync(join(ws, 'settings.json'), SEED_SETTINGS, 'utf8');

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.HOME = home;
  delete env.ELECTRON_RENDERER_URL; // force the production loadFile path

  app = await electron.launch({ args: [join(process.cwd(), 'out', 'main', 'index.js')], env });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="main-screen"]', { timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close();
});

test('language change in Settings is reflected in Global Instructions on return', async () => {
  // 1. Visit Global Instructions — this populates the react-query cache.
  await page.click('[data-testid="nav-biblioteca"]');
  await page.waitForSelector('[data-testid="nav-global-instructions"]');
  await page.click('[data-testid="nav-global-instructions"]');
  await page.waitForSelector('[data-testid="global-instruction-configured"]');
  const before = await page.locator('[data-testid="global-instruction-configured"]').innerText();
  const linesBefore = linesOf(before);
  expect(linesBefore, 'should render a line count').toBeTruthy();
  expect(readFileSync(giPath, 'utf8'), 'no block on disk yet').not.toContain('<language>');

  // 2. Settings → set language to Português (pt-BR).
  await page.click('[data-testid="nav-settings"]');
  await page.waitForSelector('[data-testid="settings-screen"]');
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Português (pt-BR)' }).click();
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveText(/Português/);

  // 3. Disk truth: setLanguage DID write the <language> block to default.md.
  await expect
    .poll(() => readFileSync(giPath, 'utf8').includes('<language>'), { timeout: 10_000 })
    .toBe(true);
  expect(readFileSync(giPath, 'utf8')).toContain('pt-BR');

  // 4. Back to Global Instructions, well within the 30s staleTime.
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.waitForSelector('[data-testid="main-screen"]');
  await page.click('[data-testid="nav-biblioteca"]');
  await page.waitForSelector('[data-testid="nav-global-instructions"]');
  await page.click('[data-testid="nav-global-instructions"]');
  await page.waitForSelector('[data-testid="global-instruction-configured"]');

  // refetchOnMount:'always' refetches in the background (stale-while-revalidate):
  // the cached count renders first, then updates to the on-disk truth — the body
  // grew by the 3-line <language> block. Poll until it reflects the change.
  const panel = page.locator('[data-testid="global-instruction-configured"]');
  await expect
    .poll(async () => Number(linesOf(await panel.innerText())), { timeout: 10_000 })
    .toBeGreaterThan(Number(linesBefore));

  const linesAfter = linesOf(await panel.innerText());
  console.log(
    `[fixed] lines before=${linesBefore} after=${linesAfter} diskHasBlock=${readFileSync(giPath, 'utf8').includes('<language>')}`,
  );
});
