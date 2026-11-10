import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeCliStubs, type CliStub } from './cli-stubs.js';

export { expect, writeCliStubs };

/** Settings every journey starts from; `LaunchOptions.settings` is shallow-merged over it. */
const DEFAULT_SETTINGS = { adapters: { claude: { enabled: true } }, ui: { theme: 'system' }, language: 'off' };

export interface LaunchOptions {
  /** Shallow-merged over `DEFAULT_SETTINGS` and written to `~/.ai-companion/settings.json`. */
  settings?: Record<string, unknown>;
  /** Called with the throwaway HOME before the app starts — seed files, workspaces, whatever the journey needs. */
  seed?: (home: string) => void | Promise<void>;
  /** Fake channel CLIs; when given, PATH becomes the stub dir + system dirs only (see `cli-stubs.ts`). */
  cli?: Record<string, CliStub>;
  /** Window size; the Explorer's Git toolbar needs the wide default. */
  size?: { width: number; height: number };
  /** Distinct per spec file only if specs ever run in parallel; the dev app owns 9333. */
  cdpPort?: number;
}

export interface AppSession {
  app: ElectronApplication;
  page: Page;
  home: string;
  /** Directory first on PATH when `cli` was given — write more stubs here to "install" a CLI mid-journey. */
  stubDir: string;
  /** Typed `ipc:call` from the renderer, throwing on `ok: false` — the same envelope the UI uses. */
  call: <T>(method: string, params?: unknown) => Promise<T>;
  close: () => Promise<void>;
}

export function writeFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

/** A git workspace folder ("acme-api") with one commit and one uncommitted change, rooted at `root`. */
export function seedGitWorkspace(root: string): void {
  writeFile(join(root, 'package.json'), '{\n  "name": "acme-api",\n  "scripts": { "dev": "node src/index.js" }\n}\n');
  writeFile(join(root, 'README.md'), '# acme-api\n\nDemo workspace for the e2e journeys.\n');
  writeFile(join(root, 'src', 'index.js'), "console.log('acme-api up');\n");
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Ada Dev', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Dev', GIT_COMMITTER_EMAIL: 'ada@example.com' },
    });
  };
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Initial commit');
  writeFile(join(root, 'src', 'index.js'), "console.log('acme-api up');\nconsole.log('listening on :3000');\n");
  writeFile(join(root, 'src', 'routes.js'), 'module.exports = [];\n');
}

/** Registers `root` as the (only) workspace in `~/.ai-companion/workspaces.json`; `open` makes it the active one at launch. */
export function seedWorkspaceRegistry(home: string, workspaces: Array<{ id: string; name: string; rootPath: string }>, activeId: string | null): void {
  writeFile(
    join(home, '.ai-companion', 'workspaces.json'),
    JSON.stringify({
      schemaVersion: 2,
      workspaces: workspaces.map((w) => ({ ...w, createdAt: '2026-01-01T00:00:00.000Z' })),
      activeWorkspaceId: activeId,
    }),
  );
}

/** Boots the built app (`out/main/index.js`) against a throwaway HOME and userData dir. Run `npm run build` first. */
export async function launchApp(options: LaunchOptions = {}): Promise<AppSession> {
  const home = mkdtempSync(join(tmpdir(), 'ai-companion-e2e-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFile(join(home, '.ai-companion', 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, ...options.settings }, null, 2));
  await options.seed?.(home);

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.HOME = home;
  delete env.ELECTRON_RENDERER_URL; // force the production loadFile path
  env.AI_COMPANION_CDP_PORT = String(options.cdpPort ?? 9334); // the dev app owns the default 9333
  const stubDir = join(home, 'cli-stubs');
  if (options.cli) {
    writeCliStubs(stubDir, options.cli);
    // Only system dirs after the stubs: the host's own PATH (e.g. ~/.local/bin) may hold the real CLIs.
    env.PATH = `${stubDir}:/usr/bin:/bin:/usr/sbin:/sbin`;
  }

  // Own userData: the single-instance lock lives there, so a running dev app cannot swallow this launch.
  const userData = mkdtempSync(join(tmpdir(), 'ai-companion-e2e-userdata-'));
  const app = await electron.launch({ args: [join(process.cwd(), 'out', 'main', 'index.js'), `--user-data-dir=${userData}`], env, timeout: 30_000 });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept()); // the unsaved-tabs guard uses window.confirm
  const size = options.size ?? { width: 1440, height: 900 };
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setSize(s.width, s.height);
    win?.center();
  }, size);
  await page.waitForSelector('[data-testid="main-screen"], [data-testid="workspace-screen"]', { timeout: 30_000 });

  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    const result = (await page.evaluate(
      ([m, p]) => (window as unknown as { api: { call: (m: string, p: unknown) => Promise<unknown> } }).api.call(m as string, p),
      [method, params ?? null] as const,
    )) as { ok: boolean; data?: T; error?: { message: string } };
    if (!result.ok) throw new Error(`${method} failed: ${result.error?.message}`);
    return result.data as T;
  };
  return { app, page, home, stubDir, call, close: () => app.close() };
}

/** Makes the native folder picker return `path` without showing it. */
export async function stubFolderPicker(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, path);
}
