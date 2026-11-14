import { test } from '@playwright/test';
import { join } from 'node:path';
import { expect, launchApp, seedGitWorkspace, seedWorkspaceRegistry, type AppSession } from '../fixtures/app.js';

// Journey: the same sessions mechanism, driven through the screen instead of IPC — the + button, the row's
// Encerrar / Apagar (with its undo window), minimizing a tab and bringing it back, and answering a permission
// prompt from the list. The CLI is the interactive stub (fixtures/cli-stubs.ts), so the PTY and signal chain are real.

interface SnapshotDto {
  sessionId: string;
  status: 'running' | 'exited';
  activity?: 'needs-input' | 'working' | 'idle';
}

let session: AppSession;

const call = <T>(method: string, params?: unknown): Promise<T> => session.call<T>(method, params);
const list = (): Promise<SnapshotDto[]> => call<SnapshotDto[]>('session.list');
const find = async (id: string): Promise<SnapshotDto | undefined> => (await list()).find((s) => s.sessionId === id);
const type = (id: string, line: string): Promise<void> => call('session.write', { sessionId: id, data: `${line}\r` });

test.beforeAll(async () => {
  session = await launchApp({
    cli: { claude: { signedIn: true, interactive: true } },
    settings: { sessions: { inlineAnswer: true } },
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

/** Row actions only show while the row is hovered (or focused). */
const hoverRow = (id: string): Promise<void> => session.page.getByTestId(`tree-session-${id}`).hover();

/** Starts a session with the panel's + button and returns the one it created. */
const startFromUi = async (): Promise<SnapshotDto> => {
  const before = (await list()).map((s) => s.sessionId);
  await session.page.getByTestId('workspace-sessions-new').click();
  await expect.poll(async () => (await list()).filter((s) => !before.includes(s.sessionId)).length).toBe(1);
  const created = (await list()).find((s) => !before.includes(s.sessionId))!;
  await expect.poll(async () => (await find(created.sessionId))?.activity).toBe('idle');
  return created;
};

test('the + button starts a session straight away (one channel, one folder) and opens its tab', async () => {
  const { page } = session;
  const created = await startFromUi();

  await expect(page.getByTestId(`workbench-tab-session:${created.sessionId}`)).toBeVisible();
  await expect(page.locator('[data-testid="session-panel"]:visible')).toHaveCount(1);
  await expect(page.getByTestId(`tree-session-${created.sessionId}`)).toBeVisible();
  await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
});

test('a row is "Untitled" with no model until the first prompt, then takes the CLI title and model', async () => {
  const { page } = session;
  const created = await startFromUi();
  const row = page.getByTestId(`tree-session-${created.sessionId}`);

  await expect(row).toContainText('Untitled');
  await expect(row).not.toContainText('Iniciando');

  await type(created.sessionId, 'Fix the login bug');
  await expect(row).toContainText('Fix the login bug');
  await expect(page.getByTestId(`workbench-tab-session:${created.sessionId}`)).toContainText('Fix the login bug');
  await expect(row).not.toContainText('Untitled');
  await expect(row).not.toContainText('Iniciando');
});

test('Encerrar stops the session and leaves a row that can only be deleted', async () => {
  const { page } = session;
  const created = await startFromUi();

  await hoverRow(created.sessionId);
  await page.getByTestId(`tree-session-stop-${created.sessionId}`).click();
  await expect.poll(async () => (await find(created.sessionId))?.status).toBe('exited');

  await expect(page.getByTestId(`tree-session-stop-${created.sessionId}`)).toHaveCount(0);
  await hoverRow(created.sessionId);
  await expect(page.getByTestId(`tree-session-remove-${created.sessionId}`)).toBeVisible();
});

test('Apagar hides the row at once, Desfazer brings it back, and otherwise it is really removed', async () => {
  const { page } = session;

  await test.step('undo within the window keeps the session', async () => {
    const created = await startFromUi();
    await call('session.kill', { sessionId: created.sessionId });
    await hoverRow(created.sessionId);
    await expect(page.getByTestId(`tree-session-remove-${created.sessionId}`)).toBeVisible();

    await page.getByTestId(`tree-session-remove-${created.sessionId}`).click();
    await expect(page.getByTestId(`tree-session-${created.sessionId}`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Desfazer' }).click();

    await expect(page.getByTestId(`tree-session-${created.sessionId}`)).toBeVisible();
    expect(await find(created.sessionId)).toBeDefined();
  });

  await test.step('without undo it is forgotten once the window closes', async () => {
    const created = await startFromUi();
    await call('session.kill', { sessionId: created.sessionId });
    await hoverRow(created.sessionId);
    await page.getByTestId(`tree-session-remove-${created.sessionId}`).click();
    await expect(page.getByTestId(`tree-session-${created.sessionId}`)).toHaveCount(0);

    await expect.poll(async () => find(created.sessionId), { timeout: 10_000 }).toBeUndefined();
  });
});

test('closing a running session tab only minimizes it: the process lives and the row reopens it', async () => {
  const { page } = session;
  const created = await startFromUi();
  const tab = page.getByTestId(`workbench-tab-session:${created.sessionId}`);
  await expect(tab).toBeVisible();

  await page.getByTestId(`workbench-tab-close-session:${created.sessionId}`).click();
  await expect(tab).toHaveCount(0);
  expect((await find(created.sessionId))?.status).toBe('running');

  await page.getByTestId(`tree-session-${created.sessionId}`).click();
  await expect(tab).toBeVisible();
  await expect(page.locator('[data-testid="session-panel"]:visible')).toHaveCount(1);
});

test('with inline answer on, the list shows the permission request and Permitir unblocks the session', async () => {
  const { page } = session;
  const created = await startFromUi();

  await type(created.sessionId, 'perm');
  const inline = page.getByTestId(`inline-permission-${created.sessionId}`);
  await expect(inline).toBeVisible();
  await expect(inline.getByTestId('inline-permission-command')).toContainText('npm test');

  await inline.getByTestId('inline-permission-allow').click();
  await expect(inline).toHaveCount(0);
  await expect
    .poll(async () => (await call<{ outputBuffer: string }>('session.status', { sessionId: created.sessionId }))?.outputBuffer)
    .toContain('decision: allow');
  await expect.poll(async () => (await find(created.sessionId))?.activity).toBe('idle');
});

test('Negar answers the same prompt with deny', async () => {
  const { page } = session;
  const created = await startFromUi();

  await type(created.sessionId, 'perm');
  const inline = page.getByTestId(`inline-permission-${created.sessionId}`);
  await expect(inline).toBeVisible();

  await inline.getByTestId('inline-permission-deny').click();
  await expect
    .poll(async () => (await call<{ outputBuffer: string }>('session.status', { sessionId: created.sessionId }))?.outputBuffer)
    .toContain('decision: deny');
});
