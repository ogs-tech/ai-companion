---
title: Write an e2e journey
description: Add a Playwright Electron test that walks a product flow the way a user does.
---

# Write an e2e journey

E2E tests live in `e2e/` and drive the **built** app (`out/main/index.js`) with Playwright's Electron support.

```bash
npm run test:e2e                         # builds, then runs everything
npm run test:e2e:ui                      # builds, then opens Playwright's UI mode (the product-friendly view)
npx playwright test --project=sessions   # one product area, reusing the last build
npx playwright test --grep @smoke        # only the main journey of each area
```

**Run `npm run build` after any `src/` change** — the tests drive `out/`, not the sources. If a stale Electron blocks the launch, `pkill -f air-ide-e2e-userdata`.

## Where things live

`e2e/` is split first by **audience**, then by **area**: `e2e/product/<area>/` and `e2e/technical/<area>/`, with the same area names as `docs/product/` and `docs/technical/` (a spec lives in the area whose docs describe what it exercises). Each area is one Playwright project (`playwright.config.ts`, matching both folders), so UI mode gives a checkbox per area and a tree *product | technical → area → file → `describe` → test*. Someone from product can read `product/` as an index of the app and run just the part they care about.

- `product/`: journeys a product person can read: what the user sees and does.
- `technical/`: mechanism coverage: IPC contracts, process lifecycle, layout checks, hooks.

| Area | `product/` | `technical/` |
|---|---|---|
| `sessions` | lifecycle, tabs, session list, history, channel picker | permission requests, workspace edits, conversations started outside the app (CLI hooks; tagged `@integration`) |
| `channels` | setup and terminals, Cursor, LM Studio | — |
| `customizations` | browse and search, create and edit, home scope, integrations, plugin import, channel warnings, panel chrome, language instruction | sync to Claude |
| `workspaces` | first use | layout |
| `editor` | spreadsheet preview | — |

`e2e/fixtures/` holds the shared launch, CLI stubs, layout checker and `sessions-app.ts`.
