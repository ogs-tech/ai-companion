import { expect, test } from '@playwright/test';
import { useSessionsApp, type SnapshotWithOutput } from '../../fixtures/sessions-app.js';

const app = useSessionsApp();
const { call, find, output, spawn, type } = app;

test.describe('Channels › LM Studio sessions', () => {
  test('A session is a plain chat: LM Studio has no hooks, so it never shows "working" or "needs you"', async () => {
    const s = await spawn('acme', 'lmstudio');
    expect(s).toMatchObject({ harness: 'lmstudio', status: 'running' });
    await expect.poll(() => output(s.sessionId)).toContain('stub-lms ready');

    await type(s.sessionId, 'hello\r');
    await expect.poll(() => output(s.sessionId)).toContain('echo: hello');
    // The stub writes working/idle lines, but this channel has no hook wiring, so they are never read.
    const seen = new Set<string | undefined>();
    for (let i = 0; i < 5; i += 1) {
      seen.add((await find(s.sessionId))?.activity);
      await app.session.page.waitForTimeout(150);
    }
    expect([...seen]).not.toContain('working');
    expect([...seen]).not.toContain('needs-input');
  });

  test('Resuming opens a fresh chat in the same session', async () => {
    const s = await spawn('acme', 'lmstudio');
    await call('session.kill', { sessionId: s.sessionId });
    await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');

    const resumed = await call<SnapshotWithOutput>('session.resume', { sessionId: s.sessionId });
    expect(resumed.sessionId).toBe(s.sessionId);
    expect(resumed.status).toBe('running');
    await expect.poll(() => output(s.sessionId)).toContain('stub-lms ready');
  });
});
