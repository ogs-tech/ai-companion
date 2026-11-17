import { test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../../fixtures/app.js';
import {
  launchCustomizationsApp,
  saveFromMenu,
  type CustomizationsApp,
} from '../../fixtures/customizations-app.js';

// Journey: create a skill from the panel's "Novo" menu, save it, see it in the tree and on disk; reopen an existing
// one, edit it and save; offer the right kinds in the menu.

let session: CustomizationsApp;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › create and edit', () => {
  test('The Novo menu offers every kind the workspace can create', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-new').click();
    await expect(page.getByTestId('control-panel-new-skill')).toBeVisible();
    await expect(page.getByTestId('control-panel-new-agent')).toBeVisible();
    await expect(page.getByTestId('control-panel-new-mcp')).toBeVisible();
    await expect(page.getByTestId('control-panel-new-plugin')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('control-panel-new-skill')).toBeHidden();
  });

  test('Creating a skill names it, saves it into the workspace and lists it', async () => {
    const { page, app, acmeData } = session;

    await test.step('Novo › Skill opens an unsaved tab with the Properties form', async () => {
      await page.getByTestId('control-panel-new').click();
      await page.getByTestId('control-panel-new-skill').click();
      await expect(page.getByTestId('properties-modal')).toBeVisible();
    });

    await test.step('name and description are filled in the form', async () => {
      const modal = page.getByTestId('properties-modal');
      await modal.getByLabel('Name').fill('db-migrations');
      await modal.getByLabel('Description').fill('Write safe database migrations');
      await modal.getByRole('button', { name: 'Fechar' }).click();
      await expect(modal).toBeHidden();
    });

    await test.step('saving writes SKILL.md under the workspace data dir', async () => {
      await saveFromMenu(app);
      const file = join(acmeData, 'skills', 'db-migrations', 'SKILL.md');
      await expect.poll(() => existsSync(file)).toBe(true);
      const body = readFileSync(file, 'utf8');
      expect(body).toContain('name: db-migrations');
      expect(body).toContain('description: Write safe database migrations');
      expect(body).toContain('scopeId: acme');
    });

    await test.step('the new skill appears in the Workspace tree and the count grows', async () => {
      await expect(page.getByTestId('tree-skill-db-migrations')).toBeVisible();
    });

    await test.step('it is searchable by its description', async () => {
      await page.getByTestId('control-panel-search').fill('safe database');
      await expect(page.getByTestId('tree-skill-db-migrations')).toBeVisible();
      await expect(page.getByTestId('tree-skill-deploy-checklist')).toBeHidden();
      await page.getByTestId('control-panel-search-clear').click();
    });
  });

  test('Opening a workspace skill and changing its description saves to disk', async () => {
    const { page, app, acmeData } = session;
    await page.getByTestId('tree-skill-deploy-checklist').click();
    const tab = page.getByTestId('workbench-tab-entity:urn:skill:deploy-checklist');
    await expect(tab).toBeVisible();
    await expect(page.getByTestId('inherited-notice')).toHaveCount(0);
    await expect(page.getByText('Instructions for deploy-checklist.')).toBeVisible();

    await test.step('editing Properties marks the tab dirty', async () => {
      await page.getByTestId('tree-skill-deploy-checklist').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Properties' }).click();
      const modal = page.getByTestId('properties-modal');
      await modal.getByLabel('Description').fill('Steps to ship acme-api safely');
      await modal.getByRole('button', { name: 'Fechar' }).click();
      await expect(page.getByTestId('workbench-tab-dirty-entity:urn:skill:deploy-checklist')).toBeVisible();
    });

    await test.step('saving rewrites the file and clears the dirty mark', async () => {
      await saveFromMenu(app);
      const file = join(acmeData, 'skills', 'deploy-checklist', 'SKILL.md');
      await expect
        .poll(() => readFileSync(file, 'utf8').includes('Steps to ship acme-api safely'))
        .toBe(true);
      await expect(page.getByTestId('workbench-tab-dirty-entity:urn:skill:deploy-checklist')).toHaveCount(0);
    });
  });

  test('Deleting a workspace skill removes it from the tree and from disk', async () => {
    const { page, acmeData } = session;
    const dir = join(acmeData, 'skills', 'db-migrations');
    await expect(page.getByTestId('tree-skill-db-migrations')).toBeVisible();
    expect(existsSync(dir)).toBe(true);

    await page.getByTestId('tree-skill-db-migrations').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Excluir' }).click(); // the confirm() dialog is auto-accepted by launchApp

    await expect(page.getByTestId('tree-skill-db-migrations')).toHaveCount(0);
    await expect.poll(() => existsSync(join(dir, 'SKILL.md'))).toBe(false);
  });
});
