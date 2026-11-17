import { test } from '@playwright/test';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../../fixtures/app.js';
import { launchCustomizationsApp, saveFromMenu, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Journey: items that exist canonically but were never materialized into Claude (the seed writes files straight to
// disk, like a checkout from another machine) carry "⚠ Claude". The warning leads to Diagnósticos, and saving the
// item (which syncs it) clears it. Silence means ok — Global's items, which the seed also left unsynced, are in the
// same state, so only the rows in the open scope are asserted.

let session: CustomizationsApp;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › channel warnings', () => {
  test('An unsynced skill and agent show "⚠ Claude", and their groups count the problems', async () => {
    const { page } = session;
    await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist').getByTestId('channel-warning')).toHaveText('⚠ Claude');
    await expect(page.getByTestId('tree-row-local::urn:agent:api-architect').getByTestId('channel-warning')).toHaveText('⚠ Claude');
    await expect(page.getByTestId('tree-group-skill')).toContainText('⚠');
    await expect(page.getByTestId('tree-group-agent')).toContainText('⚠');
  });

  test('The warning is accessible: it names the channel and says it opens the diagnostic', async () => {
    const { page } = session;
    const warning = page.getByTestId('tree-row-local::urn:skill:deploy-checklist').getByTestId('channel-warning');
    await expect(warning).toHaveAttribute('aria-label', 'Problema em Claude. Abrir diagnóstico');
  });

  test('Clicking the warning opens Diagnósticos narrowed to that item, without opening the skill', async () => {
    const { page } = session;
    await page.getByTestId('tree-row-local::urn:skill:deploy-checklist').getByTestId('channel-warning').click();
    await expect(page.getByTestId('workbench-tab-diagnostico')).toBeVisible();
    await expect(page.getByTestId('workbench-tab-entity:urn:skill:deploy-checklist')).toHaveCount(0);
    await expect(page.getByTestId('health-focus')).toContainText('urn:skill:deploy-checklist');
    await expect(page.getByTestId('health-screen')).not.toContainText('api-architect');
  });

  test('"Ver tudo" drops the narrowing and shows the other item\'s problem too', async () => {
    const { page } = session;
    await page.getByTestId('health-focus-clear').click();
    await expect(page.getByTestId('health-focus')).toHaveCount(0);
    await expect(page.getByTestId('health-screen')).toContainText('api-architect');
  });

  test('Saving an item from the editor clears its own warning at once, and leaves the others', async () => {
    const { page, app } = session;
    await page.getByTestId('tree-row-local::urn:skill:deploy-checklist').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Properties' }).click();
    await page.getByTestId('properties-modal').getByLabel('Description').fill('Steps to ship acme-api safely');
    await page.getByTestId('properties-modal').getByRole('button', { name: 'Fechar' }).click();
    await saveFromMenu(app);

    // well under the 30 s health poll: the save itself refreshes the report
    await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist').getByTestId('channel-warning')).toHaveCount(0, { timeout: 8_000 });
    await expect(page.getByTestId('tree-row-local::urn:agent:api-architect').getByTestId('channel-warning')).toBeVisible();
  });

  test('Atualizar in Diagnósticos syncs to Claude and every warning in the tree goes away', async () => {
    const { page, acmeRoot } = session;
    // the editor tab from the previous test is in front; the agent's own ⚠ leads back to Diagnósticos
    await page.getByTestId('tree-row-local::urn:agent:api-architect').getByTestId('channel-warning').click();
    await page.getByTestId('health-refresh').click();
    const skillLink = join(acmeRoot, '.claude', 'skills', 'deploy-checklist');
    const agentLink = join(acmeRoot, '.claude', 'agents', 'api-architect.md');
    await expect.poll(() => existsSync(skillLink), { timeout: 20_000 }).toBe(true);
    expect(lstatSync(skillLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(agentLink).isSymbolicLink()).toBe(true);

    await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist').getByTestId('channel-warning')).toHaveCount(0);
    await expect(page.getByTestId('tree-row-local::urn:agent:api-architect').getByTestId('channel-warning')).toHaveCount(0);
    await expect(page.getByTestId('tree-group-skill')).not.toContainText('⚠');
  });
});
