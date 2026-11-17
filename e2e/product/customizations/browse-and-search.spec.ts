import { test } from '@playwright/test';
import { expect, type AppSession } from '../../fixtures/app.js';
import { launchCustomizationsApp } from '../../fixtures/customizations-app.js';

// Journey: open a workspace and read the Customizações panel — own items first, Global's below and read-only —
// then narrow the list with the search box and clear it again.

let session: AppSession;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › browse and search', () => {
  test('The workspace lists its own items, Global stays collapsed and read-only', async () => {
    const { page } = session;
    const panel = page.getByTestId('control-panel-customizations');

    await test.step('the header names the panel and counts every item', async () => {
      await expect(panel.getByText('Customizações', { exact: true })).toBeVisible();
      await expect(page.getByTestId('control-panel-count')).not.toHaveText('0');
    });

    await test.step('Workspace shows its instruction, skill and agent', async () => {
      await expect(page.getByTestId('control-panel-section-local')).toBeVisible();
      await expect(page.getByTestId('workspace-instruction-row-acme-rules')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:agent:api-architect')).toBeVisible();
    });

    await test.step('Global starts collapsed: its rows are not on screen', async () => {
      await expect(page.getByTestId('control-panel-section-global')).toBeVisible();
      await expect(page.getByTestId('tree-row-global::urn:skill:global-lint')).toBeHidden();
    });

    await test.step('expanding Global lists the personal skills, agent and instruction', async () => {
      await page.getByTestId('control-panel-section-global').click();
      await expect(page.getByTestId('inherited-instruction-row')).toBeVisible();
      await expect(page.getByTestId('tree-row-global::urn:skill:global-lint')).toBeVisible();
      await expect(page.getByTestId('tree-row-global::urn:skill:release-notes')).toBeVisible();
      await expect(page.getByTestId('tree-row-global::urn:agent:global-reviewer')).toBeVisible();
    });

    await test.step('Global skills and agents offer no "create" — they are edited at Início', async () => {
    });

    await test.step('a Global skill opens read-only with a way to edit it at Início', async () => {
      await page.getByTestId('tree-row-global::urn:skill:global-lint').click();
      await expect(page.getByTestId('inherited-notice')).toBeVisible();
      await expect(page.getByTestId('inherited-edit-at-home')).toBeVisible();
    });
  });

  test('Search narrows by name or description, reports "N de M", and clears', async () => {
    const { page } = session;
    const search = page.getByTestId('control-panel-search');
    const footer = page.getByTestId('control-panel-footer');
    const totalBefore = Number(await page.getByTestId('control-panel-footer-count').innerText());

    await test.step('by name', async () => {
      await search.fill('deploy');
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:agent:api-architect')).toBeHidden();
      await expect(footer).toContainText(`de ${totalBefore} itens`);
      await expect(page.getByTestId('control-panel-footer-count')).toHaveText('1');
    });

    await test.step('by description, reaching into collapsed Global', async () => {
      await search.fill('release notes');
      await expect(page.getByTestId('tree-row-global::urn:skill:release-notes')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeHidden();
    });

    await test.step('no match shows the empty state naming the query', async () => {
      await search.fill('zzz-nothing');
      await expect(page.getByTestId('control-panel-empty')).toContainText('zzz-nothing');
      await expect(page.getByTestId('control-panel-footer-count')).toHaveText('0');
    });

    await test.step('the clear button in the box restores the full list', async () => {
      await page.getByTestId('control-panel-search-clear').click();
      await expect(search).toHaveValue('');
      await expect(page.getByTestId('control-panel-empty')).toHaveCount(0);
      await expect(page.getByTestId('control-panel-footer-count')).toHaveText(String(totalBefore));
    });

    await test.step('"Limpar filtros" in the footer does the same', async () => {
      await search.fill('api');
      await page.getByTestId('control-panel-clear').click();
      await expect(search).toHaveValue('');
      await expect(page.getByTestId('control-panel-clear')).toHaveCount(0);
    });
  });

  test('Problemas chip narrows the tree and Limpar filtros restores it', async () => {
    const { page } = session;
    const problems = page.getByTestId('chip-problems');
    const totalBefore = Number(await page.getByTestId('control-panel-footer-count').innerText());
    // The seed writes files straight to disk, never synced to Claude: those rows carry "⚠ Claude".
    await expect(problems).toHaveText(/⚠ Problemas [1-9]/);
    const failing = Number((await problems.innerText()).replace(/\D+/g, ''));

    await problems.click();
    await expect(problems).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
    await expect(page.getByTestId('control-panel-footer-count')).toHaveText(String(failing));
    await expect(page.getByTestId('control-panel-footer')).toContainText(`de ${totalBefore} itens`);
    // Every listed row says what is wrong.
    for (const row of await page.locator('[data-testid^="tree-row-"]').all()) await expect(row.getByTestId('channel-warning')).toBeVisible();

    await page.getByTestId('control-panel-clear').click();
    await expect(page.getByTestId('chip-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('control-panel-footer-count')).toHaveText(String(totalBefore));
  });
});
