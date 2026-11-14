import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile } from '../../fixtures/app.js';
import { useSessionsApp } from '../../fixtures/sessions-app.js';

const app = useSessionsApp();
const { call, find, idle } = app;

test.describe('Sessions › when their workspace changes', () => {
  test('Deleting a workspace ends its sessions and leaves the other workspaces alone', async () => {
    const doomed = await idle('beta');
    const survivor = await idle('acme');

    await call('workspace.delete', { id: 'beta' });

    await expect.poll(async () => (await find(doomed.sessionId))?.status).toBe('exited');
    expect((await find(survivor.sessionId))?.status).toBe('running');
  });

  test('Adding a folder ends the sessions of that workspace, and new ones start with the new folder', async () => {
    const extra = join(app.session.home, 'Projects', 'shared-lib');
    mkdirSync(extra, { recursive: true });
    writeFile(join(extra, 'README.md'), '# shared-lib\n');

    const inAcme = await idle('acme');
    await call('workspace.addFolder', { id: 'acme', path: extra });

    await expect.poll(async () => (await find(inAcme.sessionId))?.status).toBe('exited');
    const fresh = await idle('acme');
    expect(fresh.status).toBe('running');
  });
});
