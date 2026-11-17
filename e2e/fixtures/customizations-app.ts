import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  launchApp,
  seedGitWorkspace,
  seedWorkspaceRegistry,
  writeFile,
  type AppSession,
  type LaunchOptions,
} from './app.js';

/**
 * Seeds the Customizações panel the way the app stores it: Markdown + YAML for skills/agents, JSON for MCP/hooks,
 * frontmatter-free for instructions (see `customization-schema.md`). Global lives in `~/.air-ide/`, the "acme-api"
 * workspace in `<root>/.air-ide/`. The counts are fixed so specs can assert them:
 *
 *   Global     — instruction, skills `global-lint` + `release-notes`, agent `global-reviewer`, MCP `notion`, hook `hook-fmt`
 *   Workspace  — instruction `acme-rules`, skill `deploy-checklist`, agent `api-architect`
 */

const STAMP = '2026-01-01T00:00:00.000Z';

function frontmatter(fields: Record<string, unknown>, body: string): string {
  const lines = Object.entries(fields).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${String(v)}`,
  );
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

function base(kind: string, name: string, description: string, scope: 'personal' | 'workspace') {
  return {
    name,
    type: kind,
    description,
    scopes: [scope],
    ...(scope === 'workspace' ? { scopeId: 'acme' } : {}),
    version: '1.0.0',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

export function seedSkill(dataDir: string, name: string, description: string, scope: 'personal' | 'workspace'): void {
  writeFile(join(dataDir, 'skills', name, 'SKILL.md'), frontmatter(base('skill', name, description, scope), `Instructions for ${name}.`));
}

export function seedAgent(dataDir: string, name: string, description: string, scope: 'personal' | 'workspace'): void {
  writeFile(join(dataDir, 'agents', `${name}.md`), frontmatter(base('agent', name, description, scope), `You are ${name}.`));
}

export function seedMcp(dataDir: string, name: string, description: string): void {
  writeFile(
    join(dataDir, 'mcps', `${name}.json`),
    JSON.stringify({ ...base('mcp', name, description, 'personal'), def: { command: 'npx', args: ['-y', `${name}-mcp`] }, enabled: true }, null, 2),
  );
}

export function seedHook(dataDir: string, name: string, description: string): void {
  writeFile(
    join(dataDir, 'hooks', `${name}.json`),
    JSON.stringify(
      { ...base('hook', name, description, 'personal'), event: 'PostToolUse', matcher: 'Edit', handler: { type: 'command', command: 'echo formatted' }, enabled: true },
      null,
      2,
    ),
  );
}

export interface CustomizationsApp extends AppSession {
  acmeRoot: string;
  /** `<acmeRoot>/.air-ide` — the workspace's own data dir. */
  acmeData: string;
  /** `~/.air-ide` — Global's data dir. */
  globalData: string;
}

export async function launchCustomizationsApp(options: LaunchOptions = {}): Promise<CustomizationsApp> {
  let acmeRoot = '';
  let globalData = '';
  const session = await launchApp({
    ...options,
    seed: async (home) => {
      acmeRoot = join(home, 'Projects', 'acme-api');
      globalData = join(home, '.air-ide');
      const acmeData = join(acmeRoot, '.air-ide');
      seedGitWorkspace(acmeRoot);
      seedWorkspaceRegistry(home, [{ id: 'acme', name: 'acme-api', rootPath: acmeRoot }], 'acme');

      writeFile(join(globalData, 'instructions', 'default.md'), '# Global instructions\n\nReply concisely.\n');
      seedSkill(globalData, 'global-lint', 'Lint every change before commit', 'personal');
      seedSkill(globalData, 'release-notes', 'Draft release notes from merged PRs', 'personal');
      seedAgent(globalData, 'global-reviewer', 'Reviews diffs for correctness', 'personal');
      seedMcp(globalData, 'notion', 'Notion workspace access');
      seedHook(globalData, 'hook-fmt', 'Format after edits');

      seedSkill(acmeData, 'deploy-checklist', 'Steps to ship acme-api', 'workspace');
      seedAgent(acmeData, 'api-architect', 'Designs acme-api endpoints', 'workspace');
      writeFile(join(acmeData, 'instructions', 'project', 'acme-rules', 'INSTRUCTION.md'), '# Acme rules\n\nNever break the public API.\n');
      writeFile(
        join(acmeData, 'instructions', 'project', 'acme-rules', 'meta.json'),
        JSON.stringify({ description: '', version: '1.0.0', createdAt: STAMP, updatedAt: STAMP, scope: 'workspace', scopeId: 'acme' }),
      );
      await options.seed?.(home);
    },
  });
  return Object.assign(session, { acmeRoot, acmeData: join(acmeRoot, '.air-ide'), globalData });
}

/** Clicks the native File > Salvar item — the path ⌘S takes, which Playwright cannot press on Electron's menu. */
export async function saveFromMenu(app: AppSession['app']): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === 'Salvar') return item;
        const hit = item.submenu ? find(item.submenu.items) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) throw new Error('File > Salvar not found in the application menu');
    item.click();
  });
}

/** A one-commit git repo at `root` holding `files` (path → body), usable as a `file://` clone source. */
export function seedGitRepo(root: string, files: Record<string, string>): string {
  for (const [path, body] of Object.entries(files)) writeFile(join(root, path), body);
  const git = (...args: string[]): void => {
    execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Ada Dev', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada Dev', GIT_COMMITTER_EMAIL: 'ada@example.com' },
    });
  };
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Initial commit');
  return `file://${root}`;
}
