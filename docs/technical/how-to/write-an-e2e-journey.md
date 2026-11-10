---
title: Write an e2e journey
description: Add a Playwright Electron test that walks a product flow the way a user does.
---

# Write an e2e journey

E2E tests live in `e2e/` and drive the **built** app (`out/main/index.js`) with Playwright's Electron support.

```bash
npm run test:e2e                         # builds, then runs everything
npx playwright test e2e/journeys         # reuse the last build
```

**Close the dev app first** — it holds the single-instance lock path and CDP port 9333 (journeys use 9334 and their own `--user-data-dir`, but a stale dev app still slows the machine and confuses the build).

## Shape of a journey

One file per user journey in `e2e/journeys/`, named for the flow (`workspace-first-use.spec.ts`), not for a component. Name each stage with `test.step`, so the report reads as the journey:

```ts
import { test } from '@playwright/test';
import { expect, launchApp, type AppSession } from '../fixtures/app.js';

let session: AppSession;
test.beforeAll(async () => { session = await launchApp({ seed: (home) => { /* files under the throwaway HOME */ } }); });
test.afterAll(async () => { await session?.close(); });

test('…', async () => {
  await test.step('what the user sees or does', async () => { /* … */ });
});
```

## What `e2e/fixtures/` gives you

| Helper | Use |
|---|---|
| `launchApp({ settings, seed, cli, size })` | Throwaway `HOME` + userData, settings written, window sized, waits for the shell. Returns `{ app, page, home, stubDir, call, close }`. |
| `session.call(method, params)` | The renderer's `ipc:call` envelope; throws on `ok: false`. Use it to **assert persisted state**, not to drive the UI. |
| `seedGitWorkspace(root)` / `seedWorkspaceRegistry(home, …, activeId)` | A git repo with one commit + one change; start the app already inside a workspace. |
| `stubFolderPicker(app, path)` | Native folder dialog returns `path`. |
| `cli: { 'cursor-agent': { signedIn: false } }` | Fake channel CLIs. PATH becomes the stub dir plus system dirs only, so the host's real CLIs never leak in; `writeCliStubs(session.stubDir, …)` "installs" one mid-journey. Skip "not installed" scenarios with `realBinaryOnHost(bin)` when the CLI sits in a dir the app always probes. |

## Gotchas

- Locate by `data-testid` or role/name from the UI; tabs in the Workbench are buttons (`Fechar <name>`), not `role=tab`.
- Controlled MUI checkboxes flip after an async settings round-trip: `click()` then `expect(...).toBeChecked()`; `check()` rejects the not-yet-flipped state.
- Terminals: assert on a computed value (`echo $((20+22))` → `42`), since the typed line is also on screen.
- Screenshots for the docs are a separate script (`regenerate-doc-screenshots.md`); journeys assert behaviour only.
