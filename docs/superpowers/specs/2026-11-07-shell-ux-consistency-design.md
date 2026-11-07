# Shell UX consistency: header, footer, panels, Navegador

Status: draft for review. Annotated mockup (measurements, tokens, files to change, test ids to keep): `2026-11-07-shell-ux-consistency-mockup.html` in this folder. The exploration mockups in `.superpowers/` are git-ignored and not authoritative.

## Intent

The feature set is consistent; the shell around it is not. Header, footer and the three workspace cards (Explorer, Workbench, Control Panel) were each built to answer their own need, so they disagree on heights, weights and where actions live. The goal is one coherent window where each region has one job, the eye has a shared baseline, and the thing that needs the user (a session waiting on input) is the loudest thing on screen.

Success, as the owner described it: they can open the app and use it daily without noticing the shell; "real tests" means the result is exercised in the running Electron app, not only in unit tests.

## Decisions made with the owner

1. **One baseline.** The first row of every card is 36px with a bottom hairline: Workbench tab strip, Explorer view title ("Arquivos", "Git", "Terminais", "Navegador"), Control Panel "Sessões" and "Customizações". Today these are 28 / ~34 / 40px (`SectionHeader`, tab strip, `ContainerHeader`).
2. **Header** keeps: context switcher (left), ⌘K search trigger (center), panel toggles (left/right) and Configurações (right). The panel toggles stay in the header, not the footer.
3. **Navegador moves into the Explorer.** `ExplorerView` gains a fourth workbench-facing view next to `files | search | git | terminals`. It lists open browser pages and, on click, focuses or opens the Workbench tab. The globe button leaves the header.
4. **"+" at the end of the Workbench tab strip** creates anything that becomes a tab: Nova sessão, Novo terminal, Novo navegador. It is a shortcut; the Explorer view remains the place to see what exists.
5. **Sessions that need the user** sort to the top of the Sessões list and say so in words ("precisa de você").

## Proposed by the builder (owner has not objected; correct if wrong)

- **Footer** shows at most: workspace + branch (left); on the right Ln/Col and save state (only with an editor active), one sessions summary with "precisa de você" first, and sync health. "Ociosas" is dropped (idle is not information). Adapter status ("Claude Code ✓ / Cursor —") leaves the footer; it stays in the sync tooltip and Configurações. Today: up to 8 items with mixed glyphs (`⎇ ✻ ◌ ! ✓ —`).
- Icons in the footer and rows use the app's icon set (`Icon`/lucide), not text glyphs.

## Open, owner to decide

- **Voltar/Avançar.** The header buttons (workspace history) are currently the *only* way to navigate history: `navigateWorkspaceHistory` has no menu command or shortcut (`src/shared/desktop.ts`). Removing the buttons removes the feature unless menu commands and shortcuts are added. Options: keep the two buttons in the header; or remove them and add `history-back`/`history-forward` menu commands with accelerators.
- **Fixed addresses in the Navegador view.** The mockup shows "Fixados neste workspace" (e.g. the dev server). That is a new feature (storage, add/remove UI), not present today. In or out of this work?

## Goals

- Same first-row height and hairline across all three cards, in light and dark themes.
- Header controls: from 7 to 5 (or 7 if Voltar/Avançar stay and only the globe leaves, 6).
- Footer: from up to 8 items to at most 4–5, none of them a layout control.
- Navegador reachable in two ways (Explorer view, "+") and via ⌘K.
- Verified in the running app, not only in tests.

## Non-goals

- No change to what the panels contain beyond their first row, the Sessões ordering, and the new Navegador view. Settings, Diagnóstico, Histórico, Marketplaces and other screens are out of scope.
- No new harness capability, IPC contract or data model, except if "fixed addresses" is accepted.
- No redesign of the brand tokens (`src/renderer/tokens.ts`): cream/ink/azul and the "fio antes de sombra" rule stand.

## Anti-goals

- A shell that looks tidier but hides "session needs you" more than today.
- Adding shortcuts or menu entries that the mockups invented. The mockups show `⌘N`, `⌃\``, `⌘⇧B` as illustration only; the real accelerator for new session is `Shift+CmdOrCtrl+N`, and there is no accelerator today for new terminal or new browser.

## Constraints

- Project rules apply: lint, typecheck and tests green; one commit after review; mockups before UI changes (done for the shell).
- Strict TS, `.js` import extensions, IPC only via `callIpc` (no new IPC expected).
- Existing `data-testid`s used by tests (`status-bar`, `workspace-toggle-files`, `nav-history-*`, `nav-browser-toggle`, etc.) must be kept or the tests updated deliberately.
- Panels remain `react-resizable-panels` with the shared `panelCardSx`/`SidePanel` shell.

## Left to the builder

- How to unify the first row: a shared `PanelHeader` primitive replacing `SectionHeader`/`ContainerHeader`/tab strip height is the likely route, but it is the builder's call.
- Visual details of the "precisa de você" treatment (color, weight) within the existing role colors (`ambar` for attention).
- Empty, loading and error states of the Navegador view (follow `EmptyState`/`LoadingState` in `components/ds`).

## Not verified

Mockups were hand-written HTML using the real tokens. Not yet checked in Electron: dark theme, macOS window chrome with the 40px header, Space Grotesk / glyph rendering, and narrow-width behavior with three cards.
