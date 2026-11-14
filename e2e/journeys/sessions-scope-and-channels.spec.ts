import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, launchApp, seedGitWorkspace, seedWorkspaceRegistry, writeFile, type AppSession } from '../fixtures/app.js';

// Journey: the parts of the sessions mechanism that sit around the lifecycle — answering a permission prompt over
// IPC, a workspace being deleted or re-folded while its sessions run in the background, the history merging by
// conversation id, and the other two channels (Cursor, LM Studio). Every CLI is the interactive stub
// (fixtures/cli-stubs.ts); the PTY, signal file, state machine and IPC are the real ones.

interface SnapshotDto {
  sessionId: string;
  conversationId: string;
  scopeId: string | null;
  harness: string;
  label: string;
  status: 'running' | 'exited';
  activity?: 'needs-input' | 'working' | 'idle';
  permissionRequest?: { tool: string; command: string };
}
interface WithOutput extends SnapshotDto {
  outputBuffer: string;
}
interface HistoryEntryDto {
  conversationId: string;
  title?: string;
}

let session: AppSession;
let acmeRoot: string;
let betaRoot: string;

const call = <T>(method: string, params?: unknown): Promise<T> => session.call<T>(method, params);
const list = (): Promise<SnapshotDto[]> => call<SnapshotDto[]>('session.list');
const find = async (id: string): Promise<SnapshotDto | undefined> => (await list()).find((s) => s.sessionId === id);
const output = async (id: string): Promise<string> => (await call<WithOutput>('session.status', { sessionId: id }))?.outputBuffer ?? '';
const spawn = (workspaceId: string, harness = 'claude'): Promise<WithOutput> =>
  call<WithOutput>('session.spawn', { anchor: { kind: 'workspace', workspaceId }, harness });
const type = (id: string, data: string): Promise<void> => call('session.write', { sessionId: id, data });
const idle = async (workspaceId: string, harness = 'claude'): Promise<WithOutput> => {
  const s = await spawn(workspaceId, harness);
  await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('idle');
  return s;
};

test.beforeAll(async () => {
  session = await launchApp({
    cli: {
      claude: { signedIn: true, interactive: true },
      'cursor-agent': { signedIn: true, interactive: true },
      lms: { signedIn: true, interactive: true },
    },
    settings: { adapters: { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: true } } },
    seed: (home) => {
      acmeRoot = join(home, 'Projects', 'acme-api');
      betaRoot = join(home, 'Projects', 'beta-web');
      seedGitWorkspace(acmeRoot);
      seedGitWorkspace(betaRoot);
      seedWorkspaceRegistry(
        home,
        [
          { id: 'acme', name: 'acme-api', rootPath: acmeRoot },
          { id: 'beta', name: 'beta-web', rootPath: betaRoot },
        ],
        'acme',
      );
    },
  });
});

test.afterAll(async () => {
  await session?.close();
});

test.describe('answering a permission prompt', () => {
  test('allow and deny reach the waiting hook and the session goes back to work', async () => {
    const s = await idle('acme');
    for (const decision of ['allow', 'deny'] as const) {
      await type(s.sessionId, 'perm\r');
      await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('needs-input');
      expect((await find(s.sessionId))?.permissionRequest).toMatchObject({ tool: 'Bash', command: 'npm test' });

      await call('session.answerPermission', { sessionId: s.sessionId, decision });
      await expect.poll(() => output(s.sessionId)).toContain(`decision: ${decision}`);
      await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('idle');
      expect((await find(s.sessionId))?.permissionRequest).toBeUndefined();
    }
  });

  test('is refused when nothing is waiting, when the prompt came from a plain notification, and for a bad decision', async () => {
    const s = await idle('acme');
    await expect(call('session.answerPermission', { sessionId: s.sessionId, decision: 'allow' })).rejects.toThrow(/permissão/);

    // `ask` raises the CLI's own prompt (a notification): there is no hook to answer, so the app must not pretend to.
    await type(s.sessionId, 'ask\r');
    await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('needs-input');
    await expect(call('session.answerPermission', { sessionId: s.sessionId, decision: 'allow' })).rejects.toThrow(/permissão/);

    await expect(call('session.answerPermission', { sessionId: s.sessionId, decision: 'maybe' })).rejects.toThrow(/decision/);
  });

  test('is refused for an ended session', async () => {
    const s = await idle('acme');
    await call('session.kill', { sessionId: s.sessionId });
    await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');
    await expect(call('session.answerPermission', { sessionId: s.sessionId, decision: 'allow' })).rejects.toThrow(/Unknown or ended/);
  });
});

