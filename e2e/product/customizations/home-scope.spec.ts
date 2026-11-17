import { test } from '@playwright/test';
import { expect } from '../../fixtures/app.js';
import { launchCustomizationsApp, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Journey: Global's items are read-only inside a workspace but are the main list at Início — and the panel follows
// the scope switch both ways (Início ↔ workspace) without leaking one scope's rows into the other.

let session: CustomizationsApp;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › scope switch', () => {
  test('Início shows Global as editable, with no Workspace section; coming back restores the workspace', async () => {
    const { page } = session;

    await test.step('inside the workspace, Workspace and Global sections both exist', async () => {
      await expect(page.getByTestId('control-panel-section-local')).toBeVisible();
      await expect(page.getByTestId('control-panel-section-global')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
    });

    await test.step('going to Início drops the workspace rows and lists Global as the main list', async () => {
      await page.getByTestId('context-switcher').click();
      await page.getByTestId('context-switcher-home').click();
      await expect(page.getByTestId('tree-row-local::urn:skill:global-lint')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:skill:release-notes')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:agent:global-reviewer')).toBeVisible();
      await expect(page.getByTestId('personal-instruction-row')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toHaveCount(0);
      await expect(page.getByTestId('control-panel-section-local')).toHaveCount(0);
      await expect(page.getByTestId('control-panel-section-global')).toHaveCount(0);
    });

    await test.step('a Global skill opens editable at Início (no read-only notice)', async () => {
      await page.getByTestId('tree-row-local::urn:skill:global-lint').click();
      await expect(page.getByTestId('workbench-tab-entity:urn:skill:global-lint')).toBeVisible();
      await expect(page.getByTestId('inherited-notice')).toHaveCount(0);
    });

    await test.step('search at Início finds Global items by description', async () => {
      await page.getByTestId('control-panel-search').fill('changelog-nothing');
      await expect(page.getByTestId('control-panel-empty')).toBeVisible();
      await page.getByTestId('control-panel-search').fill('release');
      await expect(page.getByTestId('tree-row-local::urn:skill:release-notes')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:skill:global-lint')).toBeHidden();
      await page.getByTestId('control-panel-search-clear').click();
    });

    await test.step('back in the workspace the search box is reset and its own rows return', async () => {
      await page.locator('[data-testid^="workspace-list-row-"]').first().click();
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
      await expect(page.getByTestId('control-panel-search')).toHaveValue('');
      await expect(page.getByTestId('tree-row-local::urn:skill:global-lint')).toHaveCount(0); // Global's rows live in the Global section here
    });
  });

  test('switching scope resets the active chip to Todos', async () => {
    const { page } = session;
    await page.getByTestId('chip-error').click();
    await expect(page.getByTestId('chip-error')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('context-switcher').click();
    await page.getByTestId('context-switcher-home').click();
    await expect(page.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-testid^="workspace-list-row-"]').first().click();
    await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
    await expect(page.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('chip-error')).toHaveAttribute('aria-pressed', 'false');
  });
});
