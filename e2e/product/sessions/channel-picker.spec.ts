import { expect, test } from '@playwright/test';
import { useSessionsApp } from '../../fixtures/sessions-app.js';

const app = useSessionsApp();
const { call, list, newSince } = app;

test.describe('Sessions › choosing a channel for a new session', () => {
  test('With more than one channel available, + asks which one and starts it', async () => {
    const { page } = app.session;
    await call('workspace.switchTo', { id: 'acme' });
    await page.reload();
    await page.waitForSelector('[data-testid="workspace-screen"]');
    const before = (await list()).map((x) => x.sessionId);

    await page.getByTestId('workspace-sessions-new').click();
    await expect(page.getByTestId('new-session-dialog')).toBeVisible();
    await page.getByTestId('new-session-harness-cursor').click();
    await page.getByTestId('new-session-start').click();

    await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
    await expect.poll(async () => (await newSince(before)).length).toBe(1);
    expect((await newSince(before))[0]?.harness).toBe('cursor');
  });

  test('Cancelar closes the dialog without starting anything', async () => {
    const { page } = app.session;
    const before = (await list()).length;
    await page.getByTestId('workspace-sessions-new').click();
    await expect(page.getByTestId('new-session-dialog')).toBeVisible();
    await page.getByTestId('new-session-cancel').click();
    await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
    expect((await list()).length).toBe(before);
  });
});
