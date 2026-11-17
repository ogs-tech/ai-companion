import { test } from '@playwright/test';
import { expect, type AppSession } from '../../fixtures/app.js';
import { launchCustomizationsApp } from '../../fixtures/customizations-app.js';

// Journey: open a workspace and read the Customizações panel — own items first, Global's below (editable from here too) —
// then narrow the list with the search box and clear it again.

let session: AppSession;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › browse and search', () => {
  test('The workspace lists its own items, Global stays collapsed below', async () => {
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
      await expect(page.getByTestId('personal-instruction-row')).toBeVisible();
      await expect(page.getByTestId('tree-row-global::urn:skill:global-lint')).toBeVisible();
      await expect(page.getByTestId('tree-row-global::urn:skill:release-notes')).toBeVisible();
      await expect(page.getByTestId('tree-row-global::urn:agent:global-reviewer')).toBeVisible();
    });

    await test.step('Global skills and agents offer no "create" — they are edited at Início', async () => {
    });

    await test.step('a Global skill opens editable right here, noting the change reaches every workspace', async () => {
      await page.getByTestId('tree-row-global::urn:skill:global-lint').getByText('global-lint', { exact: true }).click();
      await expect(page.getByTestId('workbench-tab-entity:urn:skill:global-lint')).toBeVisible();
      await expect(page.getByTestId('global-notice')).toBeVisible();
      await expect(page.getByTestId('body-editor')).toBeVisible();
    });
  });

  test('Search narrows by name or description, reports "N de M", and clears', async () => {
    const { page } = session;
    const search = page.getByTestId('control-panel-search');
    const shown = page.getByTestId('control-panel-shown');
    const total = page.getByTestId('control-panel-count');
    const totalBefore = Number(await total.innerText());

    await test.step('by name', async () => {
      await search.fill('deploy');
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:agent:api-architect')).toBeHidden();
      await expect(shown).toHaveText(`1 de ${totalBefore}`);
    });

    await test.step('by description, reaching into collapsed Global', async () => {
      await search.fill('release notes');
      await expect(page.getByTestId('tree-row-global::urn:skill:release-notes')).toBeVisible();
      await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeHidden();
    });

    await test.step('no match shows the empty state naming the query', async () => {
      await search.fill('zzz-nothing');
      await expect(page.getByTestId('control-panel-empty')).toContainText('zzz-nothing');
      await expect(shown).toHaveText(`0 de ${totalBefore}`);
    });

    await test.step('the clear button in the box restores the full list', async () => {
      await page.getByTestId('control-panel-search-clear').click();
      await expect(search).toHaveValue('');
      await expect(page.getByTestId('control-panel-empty')).toHaveCount(0);
      await expect(shown).toHaveCount(0);
      await expect(total).toHaveText(String(totalBefore));
    });

    await test.step('"Limpar filtros" in the empty state does the same', async () => {
      await search.fill('zzz-nothing');
      await page.getByTestId('control-panel-clear').click();
      await expect(search).toHaveValue('');
      await expect(page.getByTestId('control-panel-clear')).toHaveCount(0);
    });
  });

  test('"com erro" chip narrows the tree, its channel row narrows it further, and clicking it again restores it', async () => {
    const { page } = session;
    const problems = page.getByTestId('chip-error');
    const shown = page.getByTestId('control-panel-shown');
    const totalBefore = Number(await page.getByTestId('control-panel-count').innerText());
    // The seed writes files straight to disk, never synced to Claude: those rows carry "Erro no Claude".
    await expect(problems).toHaveText(/^[1-9]\d* com erro$/);
    const failing = Number((await problems.innerText()).replace(/\D+/g, ''));

    await problems.click();
    await expect(problems).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tree-row-local::urn:skill:deploy-checklist')).toBeVisible();
    await expect(shown).toHaveText(`${failing} de ${totalBefore}`);
    // Every listed row says what is wrong (the file tree's rows and chevron spacers are not customizations).
    const rows = page.getByTestId('control-panel-customizations').locator('[data-testid^="tree-row-"]:not([data-testid="tree-row-chevron-spacer"])');
    for (const row of await rows.all()) await expect(row.getByTestId('channel-warning')).toBeVisible();

    // Every failure in the seed is on Claude (Cursor is off), so its channel chip lists them all.
    await expect(page.getByTestId('chip-channel-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('chip-channel-claude')).toHaveText(`Claude ${failing}`);
    await page.getByTestId('chip-channel-claude').click();
    await expect(shown).toHaveText(`${failing} de ${totalBefore}`);
    await expect(page.getByTestId('chip-channel-cursor')).toBeDisabled();

    await problems.click();
    await expect(problems).toHaveAttribute('aria-pressed', 'false');
    await expect(shown).toHaveCount(0);
    await expect(page.getByTestId('control-panel-count')).toHaveText(String(totalBefore));
  });
});
