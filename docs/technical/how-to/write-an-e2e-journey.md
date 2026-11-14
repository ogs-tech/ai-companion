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
| `cli: { 'cursor-agent': { signedIn: false } }` | Fake channel CLIs. PATH becomes the stub dir plus system dirs only, so the host's real CLIs never leak in; `writeCliStubs(session.stubDir, …)` "installs" one mid-journey. Skip "not installed" scenarios with `realBinaryOnHost(bin)` when the CLI sits in a dir the app always probes. `interactive: true` turns the stub into a session: after the probes it reads stdin and writes the hooks' own signal lines to `$AI_COMPANION_SIGNAL_FILE` (`working` → `echo: <line>` → `idle`); magic lines: `ask` raises the CLI's own permission prompt (a notification — nothing to answer over IPC), `perm` raises an answerable one (a `permission` signal for `Bash: npm test`, then it waits for `<signal file>.decision` like the real hook and prints `decision: allow\|deny`), `/clear` announces a new conversation. Stubs exist for `claude`, `cursor-agent` (its `create-chat` prints a fresh id) and `lms`. See `journeys/sessions-*.spec.ts`. |
| `E2E_SLOW_MS=1500 npx playwright test …` | Pauses after every `session.call` so you can watch the real window from a terminal (only IPC calls are slowed, not `expect.poll` or UI assertions). The VS Code Playwright extension only honours it if set in its Settings › Env. |

## Gotchas

- Locate by `data-testid` or role/name from the UI; tabs in the Workbench are buttons (`Fechar <name>`), not `role=tab`.
- Controlled MUI checkboxes flip after an async settings round-trip: `click()` then `expect(...).toBeChecked()`; `check()` rejects the not-yet-flipped state.
- Terminals: assert on a computed value (`echo $((20+22))` → `42`), since the typed line is also on screen.
- Every test must create what it needs (`idleSession()` in the sessions journeys): the VS Code extension runs a single test in a fresh worker, so state shared through module variables or `serial` mode breaks there.
- Session row actions (Encerrar / Apagar) only exist while the row is hovered: `getByTestId('tree-session-<id>').hover()` first. A closed session tab stays mounted but hidden, so count `[data-testid="session-panel"]:visible`, not `getByTestId('session-panel')`.
- Seeded Claude transcripts need a recent `timestamp` (the list's default period filter hides old ones) and a `cwd` on a content line; `~/.claude/projects/` does not exist in a throwaway HOME until a test writes it.
- Screenshots for the docs are a separate script (`regenerate-doc-screenshots.md`); journeys assert behaviour only.

## Sessions journeys: what is covered

| Spec | Covers |
|---|---|
| `sessions-lifecycle.spec.ts` | spawn, prompt → working → idle, permission prompt (`needs-input`), independent sessions per anchor, `/clear` replacement, surviving Início/switch, kill → resume → remove, status-bar counter |
| `sessions-ui.spec.ts` | the **+** button, Encerrar, Apagar with its undo window, minimizing a tab and reopening it from the row, inline Permitir / Negar |
| `sessions-scope-and-channels.spec.ts` | `session.answerPermission` (allow, deny, refusals), workspace delete / folder change ending background sessions, history merge by `conversationId` and `sessionHistory.resume`, Cursor (`create-chat`, typed `/clear` and `/new` detection and its refusals), LM Studio, the channel picker dialog |

Known gaps and leads (not covered or not fixed):

- **Visual rendering** — every assertion is on IPC or `data-testid`; nothing checks how the rows, marks or dark theme look.
- `language-instruction-block.spec.ts` fails: it clicks `nav-settings`, which no longer exists (Config is now `explorer-view-config` → `config-leaf-<page>`). Unrelated to sessions; needs a selector update.
- A live workspace/Início row takes its label from the history entry only (`liveLabelOf` in `SessionsTreeGroup.tsx`), ignoring `session.label`, so it reads "Untitled" until the transcript is in the list even when the CLI already named the conversation.
- LM Studio sessions report `idle` for as long as they run: with no hooks the app has no way to say working.
- `tests/main/infrastructure/session-runtime/node-pty-session-adapter.test.ts` failed once in a full `npm test` run under load and passed alone — likely timing; worth watching.
- Not driven yet: Cursor's PTY-tail approval prompt, entity-anchored sessions (skill/agent/instruction editors), the embedded session browser, notifications and the Dock badge, `session.attachment`, multi-folder `--add-dir` launches.
