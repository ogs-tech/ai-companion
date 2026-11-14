import { test } from '@playwright/test';
import { join } from 'node:path';
import {
  expect,
  launchApp,
  seedGitWorkspace,
  seedWorkspaceRegistry,
  type AppSession,
} from '../../fixtures/app.js';

// Journey: a session the app itself spawns (`session.spawn` → PTY → the channel's CLI), from start to removal.
// The CLI is an interactive stub (fixtures/cli-stubs.ts) that writes the same signal lines the real hooks do, so
// the whole chain — PTY, signal file, state machine, IPC — is the real one. Asserts through `session.list`
// (the persisted-in-memory truth) and the UI marks that render it.

interface SnapshotDto {
  sessionId: string;
  conversationId: string;
  scopeId: string | null;
  label: string;
  status: 'running' | 'exited';
  activity?: 'needs-input' | 'working' | 'idle';
  attention?: { kind: string };
}
interface WithOutput extends SnapshotDto {
  outputBuffer: string;
}

let session: AppSession;
let root: string;

const call = <T>(method: string, params?: unknown): Promise<T> => session.call<T>(method, params);
const list = (): Promise<SnapshotDto[]> => call<SnapshotDto[]>('session.list');
const find = async (id: string): Promise<SnapshotDto | undefined> =>
  (await list()).find((s) => s.sessionId === id);
const spawnIn = (anchor: unknown): Promise<WithOutput> =>
  call<WithOutput>('session.spawn', { anchor, harness: 'claude' });
const type = (id: string, line: string): Promise<void> =>
  call('session.write', { sessionId: id, data: `${line}\r` });

test.beforeAll(async () => {
  session = await launchApp({
    cli: { claude: { signedIn: true, interactive: true } },
    seed: (home) => {
      root = join(home, 'Projects', 'acme-api');
      seedGitWorkspace(root);
      seedWorkspaceRegistry(home, [{ id: 'acme', name: 'acme-api', rootPath: root }], 'acme');
    },
  });
});

test.afterAll(async () => {
  await session?.close();
});

// Every test makes its own session, so any one can run alone (e.g. from the VS Code Playwright extension).
const idleSession = async (
  anchor: unknown = { kind: 'workspace', workspaceId: 'acme' },
): Promise<WithOutput> => {
  const s = await spawnIn(anchor);
  await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('idle');
  return s;
};

test.describe('Sessions › starting and ending a session', () => {
  test(
    'A new session starts idle in its workspace, with its own conversation',
    { tag: '@smoke' },
    async () => {
      let first!: WithOutput;
      await test.step('spawn answers with a running, idle, untitled session', async () => {
        first = await spawnIn({ kind: 'workspace', workspaceId: 'acme' });
        expect(first.status).toBe('running');
        expect(first.label).toBe('Untitled');
        expect(first.scopeId).toBe('acme');
        expect(first.conversationId).toMatch(/^[0-9a-f-]{36}$/);
        await expect.poll(async () => (await find(first.sessionId))?.activity).toBe('idle');
      });

      await test.step('the stub CLI is really running behind the PTY', async () => {
        await expect
          .poll(
            async () =>
              (await call<WithOutput>('session.status', { sessionId: first.sessionId }))
                ?.outputBuffer,
          )
          .toContain('stub-claude ready');
      });
    },
  );

  test('Sending a prompt makes the session work, and it goes idle when the answer is done', async () => {
    const first = await idleSession();
    await type(first.sessionId, 'hello');
    await expect
      .poll(
        async () =>
          (await call<WithOutput>('session.status', { sessionId: first.sessionId }))?.outputBuffer,
      )
      .toContain('echo: hello');
    await expect.poll(async () => (await find(first.sessionId))?.activity).toBe('idle');
  });

  test('A permission request marks the session as needing you, and answering clears it', async () => {
    const first = await idleSession();
    await type(first.sessionId, 'ask');
    await expect.poll(async () => (await find(first.sessionId))?.activity).toBe('needs-input');
    expect((await find(first.sessionId))?.attention?.kind).toBe('permission');

    await type(first.sessionId, 'y');
    await expect.poll(async () => (await find(first.sessionId))?.activity).not.toBe('needs-input');
  });

  test('Several sessions in one workspace run independently', async () => {
    const first = await idleSession();
    const second = await spawnIn({ kind: 'workspace', workspaceId: 'acme' });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.conversationId).not.toBe(first.conversationId);

    await type(second.sessionId, 'ask');
    await expect.poll(async () => (await find(second.sessionId))?.activity).toBe('needs-input');
    expect((await find(first.sessionId))?.activity).not.toBe('needs-input');

    await call('session.remove', { sessionId: second.sessionId });
    expect(await find(second.sessionId)).toBeUndefined();
  });

  test('/clear closes the session, keeps it listed as ended and opens a fresh one', async () => {
    const first = await idleSession();
    const before = (await list()).map((s) => s.sessionId);
    await type(first.sessionId, '/clear');

    await expect.poll(async () => (await find(first.sessionId))?.status).toBe('exited');
    await expect
      .poll(async () => (await list()).filter((s) => !before.includes(s.sessionId)).length)
      .toBe(1);
    const replacement = (await list()).find((s) => !before.includes(s.sessionId));
    expect(replacement?.status).toBe('running');
    expect(replacement?.label).toBe('Untitled');
    expect(replacement?.conversationId).not.toBe(first.conversationId);
  });

  test('A session keeps running when you go to Início and back, and Início has its own sessions', async () => {
    await idleSession();
    const live = (await list()).filter((s) => s.status === 'running');
    expect(live.length).toBeGreaterThan(0);

    await call('workspace.goHome');
    const atHome = await list();
    for (const s of live)
      expect(atHome.find((h) => h.sessionId === s.sessionId)?.status).toBe('running');

    const personal = await spawnIn({ kind: 'personal' });
    expect(personal.scopeId).toBeNull();
    expect(personal.label).toBe('Untitled');

    await call('workspace.switchTo', { id: 'acme' });
    const back = await list();
    expect(back.find((s) => s.sessionId === personal.sessionId)?.status).toBe('running');
    for (const s of live)
      expect(back.find((b) => b.sessionId === s.sessionId)?.status).toBe('running');
  });

  test('Ending a session keeps it listed as ended; resuming brings it back; removing forgets it', async () => {
    const target = await idleSession();

    await call('session.kill', { sessionId: target.sessionId });
    await expect.poll(async () => (await find(target.sessionId))?.status).toBe('exited');

    const resumed = await call<WithOutput>('session.resume', { sessionId: target.sessionId });
    expect(resumed.sessionId).toBe(target.sessionId);
    expect(resumed.conversationId).toBe(target.conversationId);
    expect(resumed.status).toBe('running');

    await call('session.remove', { sessionId: target.sessionId });
    expect(await find(target.sessionId)).toBeUndefined();
  });

  test('The status bar counts sessions that need you, and drops them once answered', async () => {
    const { page } = session;
    await expect(page.getByTestId('status-needs-you')).toHaveCount(0);

    const asking = await spawnIn({ kind: 'workspace', workspaceId: 'acme' });
    await type(asking.sessionId, 'ask');

    await expect(page.getByTestId('status-needs-you')).toHaveText('1 sessão precisa de você');

    await type(asking.sessionId, 'y');
    await expect(page.getByTestId('status-needs-you')).toHaveCount(0);
  });
});
