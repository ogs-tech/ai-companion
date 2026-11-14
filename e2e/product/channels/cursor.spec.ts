import { expect, test } from '@playwright/test';
import { useSessionsApp } from '../../fixtures/sessions-app.js';

const app = useSessionsApp();
const { find, idle, list, newSince, output, spawn, type } = app;

test.describe('Channels › Cursor sessions', () => {
  test('Starting a Cursor session opens a new chat in cursor-agent', async () => {
    const s = await spawn('acme', 'cursor');
    expect(s.harness).toBe('cursor');
    expect(s.conversationId).toMatch(/^[0-9A-F-]{36}$/i);
    await expect.poll(() => output(s.sessionId)).toContain('stub-cursor-agent ready');
  });

  for (const command of ['/clear', '/new']) {
    test(`Typing ${command} replaces the session with a fresh one`, async () => {
      const s = await idle('acme', 'cursor');
      const before = (await list()).map((x) => x.sessionId);

      await type(s.sessionId, `${command}\r`);

      await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');
      await expect.poll(async () => (await newSince(before)).length).toBe(1);
      const next = (await newSince(before))[0];
      expect(next).toMatchObject({ harness: 'cursor', status: 'running', label: 'Untitled' });
      expect(next?.conversationId).not.toBe(s.conversationId);
    });
  }

  test('A line that only looks like /clear leaves the session alone', async () => {
    const s = await idle('acme', 'cursor');
    const before = (await list()).length;

    await type(s.sessionId, '/clear please\r'); // not exactly the command
    await type(s.sessionId, '\x1b[A/clear\r'); // an arrow key poisons the line
    await type(s.sessionId, '/clea\x7f\x7f\x7fbye\r'); // backspaced into "/cbye"
    await expect.poll(() => output(s.sessionId)).toContain('echo: /cbye');

    expect((await find(s.sessionId))?.status).toBe('running');
    expect((await list()).length).toBe(before);
  });

  test('A line edited until it is exactly /clear still replaces the session', async () => {
    const s = await idle('acme', 'cursor');
    await type(s.sessionId, '/clearx\x7f\r');
    await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');
  });

  test('Claude is the exception: typing /clear text alone does not end its session', async () => {
    const s = await idle('acme');
    // Claude's /clear arrives through the CLI hook, not the keystrokes; a line that is not exactly it changes nothing.
    await type(s.sessionId, '/clear now\r');
    await expect.poll(() => output(s.sessionId)).toContain('echo: /clear now');
    expect((await find(s.sessionId))?.status).toBe('running');
  });
});
