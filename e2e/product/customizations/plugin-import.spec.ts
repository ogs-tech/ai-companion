import { test } from '@playwright/test';
import { join } from 'node:path';
import { expect } from '../../fixtures/app.js';
import { launchCustomizationsApp, seedGitRepo, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Journey: Novo › Importar plugin. The dialog refuses an empty URL, points a marketplace at its own screen, explains
// a repo that is not a plugin, and — for a real plugin repo — imports it and lists it in the Plugins (origem) group.
// Sources are local git repos cloned through file://, so no network is involved.

let session: CustomizationsApp;
let pluginUrl: string;
let marketplaceUrl: string;
let plainUrl: string;

test.beforeAll(async () => {
  session = await launchCustomizationsApp({
    seed: (home) => {
      const repos = join(home, 'repos');
      pluginUrl = seedGitRepo(join(repos, 'demo-plugin'), {
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo-plugin', version: '1.2.0', description: 'A demo plugin' }),
        'skills/greet/SKILL.md': '---\nname: greet\ndescription: Say hello\n---\n\nSay hello.\n',
      });
      marketplaceUrl = seedGitRepo(join(repos, 'demo-market'), {
        '.claude-plugin/marketplace.json': JSON.stringify({
          name: 'demo-market',
          owner: { name: 'Ada Dev' },
          plugins: [{ name: 'demo-plugin', description: 'A demo plugin', source: './demo-plugin' }],
        }),
      });
      plainUrl = seedGitRepo(join(repos, 'not-a-plugin'), { 'README.md': '# nothing here\n' });
    },
  });
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › import a plugin', () => {
  test('The dialog guides the user through each way an import can go wrong, then imports', async () => {
    const { page } = session;
    const dialog = page.getByTestId('plugin-import-dialog');
    const url = page.getByTestId('plugin-url-input').locator('input');

    await test.step('Novo › Importar plugin opens the dialog', async () => {
      await page.getByTestId('control-panel-new').click();
      await page.getByTestId('control-panel-new-plugin').click();
      await expect(dialog).toBeVisible();
    });

    await test.step('an empty URL is refused with a message', async () => {
      await page.getByTestId('plugin-import-btn').click({ force: true });
      await expect(dialog.getByRole('alert')).toContainText('A URL do repositório é obrigatória');
    });

    await test.step('a marketplace URL is sent to the Marketplaces screen, not imported', async () => {
      await url.fill(marketplaceUrl);
      await page.getByTestId('plugin-import-btn').click();
      await expect(page.getByTestId('plugin-import-marketplace-warning')).toContainText('marketplace');
      await expect(page.getByTestId('plugin-import-marketplace-warning')).toContainText('demo-market');
      await expect(dialog).toBeVisible();
    });

    await test.step('a repository without a plugin manifest explains what is missing', async () => {
      await url.fill(plainUrl);
      await page.getByTestId('plugin-import-btn').click();
      await expect(dialog.getByRole('alert').filter({ hasText: /plugin\.json|manifest/i })).toBeVisible();
      await expect(page.getByTestId('plugin-import-marketplace-warning')).toHaveCount(0); // editing the URL cleared it
    });

    await test.step('a real plugin repository imports, closes the dialog and appears in the panel', async () => {
      await url.fill(pluginUrl);
      await page.getByTestId('plugin-import-btn').click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect(page.locator('[data-testid$=":urn:plugin:demo-plugin"]')).toBeVisible();
    });
  });

  test('Importing the same plugin again reports the conflict instead of duplicating it', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-new').click();
    await page.getByTestId('control-panel-new-plugin').click();
    await page.getByTestId('plugin-url-input').locator('input').fill(pluginUrl);
    await page.getByTestId('plugin-import-btn').click();
    await expect(page.getByTestId('plugin-import-dialog').getByRole('alert')).toBeVisible();
    await expect(page.locator('[data-testid$=":urn:plugin:demo-plugin"]')).toHaveCount(1);
  });
});
