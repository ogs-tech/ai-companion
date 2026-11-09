import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

let app: ElectronApplication;
let page: Page;
let home: string;
let hooks: Record<string, string>;

const CWD = '/tmp/e2e-project';

async function call<T>(method: string, params?: unknown): Promise<T> {
  const result = await page.evaluate(
    ([m, p]) => (window as unknown as { api: { call: (m: string, p: unknown) => Promise<unknown> } }).api.call(m as string, p),
    [method, params ?? null] as const,
  );
  const r = result as { ok: boolean; data?: T; error?: { message: string } };
  if (!r.ok) throw new Error(`${method} failed: ${r.error?.message}`);
  return r.data as T;
}

const state = (): Promise<StateDto> => call<StateDto>('externalSession.state');
const sessions = async (): Promise<ExternalSessionDto[]> => (await state()).sessions;
const byId = async (id: string): Promise<ExternalSessionDto | undefined> => (await sessions()).find((s) => s.id === id);

/** Reads the hook command the app installed for `event`, exactly as Claude Code would find it. */
function installedHooks(): Record<string, string> {
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  const found: Record<string, string> = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const command = groups.flatMap((g) => g.hooks).find((h) => h.command.includes('external-enabled'))?.command;
    if (command) found[event] = command;
  }
  return found;
}

/** Fires one Claude hook the way the CLI does: the command in a shell, the event JSON on stdin. */
function fire(event: string, sessionId: string, extra: Record<string, unknown> = {}): void {
  const command = hooks[event];
  if (!command) throw new Error(`hook ${event} was not installed`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'AI_COMPANION_SIGNAL_FILE') env[k] = v;
  env.HOME = home;
  execFileSync('sh', ['-c', command], { input: JSON.stringify({ session_id: sessionId, cwd: CWD, ...extra }), env });
}

test.beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'ai-companion-e2e-sessions-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.ai-companion'), { recursive: true });
  writeFileSync(
    join(home, '.ai-companion', 'settings.json'),
    JSON.stringify({ adapters: { claude: { enabled: true } }, ui: { theme: 'system' }, language: 'off' }),
  );

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.HOME = home;
  delete env.ELECTRON_RENDERER_URL;
  env.AI_COMPANION_CDP_PORT = '9334'; // the dev app owns the default 9333

  // Own userData: the single-instance lock lives there, so a running dev app cannot swallow this launch.
  const userData = mkdtempSync(join(tmpdir(), 'ai-companion-e2e-userdata-'));
  app = await electron.launch({ args: [join(process.cwd(), 'out', 'main', 'index.js'), `--user-data-dir=${userData}`], env });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="main-screen"]', { timeout: 30_000 });

  const after = await call<StateDto>('externalSession.setConsent', { mode: 'exact' });
  expect(after.consent).toBe('exact');
  hooks = installedHooks();
});

test.afterAll(async () => {
  await app?.close();
});

test.describe.configure({ mode: 'serial' });

test('consent installs the signal hooks, including SessionStart and SessionEnd', async () => {
  expect((await state()).hooksInstalled.claude).toBe(true);
  expect(Object.keys(hooks).sort()).toEqual(
    expect.arrayContaining(['Notification', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']),
  );
});

test('a fresh conversation is listed idle, measured, in its folder', async () => {
  fire('SessionStart', 'fresh', { source: 'startup' });
  await expect.poll(() => byId('fresh')).toMatchObject({ activity: 'idle', precision: 'measured', cwd: CWD, closed: false });
});

test('a prompt makes it work, Stop makes it idle again', async () => {
  fire('UserPromptSubmit', 'fresh');
  await expect.poll(async () => (await byId('fresh'))?.activity).toBe('working');
  fire('Stop', 'fresh');
  await expect.poll(async () => (await byId('fresh'))?.activity).toBe('idle');
});

test('a permission prompt asks for the user; the next prompt clears it', async () => {
  fire('Notification', 'fresh', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await expect.poll(async () => (await byId('fresh'))?.activity).toBe('needs-input');
  expect((await byId('fresh'))?.attention?.kind).toBe('permission');
  fire('UserPromptSubmit', 'fresh');
  await expect.poll(async () => (await byId('fresh'))?.activity).toBe('working');
  fire('Stop', 'fresh');
});

test('idle_prompt notifications never read as "needs you"', async () => {
  fire('Notification', 'fresh', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  await page.waitForTimeout(500);
  expect((await byId('fresh'))?.activity).toBe('idle');
});

test('SessionStart on a known conversation (resume/compact) does not reset a turn in progress', async () => {
  fire('UserPromptSubmit', 'fresh');
  await expect.poll(async () => (await byId('fresh'))?.activity).toBe('working');
  fire('SessionStart', 'fresh', { source: 'compact' });
  await page.waitForTimeout(500);
  expect((await byId('fresh'))?.activity).toBe('working');
  fire('Stop', 'fresh');
  await expect.poll(async () => (await byId('fresh'))?.activity).toBe('idle');
});

test('an idle session stays idle: no extra conversation appears', async () => {
  await page.waitForTimeout(1_000);
  expect((await sessions()).filter((s) => s.cwd === CWD).map((s) => s.id)).toEqual(['fresh']);
});

test('/clear swaps the conversation: the old row is gone and only the new idle one remains', async () => {
  fire('UserPromptSubmit', 'fresh');
  fire('Stop', 'fresh');
  fire('SessionEnd', 'fresh', { reason: 'clear' });
  fire('SessionStart', 'cleared', { source: 'clear' });
  await expect.poll(async () => (await sessions()).map((s) => s.id)).toEqual(['cleared']);
  expect(await byId('cleared')).toMatchObject({ activity: 'idle', closed: false, precision: 'measured' });
});

test('a real exit keeps the conversation listed as closed, and a late signal revives it', async () => {
  fire('SessionEnd', 'cleared', { reason: 'prompt_input_exit' });
  await expect.poll(async () => (await byId('cleared'))?.closed).toBe(true);
  expect((await byId('cleared'))?.activity).toBe('idle');
  fire('UserPromptSubmit', 'cleared');
  await expect.poll(async () => (await byId('cleared'))?.closed).toBe(false);
  fire('SessionEnd', 'cleared', { reason: 'prompt_input_exit' });
});

test('conversations are tracked independently', async () => {
  fire('SessionStart', 'other', { source: 'startup', cwd: '/tmp/e2e-other' });
  fire('UserPromptSubmit', 'other', { cwd: '/tmp/e2e-other' });
  await expect.poll(async () => (await byId('other'))?.activity).toBe('working');
  expect((await byId('cleared'))?.closed).toBe(true);
  fire('SessionEnd', 'other', { reason: 'other' });
  await expect.poll(async () => (await byId('other'))?.closed).toBe(true);
});

test('without the consent marker the hooks are silent no-ops', async () => {
  const marker = join(home, '.ai-companion', 'signals', 'external-enabled');
  expect(existsSync(marker)).toBe(true);
  await call('externalSession.revokeConsent');
  expect(existsSync(marker)).toBe(false);
  // Hooks were removed from settings; fire the previously-captured command to prove the marker alone silences it.
  fire('SessionStart', 'ghost', { source: 'startup' });
  expect(existsSync(join(home, '.ai-companion', 'signals', 'external', 'ghost.jsonl'))).toBe(false);
  const after = await state();
  expect(after.consent).toBe('unset');
  expect(after.sessions).toEqual([]);
  expect(after.hooksInstalled.claude).toBe(false);
});