test.describe('a workspace changing under its running sessions', () => {
  test('deleting a workspace ends its sessions only, even while another one is open', async () => {
    const doomed = await idle('beta');
    const survivor = await idle('acme');

    await call('workspace.delete', { id: 'beta' });

    await expect.poll(async () => (await find(doomed.sessionId))?.status).toBe('exited');
    expect((await find(survivor.sessionId))?.status).toBe('running');
  });

  test('adding a folder ends that workspace sessions (they keep the folders they started with)', async () => {
    const extra = join(session.home, 'Projects', 'shared-lib');
    mkdirSync(extra, { recursive: true });
    writeFile(join(extra, 'README.md'), '# shared-lib\n');

    const inAcme = await idle('acme');
    await call('workspace.addFolder', { id: 'acme', path: extra });

    await expect.poll(async () => (await find(inAcme.sessionId))?.status).toBe('exited');
    // …and the app is still usable: a new session starts on the new folder set.
    const fresh = await idle('acme');
    expect(fresh.status).toBe('running');
  });
});

test.describe('history merging by conversation id', () => {
  const transcript = (cwd: string, title: string): string =>
    [
      JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'hi' }, timestamp: new Date().toISOString() }),
      JSON.stringify({ type: 'ai-title', aiTitle: title }),
    ].join('\n') + '\n';
  const writeTranscript = (conversationId: string, cwd: string, title: string): void =>
    writeFile(join(session.home, '.claude', 'projects', 'e2e-acme', `${conversationId}.jsonl`), transcript(cwd, title));
  const listHistory = (): Promise<{ entries: HistoryEntryDto[] }> =>
    call('sessionHistory.list', { scope: { kind: 'workspace', workspaceId: 'acme' }, limit: 50 });

  test('a running session and its transcript are one row, wearing the CLI title', async () => {
    const { page } = session;
    const s = await idle('acme');
    // `~/.claude/projects` did not exist when the app started: the title watcher has to notice it appearing.
    writeTranscript(s.conversationId, acmeRoot, 'Fix the login redirect');
    const pastId = '22222222-3333-4444-8555-666666666666';
    writeTranscript(pastId, acmeRoot, 'Past work');

    await expect.poll(async () => (await listHistory()).entries.map((e) => e.conversationId)).toContain(s.conversationId);
    // The real CLI re-appends its title every turn; rewriting it here stands for the next turn.
    await expect
      .poll(
        async () => {
          writeTranscript(s.conversationId, acmeRoot, 'Fix the login redirect');
          return (await find(s.sessionId))?.label;
        },
        { timeout: 20_000, intervals: [1000] },
      )
      .toBe('Fix the login redirect');
    await page.reload();
    await page.waitForSelector('[data-testid="workspace-screen"]');

    await expect(page.getByTestId(`tree-session-${s.sessionId}`)).toContainText('Fix the login redirect');
    // The past conversation proves the history loaded; the live one is not repeated under its conversation id.
    await expect(page.getByTestId(`tree-session-${pastId}`)).toContainText('Past work');
    await expect(page.getByTestId(`tree-session-${s.conversationId}`)).toHaveCount(0);
  });

  test('a transcript with no live session is listed, and resuming it adopts the conversation as a running session', async () => {
    const conversationId = '11111111-2222-4333-8444-555555555555';
    writeTranscript(conversationId, acmeRoot, 'Old refactor');
    await expect.poll(async () => (await listHistory()).entries.map((e) => e.conversationId)).toContain(conversationId);

    const adopted = await call<WithOutput>('sessionHistory.resume', { conversationId });
    expect(adopted.conversationId).toBe(conversationId);
    expect(adopted.status).toBe('running');
    expect(adopted.label).toBe('Old refactor');
    await expect.poll(() => output(adopted.sessionId)).toContain('stub-claude ready');
  });

  test('resuming a conversation that has no transcript is a not_found, not a crash', async () => {
    await expect(call('sessionHistory.resume', { conversationId: '99999999-0000-4000-8000-000000000000' })).rejects.toThrow(/No transcript/);
  });
});

