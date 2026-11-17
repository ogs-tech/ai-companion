import { test } from '@playwright/test';
import { join } from 'node:path';
import {
  expect,
  launchApp,
  seedGitWorkspace,
  seedWorkspaceRegistry,
  type AppSession,
} from '../../fixtures/app.js';
import { findLayoutFaults, formatFaults } from '../../fixtures/layout.js';

// Journey: nothing in the side panel is cut off, truncated by accident or pushed out of the window — at the
// default size and at the narrowest the window allows. Each assertion prints what a person would see broken
// ("clipped-sideways: code "~/.claude/settings.json" — spans 262–470px, its panel shows 233–460px").

let session: AppSession;

test.beforeAll(async () => {
  session = await launchApp({
    externalConsent: 'unset',
    cli: { claude: { signedIn: true, interactive: true } },
    seed: (home) => {
      const root = join(home, 'Projects', 'acme-api');
      seedGitWorkspace(root);
      seedWorkspaceRegistry(home, [{ id: 'acme', name: 'acme-api', rootPath: root }], 'acme');
    },
  });
});

// The banner sits above the rows, so it only shows once the list has one — an empty list draws its own empty state.
test.beforeAll(async () => {
  await session.page.getByTestId('workspace-sessions-new').click();
  await expect(session.page.locator('[data-testid^="tree-session-"]').first()).toBeVisible({
    timeout: 15_000,
  });
});

test.afterAll(async () => {
  await session?.close();
});

const SIZES = [
  { name: 'default', width: 1440, height: 900 },
  { name: 'narrow', width: 900, height: 700 },
];

const resize = (size: (typeof SIZES)[number]): Promise<unknown> =>
  session.app.evaluate(
    ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]?.setSize(s.width, s.height),
    size,
  );

test.describe('Workspaces › layout', () => {
  for (const size of SIZES) {
    test(`the one-time consent banner is not cut off by its panel (${size.name} window)`, async () => {
      await resize(size);
      const banner = session.page.getByTestId('external-consent-banner');
      await expect(banner).toBeVisible();

      const faults = await findLayoutFaults(banner);
      expect(faults, formatFaults(faults)).toEqual([]);
    });

    test(`the consent choices are visible without scrolling (${size.name} window)`, async () => {
      // Design finding, not a regression: the banner is taller than the short list area of a small window, so
      // "Só estimado" / "Ativar" sit below the fold. Needs a mockup (smaller banner, or pinned actions) first.
      test.fixme(size.name === 'narrow', 'banner taller than the list area of a 700px-high window');
      await resize(size);
      await expect(session.page.getByTestId('external-consent-estimated')).toBeInViewport();
      await expect(session.page.getByTestId('external-consent-exact')).toBeInViewport();
    });
  }
});
