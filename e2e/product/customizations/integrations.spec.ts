import { test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../../fixtures/app.js';
import { launchCustomizationsApp, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Integrações = hooks + MCP servers (plugins have their own "Plugins" group). Global's sit under the read-only Global section in a workspace;
// at Início they are the user's own and "Servidor MCP" in the Novo menu creates one.

let session: CustomizationsApp;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › integrations', () => {
  test('Global hooks and MCP servers are listed under Integrações once Global is expanded', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-section-global').click();
    await expect(page.getByTestId('tree-subgroup-type-global-integrations')).toBeVisible();
    await expect(page.getByTestId('tree-hook-hook-fmt')).toBeVisible();
    await expect(page.locator('[data-testid^="tree-mcp-"]').filter({ hasText: 'notion' })).toBeVisible();
  });

  test('Search finds a hook by its command or event and an MCP server by its name', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-search').fill('echo formatted');
    await expect(page.getByTestId('tree-hook-hook-fmt')).toBeVisible();
    await page.getByTestId('control-panel-search').fill('PostToolUse');
    await expect(page.getByTestId('tree-hook-hook-fmt')).toBeVisible();
    await page.getByTestId('control-panel-search').fill('notion');
    await expect(page.locator('[data-testid^="tree-mcp-"]').filter({ hasText: 'notion' })).toBeVisible();
    await expect(page.getByTestId('tree-hook-hook-fmt')).toBeHidden();
    await page.getByTestId('control-panel-search-clear').click();
  });

  test('At Início, Novo › Servidor MCP creates a server and stores it in Global', async () => {
    const { page, globalData } = session;
    await page.getByTestId('context-switcher').click();
    await page.getByTestId('context-switcher-home').click();

    await page.getByTestId('control-panel-new').click();
    await page.getByTestId('control-panel-new-mcp').click();
    await page.getByTestId('mcp-name-input').locator('input').fill('linear');
    await page.getByTestId('mcp-command-input').locator('input').fill('npx -y linear-mcp');
    await page.getByTestId('mcp-save').click();

    await expect(page.getByTestId('mcp-save')).toBeHidden();
    await expect
      .poll(() => (existsSync(join(globalData, 'mcps')) ? readdirSync(join(globalData, 'mcps')) : []))
      .toContain('linear.json');
    expect(readFileSync(join(globalData, 'mcps', 'linear.json'), 'utf8')).toContain('"command"');
    await expect(page.locator('[data-testid^="tree-mcp-"]').filter({ hasText: 'linear' })).toBeVisible();
  });
});
