# Shell restyle — "dense cards" (direction F)

**Date:** 2026-10-12 · **Type:** visual refinement (style only) · **PR:** 1 of 2

## Goal

Give the workspace shell (TopNav, the three workspace panels, the Workbench tab strip, the footer) a more
deliberate, OGS-branded look **without losing density**. The three panels become cards floating on the
cream canvas; trees stay compact (22px rows); the footer becomes a useful status bar.

Chosen in a visual-companion session from directions A (current), B (compact), C (editorial) and the
hybrids D/E/F. F = C's cards + B's density. Reference mockup (gitignored, local only):
`.superpowers/brainstorm/43814-1791820167/content/f-light-dark.html`.

## Non-goals

- **No behavior change.** No new IPC, no new state, no new user actions. All existing `data-testid`s are kept.
- **Editor header + "Salvar ⌘S" button** — PR 2 (it is a behavior change; tracked in the UI/UX backlog).
- **Moving the workspace name into the TopNav breadcrumb** — `WorkspaceBreadcrumbHeader` owns the
  workspace switch/remove menu; moving it is restructuring, not styling. It stays in the Explorer.
- Screens other than the workspace shell (Settings, Starter Pack, Marketplaces, Diagnóstico content,
  `EntityDataGrid`) — later iterations.

## Design

### 1. Tokens — `src/renderer/tokens.ts`

- **Fix `surfaces.dark.rail`:** today `#142036`, which is *darker* than `surfaces.dark.paper` (`#16223A`)
  so anything painted `rail` on a paper card disappears. Change to `#1B2944` (validated in the mockup).
- Update the file header comment: panels are bordered `paper` cards on `canvas` — still "fio antes de
  sombra" (hairline border, **no shadow**).
- No new tokens. Card radius = `radius.md` (14) is acceptable; mockup used 12 — use `radius.md` rather
  than adding a token.

### 2. Workspace layout — `src/renderer/screens/workspace/WorkspaceScreen.tsx` + `ds/SidePanel.tsx` + `ds/ResizeHandle.tsx`

- The panel `Group` gets `px: 0.75` (6px) and no top padding (TopNav sits directly above); bottom padding
  0 (status bar sits below with its own top border-less look — see §5).
- Each of the three panels (Explorer `SidePanel`, Workbench `Panel`, Control `SidePanel`) renders its
  content inside a card: `bgcolor: background.paper`, `border: 1px solid divider`, `borderRadius:
  radius.md`, `overflow: hidden`. The canvas (`background.default`) shows in the gaps.
