import { test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, writeFile } from '../../fixtures/app.js';
import { mcpLoginMarker, realBinaryOnHost } from '../../fixtures/cli-stubs.js';
import { launchCustomizationsApp, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Journey: a remote MCP server the user owns (Global's `context7`, written to Claude and Cursor) needs OAuth. Its row
// menu leads with Conectar; that opens the server's page in the Workbench, where one click signs in to every channel — Claude's
// `claude mcp login`, then Cursor's `cursor-agent mcp login`, each in a visible terminal (every CLI keeps its own
// token). The stubs (fixtures/cli-stubs.ts) answer `mcp list` like the real Claude, so the page then reads Conectado.

const URL = 'https://mcp.context7.com/mcp';
const STAMP = '2026-01-01T00:00:00.000Z';

let session: CustomizationsApp;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  session = await launchCustomizationsApp({
    settings: { adapters: { claude: { enabled: true }, cursor: { enabled: true } } },
    cli: {
      claude: { signedIn: true, mcpServers: { context7: URL } },
      'cursor-agent': { signedIn: true, mcpServers: { context7: URL } },
    },
    seed: (home) => {
      writeFile(
        join(home, '.air-ide', 'mcps', 'context7.json'),
        JSON.stringify(
          {
            name: 'context7',
            type: 'mcp',
            description: 'Up-to-date library docs',
            scopes: ['personal'],
            version: '1.0.0',
            createdAt: STAMP,
            updatedAt: STAMP,
            def: { type: 'http', url: URL },
            enabled: true,
          },
          null,
          2,
        ),
      );
      // What Claude Code leaves behind after a session met the server without a token.
      writeFile(join(home, '.claude', 'mcp-needs-auth-cache.json'), JSON.stringify({ context7: { timestamp: 1_767_225_600_000 } }));
    },
  });
});

test.afterAll(async () => {
  await session?.close();
});

const row = () => session.page.locator('[data-testid^="tree-row-global:"]').filter({ hasText: 'context7' });
const mcpTabs = () => session.page.locator('[data-testid^="workbench-tab-mcp:"]');

test.describe('Customizations › MCP page', () => {
  test.beforeEach(() => {
    test.skip(
      realBinaryOnHost('claude') || realBinaryOnHost('cursor-agent'),
      "a real CLI sits in a system dir a login shell puts ahead of the stubs, so the sign-in would reach the real one",
    );
  });

  test('Conectar, first in the row menu, opens the server page as a Workbench tab', async () => {
    const { page } = session;
    await page.getByTestId('control-panel-section-global').click();
    await expect(row()).toBeVisible();

    await row().click({ button: 'right' });
    await expect(page.getByRole('menuitem').first()).toHaveText('Conectar');
    await page.getByTestId('row-context-menu-authenticate').click();

    const mcpPage = page.getByTestId('mcp-page');
    await expect(mcpTabs()).toHaveCount(1);
    await expect(mcpTabs().first()).toHaveAttribute('aria-pressed', 'true');
    await expect(mcpTabs().first()).toHaveAccessibleName('context7');
    await expect(mcpPage.getByRole('heading', { name: 'context7' })).toBeVisible();
    await expect(mcpPage.getByText(`http · ${URL}`)).toBeVisible();
    await expect(page.getByTestId('mcp-page-channel-claude')).toContainText('Precisa de login');
    await expect(page.getByTestId('mcp-page-channel-cursor')).toBeVisible();
  });

  test('Conectar em todos signs in with Claude, then Cursor, each through its own CLI', { tag: '@smoke' }, async () => {
    const { page, stubDir } = session;
    const dialog = page.getByTestId('channel-setup-dialog');

    await page.getByRole('button', { name: 'Conectar em todos' }).click();

    await test.step('Claude first: `claude mcp login context7` in a visible terminal', async () => {
      await expect(dialog).toContainText('Conectar context7 no Claude');
      await expect(dialog.getByText('Concluído.')).toBeVisible({ timeout: 20_000 });
      expect(existsSync(mcpLoginMarker(stubDir, 'claude', 'context7'))).toBe(true);
      expect(existsSync(mcpLoginMarker(stubDir, 'cursor-agent', 'context7'))).toBe(false);
    });

    await test.step('then the same dialog offers Cursor, which signs in with `cursor-agent mcp login`', async () => {
      await dialog.getByRole('button', { name: 'Conectar no Cursor' }).click();
      await expect(dialog).toContainText('Conectar context7 no Cursor');
      await expect(dialog.getByText('Concluído.')).toBeVisible({ timeout: 20_000 });
      expect(existsSync(mcpLoginMarker(stubDir, 'cursor-agent', 'context7'))).toBe(true);
      // Nothing left to sign in to: no next step, only Fechar.
      await expect(dialog.getByRole('button', { name: /^Conectar no/ })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Fechar' }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('Claude re-checks the connection; the row no longer asks to connect', async () => {
      await expect(page.getByTestId('mcp-page-channel-claude')).toContainText('Conectado', { timeout: 20_000 });
      await row().click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByTestId('row-context-menu-authenticate')).toHaveCount(0);
      await page.keyboard.press('Escape');
    });
  });

  test('Clicking the row again focuses the open page instead of stacking a second tab', async () => {
    const { page } = session;
    // The seed left the server unsynced, so its row carries the error mark: that one leads to Diagnósticos.
    await row().getByTestId('channel-warning').click();
    await expect(page.getByTestId('workbench-tab-diagnostico')).toHaveAttribute('aria-pressed', 'true');
    await expect(mcpTabs().first()).toHaveAttribute('aria-pressed', 'false');

    await row().getByText('context7', { exact: true }).click();
    await expect(mcpTabs()).toHaveCount(1);
    await expect(mcpTabs().first()).toHaveAttribute('aria-pressed', 'true');

    await mcpTabs().first().hover();
    await page.getByRole('button', { name: 'Fechar context7' }).click();
    await expect(mcpTabs()).toHaveCount(0);
    await expect(page.getByTestId('mcp-page')).toHaveCount(0);
  });
});
