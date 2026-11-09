# Configurações move into the Explorer

Status: draft for review. Exploration mockup (options A/B/C, A chosen) lives in `.superpowers/brainstorm/` (git-ignored, not authoritative).

## Intent

Settings is the one place in the app that still behaves like a different program: `App.tsx` swaps the whole shell for a full-screen `Settings` view (`view.kind === 'settings'`), with its own "Voltar" button, and a side channel (`publishShellStatus({ settingsOpen })`) so the window title knows. Everything else in the app follows one grammar: the Explorer lists things, clicking a row opens a tab in the Workbench canvas. The owner wants Configurações to speak that grammar, now that the rest of the app has consolidated.

Success: the user changes a setting while the Workbench, tree and Sync state stay on screen, and never leaves the shell to do it.

## Decisions made with the owner

1. **Config is an Explorer view**, a new item in the left rail next to Arquivos / Git / Terminais / Navegador (option A of the mockup).
2. **The Config view is a tree grouped by domain; each leaf opens a Workbench tab.** One page per tab.
3. **Global only.** No per-workspace configuration. The Config view and its pages are identical at Início and inside any workspace.
4. **Idioma and GitHub live under "App"**, not a separate "Conta" group.

## Structure (groups and leaves)

| Group | Leaves | Source today (`src/renderer/screens/Settings.tsx` unless noted) |
|---|---|---|
| Harnesses | one leaf per harness in `HARNESSES` (Claude Code, Cursor) | "Adapters" section |
| Sessões | Sessões | `settings/SessionsSettingsSection.tsx` |
| App | Editor e Explorer · Idioma · GitHub | "Editor e Explorer", "Language", "GitHub" sections |
| Manutenção | Backups · Zona de perigo | restore/backup block; "Zona de perigo" |

Each harness page shows that harness's `manage` / `run` capabilities (from `src/shared/harness.ts`) as toggles, plus last sync state. A harness added to the registry gets a page without new screen code.

## Behaviour

- **Tabs follow the existing tab model.** One fixed id per page (same idea as `HISTORY_TAB_ID`), re-clicking focuses the open tab, tabs reorder, close and are restored with the scope's `openEditors` state. Because open editors are saved per scope, each scope may hold its own Config tab; all of them edit the same global settings.
- **Destructive actions stay modals** on top of the tab: `ConfirmDisableModal` (turning an adapter off removes its materialized links) and `RestoreConfirmDialog`. They do not become tab content.
- **Entry points keep working.** The header Configurações button and `open-settings` (⌘,) now switch the Explorer to the Config view and focus a Config tab instead of swapping the shell. Which tab: the last-focused Config tab, else "Claude Code" (builder's call, see below).
- **Window title** (`src/renderer/lib/window-title.ts`) stops reading `settingsOpen`; it derives "Configurações — …" from the active tab like it does for other tabs.

## Goals

- Remove the `settings` view from `App.tsx`, the `settingsOpen` field of the shell-status store, the "Voltar" button, and the `onOpenSettings` prop drilled through `Main` → `AppShell` → `TopNav` (replaced by an in-shell action).
- Every existing setting stays reachable and keeps its current behaviour (save semantics, validation, IPC calls).
- Config pages are separate components, so `Settings.tsx` (412 lines) stops being a monolith.
- Verified in the running Electron app, not only in tests: rail item, tab open/restore, modals over a tab, light and dark theme.

## Non-goals

- No per-workspace settings, no new settings, no new IPC methods or `Settings` fields.
- No change to how settings are stored or saved.
- No redesign of the individual controls inside a page (that is a later UI pass). Pages are the existing sections, re-homed.
- No search inside Config.

## Anti-goals

- Settings tabs must not break the other tabs' behaviour (dirty guard, restore on startup, scope switch).
- A user who only knows ⌘, must not end up lost: the shortcut always lands on a visible Config page.

## Constraints

- `docs/technical/reference/architecture.md` and `ipc-contract.md` are the authority; no IPC change expected, so the contract should not change.
- Strict TS flags as in `CLAUDE.md`; lint, typecheck and tests green (release gate).
- Interacts with `2026-11-07-shell-ux-consistency-design.md`: that spec keeps Configurações in the header (right) and adds `browser` to `ExplorerView`; this work adds `config` to the same union and keeps the header button. The 36px first-row baseline applies to the Config view title.

## Left to the builder

- Exact `ExplorerView` wiring and the tab `kind` for Config pages, following the History tab.
- Whether the theme control (`UiSettings.theme`) sits in "Editor e Explorer" or its own "Aparência" leaf; place it where it is today. Not verified where that is; check `Settings.tsx`.
- Rail icon and ordering within the rail.
- Test migration: existing `Settings` tests move to the page components.

## Calls made by me (not the owner's), to check

- Leaves are one page per row of the table above (the current sections regrouped, none dropped).
- ⌘, focuses the last Config tab, else "Claude Code".
- Dropping "Voltar" entirely: closing the tab is the way out.
- Window title derived from the active tab.
