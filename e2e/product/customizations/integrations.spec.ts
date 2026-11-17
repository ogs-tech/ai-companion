import { test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../../fixtures/app.js';
import { launchCustomizationsApp, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Hooks and MCP servers are top-level type groups (no "Integrações"). Global's sit under the read-only Global section in a
// workspace; at Início they are the user's own and "Servidor MCP" in the Novo menu creates one.

let session: CustomizationsApp;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

test.describe('Customizations › integrations', () => {
  test('MCP and Hooks are top-level groups of the Global section', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-section-global').click();
    await expect(page.getByTestId('tree-group-global-mcp')).toHaveText(/MCP/);
    await expect(page.getByTestId('tree-group-global-hook')).toHaveText(/Hooks/);
    await expect(page.getByText('Integrações')).toHaveCount(0);
    await expect(page.getByTestId('tree-row-global::urn:hook:hook-fmt')).toBeVisible();
    await expect(page.locator('[data-testid^="tree-row-"]').filter({ hasText: 'notion' })).toBeVisible();
  });

  test('Search finds a hook by its command or event and an MCP server by its name', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-search').fill('echo formatted');
    await expect(page.getByTestId('tree-row-global::urn:hook:hook-fmt')).toBeVisible();
    await page.getByTestId('control-panel-search').fill('PostToolUse');
    await expect(page.getByTestId('tree-row-global::urn:hook:hook-fmt')).toBeVisible();
    await page.getByTestId('control-panel-search').fill('notion');
    await expect(page.locator('[data-testid^="tree-row-"]').filter({ hasText: 'notion' })).toBeVisible();
    await expect(page.getByTestId('tree-row-global::urn:hook:hook-fmt')).toBeHidden();
    await page.getByTestId('control-panel-search-clear').click();
  });

  test('disabled MCP shows desativado', async () => {
    const { page } = session;
    const notion = page.locator('[data-testid^="tree-row-global:"]').filter({ hasText: 'notion' });
    await expect(notion).toBeVisible();
    await notion.click({ button: 'right' });
    await page.getByTestId('row-context-menu-toggle').click();
    await expect(notion.getByTestId('row-tag-disabled')).toHaveText('desativado');
    await expect(page.getByTestId('chip-disabled')).toHaveText('Desativados 1');
    // Turn it back on so the following tests see the seed as it was.
    await notion.click({ button: 'right' });
    await page.getByTestId('row-context-menu-toggle').click();
    await expect(notion.getByTestId('row-tag-disabled')).toHaveCount(0);
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
    await expect(page.locator('[data-testid^="tree-row-"]').filter({ hasText: 'linear' })).toBeVisible();
  });
});
