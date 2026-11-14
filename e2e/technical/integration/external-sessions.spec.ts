import { test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, launchApp, type AppSession } from '../../fixtures/app.js';

// External sessions (Claude running in the user's own terminal), end to end:
// the REAL hook commands the app installed into ~/.claude/settings.json run in
// a shell with the CLI's stdin JSON, append to ~/.ai-companion/signals/external,
// and the app's watcher → service → IPC reports the state. Isolated by a temp HOME.

interface ExternalSessionDto {
  id: string;
  cwd: string | null;
  closed: boolean;
  precision: 'measured' | 'estimated';
  activity: 'idle' | 'working' | 'needs-input';
  attention?: { kind: string };
}
interface StateDto {
  consent: 'unset' | 'exact' | 'estimated';
  hooksInstalled: { claude: boolean };
  sessions: ExternalSessionDto[];
}

let session: AppSession;
let home: string;
let hooks: Record<string, string>;

const CWD = '/tmp/e2e-project';

const call = <T>(method: string, params?: unknown): Promise<T> => session.call<T>(method, params);

const state = (): Promise<StateDto> => call<StateDto>('externalSession.state');
const sessions = async (): Promise<ExternalSessionDto[]> => (await state()).sessions;
const byId = async (id: string): Promise<ExternalSessionDto | undefined> =>
  (await sessions()).find((s) => s.id === id);

/** Reads the hook command the app installed for `event`, exactly as Claude Code would find it. */
function installedHooks(): Record<string, string> {
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  const found: Record<string, string> = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const command = groups
      .flatMap((g) => g.hooks)
      .find((h) => h.command.includes('external-enabled'))?.command;
    if (command) found[event] = command;
  }
  return found;
}

/** Fires one Claude hook the way the CLI does: the command in a shell, the event JSON on stdin. */
function fire(event: string, sessionId: string, extra: Record<string, unknown> = {}): void {
  const command = hooks[event];
  if (!command) throw new Error(`hook ${event} was not installed`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'AI_COMPANION_SIGNAL_FILE') env[k] = v;
  env.HOME = home;
  execFileSync('sh', ['-c', command], {
    input: JSON.stringify({ session_id: sessionId, cwd: CWD, ...extra }),
    env,
  });
}

test.beforeAll(async () => {
  session = await launchApp({ externalConsent: 'unset' });
  home = session.home;

  const after = await call<StateDto>('externalSession.setConsent', { mode: 'exact' });
  expect(after.consent).toBe('exact');
  hooks = installedHooks();
});

test.afterAll(async () => {
  await session?.close();
});

test.describe.configure({ mode: 'serial' });

