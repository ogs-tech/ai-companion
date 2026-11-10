import { test } from '@playwright/test';
import { join } from 'node:path';
import { expect, launchApp, seedGitWorkspace, stubFolderPicker, type AppSession } from '../fixtures/app.js';

// Journey: first launch at Início → open a folder as a workspace → browse and open a file → go back to Início
// → reopen the workspace from the list. Steps are named so a reviewer can read the journey from the report.

let session: AppSession;
let projectRoot: string;

test.beforeAll(async () => {
  session = await launchApp({ seed: (home) => seedGitWorkspace((projectRoot = join(home, 'Projects', 'acme-api'))) });
});

test.afterAll(async () => {
  await session?.close();
});

test('first use: open a folder, read a file, go home and come back', async () => {
  const { page, app } = session;

  await test.step('Início starts with no workspaces', async () => {
    await expect(page.getByTestId('main-screen')).toBeVisible();
    await expect(page.getByTestId('workspaces-list')).toBeVisible();
    await expect(page.locator('[data-testid^="workspace-list-row-"]')).toHaveCount(0);
  });

  await test.step('opening a folder makes it the active workspace', async () => {
    await stubFolderPicker(app, projectRoot);
    await page.getByTestId('workspaces-new').click();
    await expect(page.getByTestId('workspace-screen')).toBeVisible();
    await expect(page.getByTestId('folder-tree')).toBeVisible();
  });

  await test.step('the file tree lists the project and opens a file in a tab', async () => {
    const tree = page.getByTestId('folder-tree');
    await expect(tree.getByText('README.md', { exact: true })).toBeVisible();
    await expect(tree.getByText('src', { exact: true })).toBeVisible();
    await tree.getByText('README.md', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fechar README.md' })).toBeVisible();
    await expect(page.getByText('Demo workspace for the e2e journeys.')).toBeVisible();
  });

  await test.step('going back to Início lists the workspace just opened', async () => {
    await page.getByTestId('context-switcher').click();
    await page.getByTestId('context-switcher-home').click();
    await expect(page.getByTestId('workspaces-list')).toBeVisible();
    await expect(page.locator('[data-testid^="workspace-list-row-"]')).toHaveCount(1);
  });

  await test.step('picking it from the list reopens it', async () => {
    await page.locator('[data-testid^="workspace-list-row-"]').first().click();
    await expect(page.getByTestId('folder-tree')).toBeVisible();
    await expect(page.getByTestId('folder-tree').getByText('README.md', { exact: true })).toBeVisible();
  });
});
