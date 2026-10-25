import { test, type ElectronApplication, type Page } from '@playwright/test';
import { launch, seedDemo, shot, stubFolderPicker, widenExplorer, withHighlight, type Demo } from './lib.js';

let app: ElectronApplication;
let page: Page;
let demo: Demo;

test.beforeAll(async () => {
  demo = seedDemo();
  ({ app, page } = await launch(demo));
});

test.afterAll(async () => {
  await app?.close();
});

test('getting-started: first launch and opening a folder', async () => {
  await shot(page, 'getting-started', '01-home');
  await stubFolderPicker(app, demo.workspace);
  const open = page.getByRole('button', { name: 'Abrir pasta…' });
  await withHighlight(page, open, '1', () => shot(page, 'getting-started', '02-open-folder'));
  await open.click();
  await page.waitForSelector('[data-testid="workspace-screen"]');
  await widenExplorer(page);
  await shot(page, 'getting-started', '03-workspace-opened');
});

test('create-skills-and-agents: create and save a skill', async () => {
  const guide = 'create-skills-and-agents';
  const newButton = page.getByTestId('control-panel-new');
  await withHighlight(page, newButton, '1', () => shot(page, guide, '01-new-button'));
  await newButton.click();
  const skillItem = page.getByRole('menuitem', { name: 'Skill' });
  await withHighlight(page, skillItem, '2', () => shot(page, guide, '02-new-menu'));
  await skillItem.click();

  await page.getByLabel('Name').fill('review-pr');
  await page.getByLabel('Description').fill('Use when the user asks for a pull request review: check correctness first, style last.');
  await shot(page, guide, '03-properties');
  await page.getByRole('button', { name: 'Fechar' }).click();

  await page.locator('.cm-content').click();
  await page.keyboard.insertText('# Review a pull request\n\nRead the diff end to end.\nReport correctness bugs first.\nMention style only when it hides a bug.\n');
  await shot(page, guide, '04-editor');
  await page.keyboard.press('Meta+s');
  await page.getByText('review-pr').first().waitFor();
  await shot(page, guide, '05-saved');
});

test('use-the-git-panel: review and commit', async () => {
  const guide = 'use-the-git-panel';
  await page.getByText('src', { exact: true }).first().click();
  const file = page.getByText('index.js', { exact: true }).first();
  await file.waitFor();
  await file.click({ button: 'right' });
  await withHighlight(page, page.getByRole('menuitem', { name: /Abrir diff/ }).first(), '1', () => shot(page, guide, '01-file-menu'));
  await page.getByRole('menuitem', { name: /Abrir diff/ }).first().click();
  await shot(page, guide, '02-diff');
  const commit = page.getByTestId('git-commit-open');
  await page.getByTestId('git-stage-all').click();
  await withHighlight(page, commit, '1', () => shot(page, guide, '03-toolbar-staged'));
  await commit.click();
  await page.getByTestId('git-commit-message').fill('Add routes module and startup log');
  await shot(page, guide, '04-commit-popover');
  await page.keyboard.press('Escape');
});

test('use-terminals: open a terminal', async () => {
  const guide = 'use-terminals';
  const menu = page.getByTestId('terminals-new-menu');
  await withHighlight(page, menu, '1', () => shot(page, guide, '01-new-terminal'));
  await menu.click();
  await shot(page, guide, '02-menu');
  await page.getByTestId('terminals-menu-root').click();
  await page.waitForSelector('.xterm');
  await page.waitForTimeout(1200);
  // The default zsh prompt prints the machine's hostname; swap it before capturing.
  await page.keyboard.type("PS1='$ '; clear; ls\n");
  await page.waitForTimeout(800);
  await shot(page, guide, '03-terminal-open');
});

test('workspaces: switcher menu', async () => {
  const switcher = page.getByTestId('context-switcher');
  await withHighlight(page, switcher, '1', async () => {
    await switcher.click();
    await shot(page, 'manage-workspaces', '01-switcher');
  });
  await page.getByRole('menuitem', { name: 'Início' }).click();
  await page.getByTestId('explorer-area-diagnostico').waitFor();
});

test('settings', async () => {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-screen').waitFor();
  await shot(page, 'settings', '01-settings');
  await page.getByRole('button', { name: 'Voltar' }).click();
});

test('home areas: diagnostics, marketplaces, starter pack', async () => {
  for (const [area, guide] of [
    ['diagnostico', 'diagnose-and-reset'],
    ['marketplaces', 'install-plugins-and-marketplaces'],
    ['starter-pack', 'starter-pack'],
  ] as const) {
    const nav = page.getByTestId(`explorer-area-${area}`);
    await withHighlight(page, nav, '1', async () => {
      await nav.click();
      await shot(page, guide, `01-${area}`);
    });
  }
});