test.describe(
  'Integration › conversations started outside the app (CLI hooks)',
  { tag: '@integration' },
  () => {
    test('Accepting the banner installs the CLI hooks the app listens to', async () => {
      expect((await state()).hooksInstalled.claude).toBe(true);
      expect(Object.keys(hooks).sort()).toEqual(
        expect.arrayContaining([
          'Notification',
          'PostToolUse',
          'PreToolUse',
          'SessionEnd',
          'SessionStart',
          'Stop',
          'UserPromptSubmit',
        ]),
      );
    });

    test('A new outside conversation is listed as idle, with its size, in its folder', async () => {
      fire('SessionStart', 'fresh', { source: 'startup' });
      await expect
        .poll(() => byId('fresh'))
        .toMatchObject({ activity: 'idle', precision: 'measured', cwd: CWD, closed: false });
    });

    test('A prompt makes an outside conversation work, and its end makes it idle', async () => {
      fire('UserPromptSubmit', 'fresh');
      await expect.poll(async () => (await byId('fresh'))?.activity).toBe('working');
      fire('Stop', 'fresh');
      await expect.poll(async () => (await byId('fresh'))?.activity).toBe('idle');
    });

    test('A permission request marks it as needing you; the next prompt clears it', async () => {
      fire('Notification', 'fresh', {
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash',
      });
      await expect.poll(async () => (await byId('fresh'))?.activity).toBe('needs-input');
      expect((await byId('fresh'))?.attention?.kind).toBe('permission');
      fire('UserPromptSubmit', 'fresh');
      await expect.poll(async () => (await byId('fresh'))?.activity).toBe('working');
      fire('Stop', 'fresh');
    });

    test('A "waiting for input" notification does not mark it as needing you', async () => {
      fire('Notification', 'fresh', {
        notification_type: 'idle_prompt',
        message: 'Claude is waiting for your input',
      });
      await session.page.waitForTimeout(500);
      expect((await byId('fresh'))?.activity).toBe('idle');
    });

    test('Resuming or compacting a conversation does not interrupt a turn in progress', async () => {
      fire('UserPromptSubmit', 'fresh');
      await expect.poll(async () => (await byId('fresh'))?.activity).toBe('working');
      fire('SessionStart', 'fresh', { source: 'compact' });
      await session.page.waitForTimeout(500);
      expect((await byId('fresh'))?.activity).toBe('working');
      fire('Stop', 'fresh');
      await expect.poll(async () => (await byId('fresh'))?.activity).toBe('idle');
    });

    test('An idle conversation stays idle and never adds a duplicate row', async () => {
      await session.page.waitForTimeout(1_000);
      expect((await sessions()).filter((s) => s.cwd === CWD).map((s) => s.id)).toEqual(['fresh']);
    });

    test('/clear replaces the old row with the new idle conversation', async () => {
      fire('UserPromptSubmit', 'fresh');
      fire('Stop', 'fresh');
      fire('SessionEnd', 'fresh', { reason: 'clear' });
      fire('SessionStart', 'cleared', { source: 'clear' });
      await expect.poll(async () => (await sessions()).map((s) => s.id)).toEqual(['cleared']);
      expect(await byId('cleared')).toMatchObject({
        activity: 'idle',
        closed: false,
        precision: 'measured',
      });
    });

    test('Exiting keeps the conversation listed as ended, and a late signal revives it', async () => {
      fire('SessionEnd', 'cleared', { reason: 'prompt_input_exit' });
      await expect.poll(async () => (await byId('cleared'))?.closed).toBe(true);
      expect((await byId('cleared'))?.activity).toBe('idle');
      fire('UserPromptSubmit', 'cleared');
      await expect.poll(async () => (await byId('cleared'))?.closed).toBe(false);
      fire('SessionEnd', 'cleared', { reason: 'prompt_input_exit' });
    });

    test('Conversations are tracked independently', async () => {
      fire('SessionStart', 'other', { source: 'startup', cwd: '/tmp/e2e-other' });
      fire('UserPromptSubmit', 'other', { cwd: '/tmp/e2e-other' });
      await expect.poll(async () => (await byId('other'))?.activity).toBe('working');
      expect((await byId('cleared'))?.closed).toBe(true);
      fire('SessionEnd', 'other', { reason: 'other' });
      await expect.poll(async () => (await byId('other'))?.closed).toBe(true);
    });

    test('Without consent the hooks do nothing', async () => {
      const marker = join(home, '.ai-companion', 'signals', 'external-enabled');
      expect(existsSync(marker)).toBe(true);
      await call('externalSession.revokeConsent');
      expect(existsSync(marker)).toBe(false);
      // Hooks were removed from settings; fire the previously-captured command to prove the marker alone silences it.
      fire('SessionStart', 'ghost', { source: 'startup' });
      expect(existsSync(join(home, '.ai-companion', 'signals', 'external', 'ghost.jsonl'))).toBe(
        false,
      );
      const after = await state();
      expect(after.consent).toBe('unset');
      expect(after.sessions).toEqual([]);
      expect(after.hooksInstalled.claude).toBe(false);
    });
  },
);
