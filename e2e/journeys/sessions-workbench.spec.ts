import { test } from '@playwright/test';
import { join } from 'node:path';
import { expect, launchApp, seedGitWorkspace, seedWorkspaceRegistry, type AppSession } from '../fixtures/app.js';

// Journey: what the Workbench (tabs, Sessões list, context switcher) does to a session and the other way round.
// A session is a process owned by main; a tab is only a window onto it — so tabs come and go while it lives.

interface SnapshotDto {
  sessionId: string;
  scopeId: string | null;
  status: 'running' | 'exited';
  activity?: 'needs-input' | 'working' | 'idle';
}

let session: AppSession;

const call = <T>(method: string, params?: unknown): Promise<T> => session.call<T>(method, params);
const list = (): Promise<SnapshotDto[]> => call<SnapshotDto[]>('session.list');
const find = async (id: string): Promise<SnapshotDto | undefined> => (await list()).find((s) => s.sessionId === id);
const type = (id: string, line: string): Promise<void> => call('session.write', { sessionId: id, data: `${line}\r` });
const tabOf = (id: string) => session.page.getByTestId(`workbench-tab-session:${id}`);

test.beforeAll(async () => {
  session = await launchApp({
    cli: { claude: { signedIn: true, interactive: true } },
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

/** Clicks "+" and, when `name` is given, sends it as the first prompt so the row takes it as its title (not "Untitled"). */
const startFromUi = async (name?: string): Promise<SnapshotDto> => {
  const before = (await list()).map((s) => s.sessionId);
  await session.page.getByTestId('workspace-sessions-new').click();
  await expect.poll(async () => (await list()).filter((s) => !before.includes(s.sessionId)).length).toBe(1);
  const created = (await list()).find((s) => !before.includes(s.sessionId))!;
  await expect.poll(async () => (await find(created.sessionId))?.activity).toBe('idle');
  if (name !== undefined) {
    await type(created.sessionId, name);
    await expect(session.page.getByTestId(`tree-session-${created.sessionId}`)).toContainText(name, { timeout: 15_000 });
  }
  return created;
};

test('/clear in an open tab swaps it for the fresh session instead of leaving a dead tab', async () => {
  const { page } = session;
  const old = await startFromUi('Session to clear');
  await expect(tabOf(old.sessionId)).toBeVisible();
  const before = (await list()).map((s) => s.sessionId);

  await type(old.sessionId, '/clear');

  await expect.poll(async () => (await list()).filter((s) => !before.includes(s.sessionId)).length).toBe(1);
  const fresh = (await list()).find((s) => !before.includes(s.sessionId))!;
  await expect(tabOf(fresh.sessionId)).toBeVisible();
  await expect(tabOf(old.sessionId)).toHaveCount(0);
  await expect(page.locator('[data-testid="session-panel"]:visible')).toHaveCount(1);
});

test('the row of the session in front is the selected one, and follows the tab switch', async () => {
  const a = await startFromUi('First session');
  const b = await startFromUi('Second session');
  const rowOf = (id: string) => session.page.getByTestId(`tree-session-${id}`);
  // Starting a session brings its tab to the front, so the newest is the one in focus.
  await expect(rowOf(b.sessionId)).toHaveAttribute('aria-current', 'true');
  await expect(rowOf(a.sessionId)).not.toHaveAttribute('aria-current', 'true');

  await tabOf(a.sessionId).click();

  await expect(rowOf(a.sessionId)).toHaveAttribute('aria-current', 'true');
  await expect(rowOf(b.sessionId)).not.toHaveAttribute('aria-current', 'true');
});

test('Encerrar keeps the tab open on the ended session (Fechar, not Minimizar)', async () => {
  const { page } = session;
  const created = await startFromUi();
  await expect(page.getByTestId(`workbench-tab-close-session:${created.sessionId}`)).toHaveAttribute('aria-label', /Minimizar/);

  await page.getByTestId(`tree-session-${created.sessionId}`).hover();
  await page.getByTestId(`tree-session-stop-${created.sessionId}`).click();
  await expect.poll(async () => (await find(created.sessionId))?.status).toBe('exited');

  await expect(tabOf(created.sessionId)).toBeVisible();
  await expect(page.getByTestId(`workbench-tab-close-session:${created.sessionId}`)).toHaveAttribute('aria-label', /Fechar/);
});

test('deleting an ended session from the list closes its open tab', async () => {
  const { page } = session;
  const created = await startFromUi();
  await call('session.kill', { sessionId: created.sessionId });
  await expect.poll(async () => (await find(created.sessionId))?.status).toBe('exited');
  await expect(tabOf(created.sessionId)).toBeVisible();

  await page.getByTestId(`tree-session-${created.sessionId}`).hover();
  await page.getByTestId(`tree-session-remove-${created.sessionId}`).click();

  await expect(tabOf(created.sessionId)).toHaveCount(0);
});

test('going to Início drops the tab but not the process, and its row brings both back', async () => {
  const { page } = session;
  const created = await startFromUi();
  await expect(tabOf(created.sessionId)).toBeVisible();

  await page.getByTestId('context-switcher').click();
  await page.getByTestId('context-switcher-home').click();
  await expect(tabOf(created.sessionId)).toHaveCount(0);
  expect((await find(created.sessionId))?.status).toBe('running');

  // Início lists every conversation on the machine, so the workspace session is there to open.
  await page.getByTestId(`tree-session-${created.sessionId}`).click();
  await expect(tabOf(created.sessionId)).toBeVisible();
  await expect(page.getByTestId('context-switcher')).toContainText('acme-api');
});
