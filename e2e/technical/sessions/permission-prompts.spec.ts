import { expect, test } from '@playwright/test';
import { useSessionsApp } from '../../fixtures/sessions-app.js';

const app = useSessionsApp();
const { call, find, idle, output, type } = app;

test.describe('Sessions › answering a permission request', () => {
  test('Allow and Deny reach the waiting CLI, and the session goes back to work', async () => {
    const s = await idle('acme');
    for (const decision of ['allow', 'deny'] as const) {
      await type(s.sessionId, 'perm\r');
      await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('needs-input');
      expect((await find(s.sessionId))?.permissionRequest).toMatchObject({
        tool: 'Bash',
        command: 'npm test',
      });

      await call('session.answerPermission', { sessionId: s.sessionId, decision });
      await expect.poll(() => output(s.sessionId)).toContain(`decision: ${decision}`);
      await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('idle');
      expect((await find(s.sessionId))?.permissionRequest).toBeUndefined();
    }
  });

  test('Answering is refused when nothing is waiting, when the CLI only sent a notification, and for an unknown decision', async () => {
    const s = await idle('acme');
    await expect(
      call('session.answerPermission', { sessionId: s.sessionId, decision: 'allow' }),
    ).rejects.toThrow(/permissão/);

    // `ask` raises the CLI's own prompt (a notification): there is no hook to answer, so the app must not pretend to.
    await type(s.sessionId, 'ask\r');
    await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('needs-input');
    await expect(
      call('session.answerPermission', { sessionId: s.sessionId, decision: 'allow' }),
    ).rejects.toThrow(/permissão/);

    await expect(
      call('session.answerPermission', { sessionId: s.sessionId, decision: 'maybe' }),
    ).rejects.toThrow(/decision/);
  });

  test('Answering is refused for a session that has ended', async () => {
    const s = await idle('acme');
    await call('session.kill', { sessionId: s.sessionId });
    await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');
    await expect(
      call('session.answerPermission', { sessionId: s.sessionId, decision: 'allow' }),
    ).rejects.toThrow(/Unknown or ended/);
  });
});
