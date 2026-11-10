import { test } from '@playwright/test';
import { join } from 'node:path';
import { expect, launchApp, seedGitWorkspace, seedWorkspaceRegistry, writeCliStubs, type AppSession } from '../fixtures/app.js';
import { realBinaryOnHost } from '../fixtures/cli-stubs.js';

// Journey: Config > Canais walks Cursor from "not installed" → "installed, no account" → "signed in" → "enabled"
// → "disabled"; then a terminal opens in the workspace and runs a command. The CLIs are stubs on PATH
// (fixtures/cli-stubs.ts), so the result does not depend on what the machine has installed.

let session: AppSession;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  session = await launchApp({
    cli: {}, // an empty stub dir first on PATH: nothing is "installed" until the journey writes a stub
    seed: (home) => {
      const root = join(home, 'Projects', 'acme-api');
      seedGitWorkspace(root);
      seedWorkspaceRegistry(home, [{ id: 'acme', name: 'acme-api', rootPath: root }], 'acme');
    },
  });
});

test.afterAll(async () => {
  await session?.close();
});

const openCursorPage = async (): Promise<void> => {
  const { page } = session;
  await page.getByTestId('explorer-view-config').click();
  await page.getByTestId('config-leaf-channel:cursor').click();
  await expect(page.getByTestId('config-page-channel-cursor')).toBeVisible();
};

test('a channel whose CLI is missing offers to install it, and nothing else', async () => {
  test.skip(realBinaryOnHost('cursor-agent'), 'a real cursor-agent is on this machine, so "not installed" cannot be shown');
  const { page } = session;
  await openCursorPage();
  const config = page.getByTestId('config-page-channel-cursor');

  await test.step('says it is not installed and shows the install command', async () => {
    await expect(config.getByText('Cursor não está instalado neste computador.')).toBeVisible();
    await expect(config.getByRole('button', { name: 'Instalar' })).toBeVisible();
    await expect(config.getByText('curl https://cursor.com/install -fsS | bash')).toBeVisible();
  });

  await test.step('offers neither sign-in nor the enable switch yet', async () => {
    await expect(config.getByRole('button', { name: /^Entrar/ })).toHaveCount(0);
    await expect(config.getByRole('checkbox', { name: 'Ativar Cursor' })).toHaveCount(0);
  });
});

test('install → sign in → enable → disable, one step at a time', async () => {
  const { page } = session;

  // The "install" itself happens in a terminal outside this test; the stub stands for its result.
  writeCliStubs(session.stubDir, { 'cursor-agent': { signedIn: false } });
  await page.reload();
  await page.waitForSelector('[data-testid="workspace-screen"]');
  await openCursorPage();
  const config = page.getByTestId('config-page-channel-cursor');

  await test.step('installed but without an account: the next action is Entrar', async () => {
    await expect(config.getByText(/Instalado · 9\.9\.9-e2e · sem conta/)).toBeVisible();
    await expect(config.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(config.getByRole('checkbox', { name: 'Ativar Cursor' })).toHaveCount(0);
  });

  await test.step('signing in runs the command in a visible terminal dialog', async () => {
    await config.getByRole('button', { name: 'Entrar', exact: true }).click();
    const dialog = page.getByTestId('channel-setup-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Concluído.')).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step('the page re-checks and shows the account as connected', async () => {
    await expect(config.getByText(/conta conectada/)).toBeVisible();
    await expect(config.getByRole('button', { name: 'Entrar com outra conta' })).toBeVisible();
  });

  await test.step('enabling the channel from the now-visible switch', async () => {
    const toggle = config.getByRole('checkbox', { name: 'Ativar Cursor' });
    await expect(toggle).not.toBeChecked();
    await toggle.click(); // controlled by async settings, so check() would reject the not-yet-flipped state
    await expect(toggle).toBeChecked();
    const settings = await session.call<{ adapters: { cursor: { enabled: boolean } } }>('settings.get');
    expect(settings.adapters.cursor.enabled).toBe(true);
  });

  await test.step('disabling asks what to do with the synced links, and is reversible by cancelling', async () => {
    const toggle = config.getByRole('checkbox', { name: 'Ativar Cursor' });
    await toggle.click();
    await expect(page.getByRole('dialog', { name: /Desabilitar Cursor/ })).toBeVisible();
    await page.getByTestId('confirm-cancel-btn').click();
    await expect(toggle).toBeChecked();

    await toggle.click();
    await page.getByTestId('confirm-no-remove-btn').click();
    await expect(toggle).not.toBeChecked();
    const settings = await session.call<{ adapters: { cursor: { enabled: boolean } } }>('settings.get');
    expect(settings.adapters.cursor.enabled).toBe(false);
  });
});

test('a terminal opens in the workspace and runs a command', async () => {
  const { page } = session;
  await page.getByTestId('explorer-view-terminals').click();

  await test.step('starts with no terminals', async () => {
    await expect(page.getByTestId('terminals-empty')).toBeVisible();
  });

  await test.step('creating one at the workspace root shows a live terminal', async () => {
    await page.getByTestId('terminals-new-menu').click();
    await page.getByTestId('terminals-menu-root').click();
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('terminals-empty')).toHaveCount(0);
  });

  await test.step('typed input runs in the shell and its output is rendered', async () => {
    await page.locator('.xterm').first().click();
    await page.keyboard.type('echo journey-$((20+22))\n');
    // The typed line also contains "journey-$((20+22))"; only the evaluated result proves the shell ran it.
    await expect(page.locator('.xterm-rows').first()).toContainText('journey-42', { timeout: 15_000 });
  });
});