test.describe('Cursor', () => {
  test('spawns a cursor-agent session on a chat id minted by create-chat', async () => {
    const s = await spawn('acme', 'cursor');
    expect(s.harness).toBe('cursor');
    expect(s.conversationId).toMatch(/^[0-9A-F-]{36}$/i);
    await expect.poll(() => output(s.sessionId)).toContain('stub-cursor-agent ready');
  });

  for (const command of ['/clear', '/new']) {
    test(`typing ${command} replaces the session with a fresh one (detected from the keystrokes)`, async () => {
      const s = await idle('acme', 'cursor');
      const before = (await list()).map((x) => x.sessionId);

      await type(s.sessionId, `${command}\r`);

      await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');
      await expect.poll(async () => (await list()).filter((x) => !before.includes(x.sessionId)).length).toBe(1);
      const next = (await list()).find((x) => !before.includes(x.sessionId));
      expect(next).toMatchObject({ harness: 'cursor', status: 'running', label: 'Untitled' });
      expect(next?.conversationId).not.toBe(s.conversationId);
    });
  }

  test('a /clear the detector cannot be sure about leaves the session alone', async () => {
    const s = await idle('acme', 'cursor');
    const before = (await list()).length;

    await type(s.sessionId, '/clear please\r'); // not exactly the command
    await type(s.sessionId, '\x1b[A/clear\r'); // an arrow key poisons the line
    await type(s.sessionId, '/clea\x7f\x7f\x7fbye\r'); // backspaced into "/cbye"
    await expect.poll(() => output(s.sessionId)).toContain('echo: /cbye');

    expect((await find(s.sessionId))?.status).toBe('running');
    expect((await list()).length).toBe(before);
  });

  test('an edited line that ends up exactly /clear still counts', async () => {
    const s = await idle('acme', 'cursor');
    await type(s.sessionId, '/clearx\x7f\r');
    await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');
  });

  test('Claude has no typing detector: its /clear is the CLI hook, so typed text alone changes nothing', async () => {
    const s = await idle('acme');
    // The stub treats `/clear` as the hook would; a line that is not exactly it must not end the session.
    await type(s.sessionId, '/clear now\r');
    await expect.poll(() => output(s.sessionId)).toContain('echo: /clear now');
    expect((await find(s.sessionId))?.status).toBe('running');
  });
});

test.describe('LM Studio', () => {
  test('runs `lms chat` as a plain session: no hooks, so it never reports working or a question', async () => {
    const s = await spawn('acme', 'lmstudio');
    expect(s).toMatchObject({ harness: 'lmstudio', status: 'running' });
    await expect.poll(() => output(s.sessionId)).toContain('stub-lms ready');

    await type(s.sessionId, 'hello\r');
    await expect.poll(() => output(s.sessionId)).toContain('echo: hello');
    // The stub writes working/idle lines, but this channel has no hook wiring, so they are never read.
    const seen = new Set<string | undefined>();
    for (let i = 0; i < 5; i += 1) {
      seen.add((await find(s.sessionId))?.activity);
      await session.page.waitForTimeout(150);
    }
    expect([...seen]).not.toContain('working');
    expect([...seen]).not.toContain('needs-input');
  });

  test('"resume" opens a fresh chat: same session, running again', async () => {
    const s = await spawn('acme', 'lmstudio');
    await call('session.kill', { sessionId: s.sessionId });
    await expect.poll(async () => (await find(s.sessionId))?.status).toBe('exited');

    const resumed = await call<WithOutput>('session.resume', { sessionId: s.sessionId });
    expect(resumed.sessionId).toBe(s.sessionId);
    expect(resumed.status).toBe('running');
    await expect.poll(() => output(s.sessionId)).toContain('stub-lms ready');
  });
});

test.describe('choosing the channel in the UI', () => {
  test('with more than one channel available, + asks which one and starts it', async () => {
    const { page } = session;
    await call('workspace.switchTo', { id: 'acme' });
    await page.reload();
    await page.waitForSelector('[data-testid="workspace-screen"]');
    const before = (await list()).map((x) => x.sessionId);

    await page.getByTestId('workspace-sessions-new').click();
    await expect(page.getByTestId('new-session-dialog')).toBeVisible();
    await page.getByTestId('new-session-harness-cursor').click();
    await page.getByTestId('new-session-start').click();

    await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
    await expect.poll(async () => (await list()).filter((x) => !before.includes(x.sessionId)).length).toBe(1);
    const created = (await list()).find((x) => !before.includes(x.sessionId));
    expect(created?.harness).toBe('cursor');
  });

  test('Cancelar closes the dialog without starting anything', async () => {
    const { page } = session;
    const before = (await list()).length;
    await page.getByTestId('workspace-sessions-new').click();
    await expect(page.getByTestId('new-session-dialog')).toBeVisible();
    await page.getByTestId('new-session-cancel').click();
    await expect(page.getByTestId('new-session-dialog')).toHaveCount(0);
    expect((await list()).length).toBe(before);
  });
});
