---
title: Regenerate the doc screenshots
description: Re-capture the screenshots used in these docs from the real app with a single command.
---

# Regenerate the doc screenshots

The images under `docs/assets/screenshots/<guide>/` are produced by a Playwright Electron script, not taken by
hand, so they can be refreshed whenever the UI changes.

```bash
npm run docs:screenshots
```

The command builds the app, launches it with a throwaway `HOME` (your real `~/.ai-companion` and `~/.claude`
are never touched), seeds a demo workspace called `acme-api` (a git repo with one commit and uncommitted
changes), walks through the flows and writes the PNGs. Commit the changed images with the doc edits that
need them.

**Close the dev app first** (`npm run dev`, or `AI Companion Dev.app`). Both bind the embedded browser's CDP
port 9333 (`src/main/index.ts`), so a second instance cannot start and the script times out opening the window.

## Where things live

| File | Role |
|---|---|
| `scripts/docs-screenshots/capture.spec.ts` | One `test` per guide; the order matters, each one continues from the previous state. |
| `scripts/docs-screenshots/lib.ts` | Demo seed, app launch, the folder-picker stub and the helpers below. |
| `scripts/docs-screenshots/playwright.config.ts` | Kept apart from `e2e/`, so `npm run test:e2e` never rewrites committed images. |

## Add or change a screenshot

- `shot(page, '<guide>', '<NN-name>')` saves `docs/assets/screenshots/<guide>/<NN-name>.png`.
- `withHighlight(page, locator, '1', () => shot(...))` outlines the element and adds a numbered badge for the
  duration of the capture — use it to point at the action the step describes.
- Prefer `data-testid` or role selectors. If a selector breaks, the UI changed and the image is stale: fix the
  step, then regenerate.
- Reference the image from the guide with a relative path and a descriptive alt text:
  `![The Novo menu](../assets/screenshots/create-skills-and-agents/02-new-menu.png)`.
- Don't capture a terminal prompt as-is: the default `zsh` prompt prints your machine's hostname. The terminal
  step sets `PS1='$ '` and clears the screen first.
