import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, launchApp, writeFile, type AppSession } from './fixtures/app.js';

// Picking a language in Config > Idioma must write the <language> block into the personal instruction on disk
// (the file Claude/Cursor are then synced from), not just remember the choice in settings.
// Replaces the old Global-Instructions staleness spec, whose screens (nav-biblioteca, the line-count chip) no longer exist.

const SEED_INSTRUCTION = `# Global instructions

Intro line for the test profile.

## How to work with me

- Reply concisely.
`;

let session: AppSession;
let instructionPath: string;

test.beforeAll(async () => {
  session = await launchApp({
    seed: (home) => {
      instructionPath = join(home, '.ai-companion', 'instructions', 'default.md');
      writeFile(instructionPath, SEED_INSTRUCTION);
    },
  });
});

test.afterAll(async () => {
  await session?.close();
});

test('choosing a language writes the <language> block into the personal instruction', async () => {
  const { page } = session;
  expect(readFileSync(instructionPath, 'utf8'), 'no block on disk yet').not.toContain('<language>');

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('config-leaf-language').click();
  await page.getByTestId('config-page-language').waitFor();

  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Português (pt-BR)' }).click();
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveText(/Português/);

  await expect.poll(() => readFileSync(instructionPath, 'utf8').includes('<language>'), { timeout: 10_000 }).toBe(true);
  const body = readFileSync(instructionPath, 'utf8');
  expect(body).toContain('pt-BR');
  expect(body, 'the user text survives the rewrite').toContain('Reply concisely.');
});
