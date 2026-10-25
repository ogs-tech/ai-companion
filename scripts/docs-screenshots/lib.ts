import { _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const OUT_DIR = join(process.cwd(), 'docs', 'assets', 'screenshots');
const HIGHLIGHT_COLOR = '#E5484D';

export interface Demo {
  home: string;
  workspace: string;
}

const write = (path: string, body: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
};

/** A throwaway HOME plus one git workspace ("acme-api") with a commit and one uncommitted change. */
export function seedDemo(): Demo {
  const home = mkdtempSync(join(tmpdir(), 'docs-shots-'));
  const workspace = join(home, 'Projects', 'acme-api');
  mkdirSync(join(home, '.claude'), { recursive: true });
  write(join(workspace, 'package.json'), '{\n  "name": "acme-api",\n  "scripts": { "dev": "node src/index.js" }\n}\n');
  write(join(workspace, 'README.md'), '# acme-api\n\nDemo workspace for the documentation screenshots.\n');
  write(join(workspace, 'src', 'index.js'), "console.log('acme-api up');\n");
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: workspace,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Ada Dev', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Dev', GIT_COMMITTER_EMAIL: 'ada@example.com' },
    });
  };
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Initial commit');
  write(join(workspace, 'src', 'index.js'), "console.log('acme-api up');\nconsole.log('listening on :3000');\n");
  write(join(workspace, 'src', 'routes.js'), 'module.exports = [];\n');
  return { home, workspace };
}

export async function launch(demo: Demo): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.HOME = demo.home;
  delete env.ELECTRON_RENDERER_URL; // force the production loadFile path
  const app = await electron.launch({ args: [join(process.cwd(), 'out', 'main', 'index.js')], env, timeout: 30_000 });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept()); // the unsaved-tabs guard uses window.confirm
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setSize(1440, 900);
    win?.center();
  });
  await page.waitForSelector('[data-testid="main-screen"], [data-testid="workspace-screen"]', { timeout: 30_000 });
  return { app, page };
}

/** Makes the native folder picker return `path` without showing it. */
export async function stubFolderPicker(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, path);
}

/** Outlines `target` with a numbered badge, for the duration of `fn` (so the capture includes it). */
export async function withHighlight(page: Page, target: Locator, label: string, fn: () => Promise<void>): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`highlight target not visible for "${label}"`);
  await page.evaluate(
    ({ b, text, color }) => {
      const ring = document.createElement('div');
      ring.id = '__docs-highlight';
      ring.style.cssText = `position:fixed;left:${b.x - 4}px;top:${b.y - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:3px solid ${color};border-radius:8px;box-shadow:0 0 0 4px ${color}33;pointer-events:none;z-index:2147483647;`;
      const badge = document.createElement('div');
      badge.textContent = text;
      badge.style.cssText = `position:absolute;left:-14px;top:-14px;width:24px;height:24px;border-radius:50%;background:${color};color:#fff;font:700 13px/24px system-ui;text-align:center;`;
      ring.appendChild(badge);
      document.body.appendChild(ring);
    },
    { b: box, text: label, color: HIGHLIGHT_COLOR },
  );
  try {
    await fn();
  } finally {
    await page.evaluate(() => document.getElementById('__docs-highlight')?.remove());
  }
}

/** Saves a PNG to docs/assets/screenshots/<guide>/<name>.png after letting animations settle. */
export async function shot(page: Page, guide: string, name: string): Promise<void> {
  await page.waitForTimeout(400);
  const path = join(OUT_DIR, guide, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** The Explorer's Git toolbar overlaps itself at the default width; drag its divider wider before capturing. */
export async function widenExplorer(page: Page, byPx = 130): Promise<void> {
  const box = await page.getByRole('separator', { name: 'Redimensionar painel' }).first().boundingBox();
  if (!box) throw new Error('explorer resize handle not found');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + byPx, y, { steps: 8 });
  await page.mouse.up();
}