- **`SidePanel` drops its title header** (glyph + Kicker "Explorer Panel" / "Control Panel"). Keep the
  `headerTestId` element in the DOM so tests keep resolving panel identity — render it as the card's
  root (or a zero-height wrapper) carrying the same `data-testid`. Remove the `rail` background from the
  side panels (cards are `paper`; `rail` is now only a selection/hover/segmented-control fill).
  - `headerActions` (the Explorer's "Reler do disco" refresh button, `workspace-refresh-files`) moves to
    the right end of the Files/Git toggle row in `ExplorerPanelContent`. Simplest: `SidePanel` keeps the
    `headerActions` prop but no longer renders it; `WorkspaceScreen` passes `explorerHeaderActions`
    to `ExplorerPanelContent` via a new `toolbarActions` prop. Drop now-unused SidePanel props
    (`glyph`, `title`, `headerDivider`) if nothing else uses them.
- **`ResizeHandle`:** becomes the 6px gap itself — transparent at rest, `secondary.main` 2px centered line
  on hover/focus/drag (pseudo-line or inner box). The `divider` fill at rest goes away (the cards' own
  borders are the hairlines now).

### 3. TopNav — `src/renderer/components/shell/TopNav.tsx`

- Toolbar height 40 (`minHeight: 40`, override locally rather than changing the global `MuiToolbar`
  56 if other toolbars rely on it — check with grep). Background `background.default` (canvas), **no
  bottom border** — it reads as part of the canvas, the cards begin below it.
- Left: Logo + `brand.displayName` (unchanged), then back/forward icon buttons.
- Center: the ⌘K trigger (`command-palette-trigger`) becomes a search-field-looking button, ~260px wide,
  `bgcolor: background.paper`, hairline border, `radius.sm`, left "⌕ Buscar ou ir para…" in
  `text.secondary`, right `⌘K` in `fonts.mono`. Same `onClick`. Centered with `mx: 'auto'`.
- Right: browser, theme, settings icon buttons (unchanged).
- **Remove the sync `StatusPill`** from TopNav (moves to the status bar, §5). `healthSeverity` prop moves
  from `TopNavProps` to `AppFooter`; `AppShell` passes it through.

### 4. Workbench tabs — `src/renderer/components/workspace/WorkbenchCanvas.tsx`

- Tab strip: `px: 1, py: 0.75`, `gap: 0.375`, bottom border `divider` (keep), no per-tab right border.
- Tab: pill — `borderRadius: radius.pill`, `px: 1.25, py: 0.25`, text `text.secondary`, 0.8rem.
- **Active tab:** `bgcolor: ogs.surfaces.rail`, `color: text.primary`, `fontWeight: 500` (was 600).
- The `accentColor` top-border spine becomes a **6px dot** before the label (same color, shown on every
  tab that has an `accentColor`, active or not). Tabs without `accentColor` keep their glyph/no dot.
- The existing unsaved-changes dot (`warning.main`) and close button stay; close icon `text.disabled`
  until hover.
- Breadcrumb bar under the tabs: background `paper` (was rail), keep bottom border.

### 5. Status bar — `src/renderer/components/shell/AppFooter.tsx`

- Height 22, `bgcolor: background.default`, **no top border**, `px: 1.75`, font 0.625rem, `text.secondary`.
- Left cluster, `gap: 1.75`:
  - Sync: 6px dot (`success`/`warning`/`error` from `healthSeverity`) + label (`sincronizado` /
    `atenção` / `erro` — reuse TopNav's `SYNC_LABEL`/`SYNC_TOOLTIP`, move them to the footer), tooltip,
    click → `navigate('diagnostico')`. Keep the existing testid used by tests for the sync pill
    (`status-pill-sync` or whatever `StatusPill testId="sync"` renders — grep `tests/renderer` and
    preserve it on the new element).
  - One entry per harness in `HARNESS_IDS` order: `HARNESSES[id].displayName` + ` ✓` when
    `settings.adapters[id].enabled`, otherwise ` —` in `text.disabled`. Read settings with the same
    react-query key `App.tsx` / `theme-mode-context.tsx` already use for `settings.get` (no new IPC).
    `data-testid="status-adapter-<id>"`.
- Right: the existing brand `Kicker` link (unchanged behavior), slightly smaller.
- Hidden when `healthSeverity` is undefined: the sync entry only (adapters still show).

### 6. Trees — `src/renderer/components/ds/TreeRow.tsx`, `workspace/ControlPanelContent.tsx`, `workspace/TreeGroup.tsx`

- `TreeRow`: row height 22 (`minHeight: 22, py: 0`), `mx: 0.75`, `borderRadius: radius.xs`, font
  0.8rem. Selected state (wherever `selected`/accent is currently shown): `bgcolor: ogs.surfaces.rail`
  in light; in dark `alpha(secondary.main, 0.16)` (rail is too close to paper for a fill). The left
  `accentColor` spine is kept but inset (`left: 2`) so it sits inside the rounded pill.
- Entity names (skill/agent rows) render in `fonts.mono` at 0.75rem; file rows keep sans except
  filenames with an extension (optional — skip if it complicates `FolderTree`).
- `TreeGroup` header rows: Kicker style (uppercase, 0.6rem, letter-spacing .12em, `text.secondary`),
  count as plain `text.disabled` number after the label instead of a `Chip`.
- **`ControlPanelContent`:**
  - "Sessões" block: its header becomes a group row in the same Kicker style as `TreeGroup` headers
    (chevron toggles `sessionsExpanded`; `+` inline on the right). Keep `workspace-sessions-panel`,
    `workspace-sessions-new`, `workspace-sessions-collapse` testids. Drop its bottom border; spacing
    (`mt: 0.75`) separates groups.
  - **Remove the "Customizations" header row.** Keep `workspace-customizations-header` in the DOM only if
    tests need it; otherwise delete and update the test. The multi-project scope `Chip`
    (`control-panel-scope-chip`) moves to the top of the Control Panel card as a small right-aligned
    line (`Projeto: X` / `Workspace`), only when `viewMode === 'multi-project'`.
- Explorer: the `WorkspaceBreadcrumbHeader` block stays, but compact — workspace name 0.85rem/600 on one
  line with the `⋯` menu, Files/Git `ToggleButtonGroup` restyled as a segmented control (rail track,
  `paper` active thumb, no borders), refresh button at the right of that row (§2).

## Testing

- **Unit (jsdom):** update, don't delete, the tests in `tests/renderer/components/shell/TopNav.test.tsx`,
  `AppFooter.test.tsx`, `AppShell.test.tsx`, `tests/renderer/screens/main-health.test.tsx` (sync pill now
  in the footer) and `tests/renderer/screens/workspace/WorkspaceScreen.test.tsx` (panel header labels).
  New assertions:
  - footer renders sync label/severity and navigates to Diagnóstico on click;
  - footer renders one adapter entry per harness with ✓/— from settings;
  - TopNav no longer renders the sync pill;
  - refresh button still reachable via `workspace-refresh-files`.
- **Gate:** `npm run lint`, `npm run typecheck`, `npm test` all green (release gate per CLAUDE.md).
- **Visual:** `npm run dev`, screenshot the workspace screen in **light and dark** with a skill tab open,
  compare against the reference mockup. Check: cards visible against canvas in dark, selection visible in
  both themes, resize handles still draggable, panel collapse-to-0 still works (a collapsed card must
  not leave a stray 6px gap + border — hide the card border when `collapsed`).

## Risks

- `react-resizable-panels` sizes are percentages of the group; adding horizontal padding/gaps slightly
  shrinks panels — fine, but verify `minSize` constraints still hold at small window widths.
- Global `MuiToolbar` minHeight change would affect other toolbars — keep the 40px override local.
- Dark-mode selection uses `alpha(secondary, .16)` instead of `rail`: one `theme.palette.mode` branch in
  `TreeRow`; acceptable, or expose it as `theme.ogs.surfaces.selected` if it shows up in >1 place.
