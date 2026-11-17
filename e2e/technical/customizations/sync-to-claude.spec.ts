import { test } from '@playwright/test';
import { lstatSync, readlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../../fixtures/app.js';
import { launchCustomizationsApp, type CustomizationsApp } from '../../fixtures/customizations-app.js';

// Saving a skill from the app materializes it into Claude's config surface as a symlink to the canonical file
// (workspace → `<root>/.claude/skills/`, personal → `~/.claude/skills/`), and deleting it removes the link.

let session: CustomizationsApp;

test.beforeAll(async () => {
  session = await launchCustomizationsApp();
});
test.afterAll(async () => {
  await session?.close();
});

const stamp = { version: '1.0.0', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const skill = (name: string, scopes: string[], scopeId?: string) => ({
  skill: {
    kind: 'skill', urn: `urn:skill:${name}`, name, description: `Skill ${name}`, content: `Body of ${name}.`,
    scopes, ...(scopeId ? { scopeId } : {}), metadata: stamp, source: { kind: 'workspace' },
  },
  isCreate: true,
});

test.describe('Customizations › sync to Claude', () => {
  test('A workspace skill is linked under <workspace>/.claude/skills and unlinked on delete', async () => {
    const { call, acmeRoot, acmeData } = session;
    await call('skill.save', skill('sync-ws', ['workspace'], 'acme'));
    const link = join(acmeRoot, '.claude', 'skills', 'sync-ws');
    await expect.poll(() => existsSync(link)).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toContain(join(acmeData, 'skills', 'sync-ws'));

    await call('skill.delete', { id: 'sync-ws', removeSymlinks: true });
    await expect.poll(() => existsSync(link)).toBe(false);
  });

  test('A personal skill is linked under ~/.claude/skills', async () => {
    const { call, home, globalData } = session;
    await call('skill.save', skill('sync-personal', ['personal']));
    const link = join(home, '.claude', 'skills', 'sync-personal');
    await expect.poll(() => existsSync(link)).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toContain(join(globalData, 'skills', 'sync-personal'));
  });

  test('A workspace skill for a workspace that is not open is rejected, not silently synced', async () => {
    const { call } = session;
    await expect(call('skill.save', skill('bad-scope', ['workspace'], 'nope'))).rejects.toThrow();
  });
});
