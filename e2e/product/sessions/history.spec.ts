import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { writeFile } from '../../fixtures/app.js';
import { useSessionsApp, type SnapshotWithOutput } from '../../fixtures/sessions-app.js';

const app = useSessionsApp();
const { call, find, idle, output } = app;

interface HistoryEntryDto {
  conversationId: string;
  title?: string;
}

const transcript = (cwd: string, title: string): string =>
  [
    JSON.stringify({
      type: 'user',
      cwd,
      message: { role: 'user', content: 'hi' },
      timestamp: new Date().toISOString(),
    }),
    JSON.stringify({ type: 'ai-title', aiTitle: title }),
  ].join('\n') + '\n';
const writeTranscript = (conversationId: string, cwd: string, title: string): void =>
  writeFile(
    join(app.session.home, '.claude', 'projects', 'e2e-acme', `${conversationId}.jsonl`),
    transcript(cwd, title),
  );
const listHistory = (): Promise<{ entries: HistoryEntryDto[] }> =>
  call('sessionHistory.list', { scope: { kind: 'workspace', workspaceId: 'acme' }, limit: 50 });

test.describe('Sessions › history of past conversations', () => {
  test('A running session and its saved conversation show as one row, titled by the CLI', async () => {
    const { page } = app.session;
    const s = await idle('acme');
    // `~/.claude/projects` did not exist when the app started: the title watcher has to notice it appearing.
    writeTranscript(s.conversationId, app.acmeRoot, 'Fix the login redirect');
    const pastId = '22222222-3333-4444-8555-666666666666';
    writeTranscript(pastId, app.acmeRoot, 'Past work');

    await expect
      .poll(async () => (await listHistory()).entries.map((e) => e.conversationId))
      .toContain(s.conversationId);
    // The real CLI re-appends its title every turn; rewriting it here stands for the next turn.
    await expect
      .poll(
        async () => {
          writeTranscript(s.conversationId, app.acmeRoot, 'Fix the login redirect');
          return (await find(s.sessionId))?.label;
        },
        { timeout: 20_000, intervals: [1000] },
      )
      .toBe('Fix the login redirect');
    await page.reload();
    await page.waitForSelector('[data-testid="workspace-screen"]');

    await expect(page.getByTestId(`tree-session-${s.sessionId}`)).toContainText(
      'Fix the login redirect',
    );
    // The past conversation proves the history loaded; the live one is not repeated under its conversation id.
    await expect(page.getByTestId(`tree-session-${pastId}`)).toContainText('Past work');
    await expect(page.getByTestId(`tree-session-${s.conversationId}`)).toHaveCount(0);
  });

  test('A past conversation with no live session is listed, and resuming it starts a running session', async () => {
    const conversationId = '11111111-2222-4333-8444-555555555555';
    writeTranscript(conversationId, app.acmeRoot, 'Old refactor');
    await expect
      .poll(async () => (await listHistory()).entries.map((e) => e.conversationId))
      .toContain(conversationId);

    const adopted = await call<SnapshotWithOutput>('sessionHistory.resume', { conversationId });
    expect(adopted.conversationId).toBe(conversationId);
    expect(adopted.status).toBe('running');
    expect(adopted.label).toBe('Old refactor');
    await expect.poll(() => output(adopted.sessionId)).toContain('stub-claude ready');
  });

  test('Resuming a conversation that has no saved history shows a clear error', async () => {
    await expect(
      call('sessionHistory.resume', { conversationId: '99999999-0000-4000-8000-000000000000' }),
    ).rejects.toThrow(/No transcript/);
  });
});
