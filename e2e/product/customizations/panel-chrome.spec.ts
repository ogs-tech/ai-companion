import { test } from '@playwright/test';
import { expect, type AppSession } from '../../fixtures/app.js';
import { launchCustomizationsApp } from '../../fixtures/customizations-app.js';

// The right panel is two stacked containers — Sessões above, Customizações below — each collapsible to its title.

let session: AppSession;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Control panel › layout', () => {
  test('Both containers are on screen inside the right panel, Sessões first', async () => {
    const { page } = session;
    const sessions = page.getByTestId('workspace-sessions-panel');
    const customizations = page.getByTestId('control-panel-customizations');
    await expect(sessions).toBeVisible();
    await expect(customizations).toBeVisible();
    const a = await sessions.boundingBox();
    const b = await customizations.boundingBox();
    expect(a && b && a.y < b.y, 'Sessões sits above Customizações').toBe(true);
  });

  test('Collapsing Customizações hides its search and rows, keeps the title and count, and expanding restores them', async () => {
    const { page } = session;
    await expect(page.getByTestId('control-panel-search')).toBeVisible();
    await page.getByTestId('control-panel-collapse').click();
    await expect(page.getByTestId('control-panel-search')).toBeHidden();
    await expect(page.getByTestId('tree-skill-deploy-checklist')).toBeHidden();
    await expect(page.getByTestId('control-panel-footer')).toBeHidden();
    await expect(page.getByTestId('control-panel-count')).toBeVisible();

    await page.getByTestId('control-panel-collapse').click();
    await expect(page.getByTestId('control-panel-search')).toBeVisible();
    await expect(page.getByTestId('tree-skill-deploy-checklist')).toBeVisible();
    await expect(page.getByTestId('control-panel-footer')).toBeVisible();
  });

  test('Collapsing Sessões hands its height to Customizações, and the + stays available', async () => {
    const { page } = session;
    const customizations = page.getByTestId('control-panel-customizations');
    const before = (await customizations.boundingBox())!.height;

    await page.getByTestId('workspace-sessions-collapse').click();
    await expect(page.getByTestId('sessions-footer')).toBeHidden();
    await expect.poll(async () => (await customizations.boundingBox())!.height).toBeGreaterThan(before);

    await page.getByTestId('workspace-sessions-collapse').click();
    await expect(page.getByTestId('sessions-footer')).toBeVisible();
    await expect(page.getByTestId('workspace-sessions-new')).toBeVisible();
  });

  test('Typing in the search box keeps the footer count in step with what is on screen', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-search').fill('acme');
    const count = Number(await page.getByTestId('control-panel-footer-count').innerText());
    // acme-rules (instruction), api-architect (agent: "Designs acme-api endpoints"), deploy-checklist (skill: "ship acme-api")
    expect(count).toBe(3);
    await page.getByTestId('control-panel-search-clear').click();
  });
});
