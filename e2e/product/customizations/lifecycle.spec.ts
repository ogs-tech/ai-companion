import { test } from '@playwright/test';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../../fixtures/app.js';
import { launchCustomizationsApp, seedGitRepo, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Journey: one lifecycle for every kind — Desativar/Ativar a skill (its Claude link goes and comes back), Excluir with
// Desfazer, a hook created and edited in its own editor, and a plugin shown as an origin whose items say desativado.

let session: CustomizationsApp;
let pluginUrl: string;

test.beforeAll(async () => {
  session = await launchCustomizationsApp({
    seed: (home) => {
      pluginUrl = seedGitRepo(join(home, 'repos', 'demo-plugin'), {
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo-plugin', version: '1.2.0', description: 'A demo plugin' }),
        'skills/greet/SKILL.md': '---\nname: greet\ndescription: Say hello\n---\n\nSay hello.\n',
      });
    },
  });
});
test.afterAll(async () => {
  await session?.close();
});

const isLink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

test.describe('Customizations › lifecycle', () => {
  test('Desativar takes a skill out of Claude, Ativar puts it back', async () => {
    const { page, acmeRoot } = session;
    const row = page.getByTestId('tree-row-local::urn:skill:deploy-checklist');
    const link = join(acmeRoot, '.claude', 'skills', 'deploy-checklist');
    const toggle = async (label: 'Desativar' | 'Ativar'): Promise<void> => {
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: label }).click();
    };

    await test.step('Desativar: the row reads desativado and there is no Claude link', async () => {
      await toggle('Desativar');
      await expect(row.getByTestId('row-tag-disabled')).toHaveText('Desativado');
      await expect.poll(() => isLink(link)).toBe(false);
    });

    await test.step('Ativar: the skill is linked into Claude and the tag goes away', async () => {
      await toggle('Ativar');
      await expect(row.getByTestId('row-tag-disabled')).toHaveCount(0);
      await expect.poll(() => isLink(link)).toBe(true);
    });

    await test.step('Desativar again removes that link', async () => {
      await toggle('Desativar');
      await expect.poll(() => isLink(link)).toBe(false);
      await toggle('Ativar');
      await expect.poll(() => isLink(link)).toBe(true);
    });
  });

  test('Excluir hides the row at once; Desfazer keeps the file; letting it run deletes it', async () => {
    const { page, acmeData } = session;
    const row = page.getByTestId('tree-row-local::urn:agent:api-architect');
    const file = join(acmeData, 'agents', 'api-architect.md');

    await test.step('Excluir, then Desfazer: the row comes back and the file is still there', async () => {
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Excluir' }).click();
      await expect(row).toHaveCount(0);
      await page.getByRole('button', { name: 'Desfazer' }).click();
      await expect(row).toBeVisible();
      expect(existsSync(file)).toBe(true);
    });

    await test.step('Excluir and wait: the file is deleted when the undo window ends', async () => {
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Excluir' }).click();
      await expect(row).toHaveCount(0);
      await expect.poll(() => existsSync(file), { timeout: 15_000 }).toBe(false);
    });
  });

  test('A hook is created from Novo › Hooks and edited in its own editor', async () => {
    const { page, globalData } = session;
    const hooksDir = join(globalData, 'hooks');
    const savedHook = (): Record<string, unknown> | undefined => {
      const name = readdirSync(hooksDir).find((f) => readFileSync(join(hooksDir, f), 'utf8').includes('./check.sh'));
      return name === undefined ? undefined : (JSON.parse(readFileSync(join(hooksDir, name), 'utf8')) as Record<string, unknown>);
    };

    await test.step('Novo › Hooks opens the editor; saving stores the hook in Global', async () => {
      await page.getByTestId('control-panel-new').click();
      await page.getByTestId('control-panel-new-hook').click();
      const dialog = page.getByTestId('hook-editor-dialog');
      await expect(dialog).toBeVisible();
      await page.getByTestId('hook-editor-event').getByRole('combobox').click();
      await page.getByRole('option', { name: 'PreToolUse' }).click();
      await page.getByTestId('hook-editor-matcher').getByRole('textbox').fill('Bash');
      await page.getByTestId('hook-editor-command').getByRole('textbox').fill('./check.sh');
      await page.getByTestId('hook-editor-save').click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => savedHook()?.['matcher']).toBe('Bash');
    });

    await test.step('Editar changes the matcher on disk', async () => {
      await page.getByTestId('control-panel-section-global').click();
      // The row names the hook by its event and script: `PreToolUse · check`.
      const row = page.locator('[data-testid^="tree-row-global:"]').filter({ hasText: 'PreToolUse · check' });
      await expect(row).toBeVisible();
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Editar' }).click();
      const matcher = page.getByTestId('hook-editor-matcher').getByRole('textbox');
      await expect(matcher).toHaveValue('Bash');
      await matcher.fill('Bash|Edit');
      await page.getByTestId('hook-editor-save').click();
      await expect(page.getByTestId('hook-editor-dialog')).toBeHidden();
      await expect.poll(() => savedHook()?.['matcher']).toBe('Bash|Edit');
      await page.getByTestId('control-panel-section-global').click();
    });
  });

  test('A plugin lists what it ships under its row; turning it off marks its items desativado', async () => {
    const { page } = session;

    await test.step('importing the plugin lists it once, in Plugins', async () => {
      await page.getByTestId('control-panel-new').click();
      await page.getByTestId('control-panel-new-plugin').click();
      await page.getByTestId('plugin-url-input').locator('input').fill(pluginUrl);
      await page.getByTestId('plugin-import-btn').click();
      await expect(page.getByTestId('plugin-import-dialog')).toBeHidden({ timeout: 30_000 });
      await expect(page.getByTestId('tree-group-plugin')).toContainText('Plugins');
    });

    const pluginRow = page.locator('[data-testid$=":urn:plugin:demo-plugin"]');
    const greet = page.locator('[data-testid$=":urn:skill:greet"]');
    await test.step('its skill is not in Skills; opening the plugin and its Skills sub-header lists it', async () => {
      await expect(greet).toHaveCount(0);
      await pluginRow.click();
      await page.getByTestId('tree-plugin-kind-demo-plugin-skill').click();
      await expect(greet).toBeVisible();
    });

    await test.step('Desativar keeps the skill listed and marks it desativado', async () => {
      await pluginRow.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Desativar' }).click();
      await pluginRow.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: 'Ativar' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(greet).toBeVisible();
      await expect(greet.getByTestId('row-tag-disabled')).toHaveText('Desativado');
    });
  });
});
