# Início / Workspace shell — UX consolidation

**Date:** 2026-10-12 · **Type:** UI/UX restructuring · **Cycle:** 2 of 2

**Depends on:** cycle 1, `2026-10-12-folder-workspace-model-design.md` (two scopes; `activeWorkspaceId: null`
= Início; `workspace.open` / `workspace.goHome`; no `Project`). Builds **on top of** the "dense cards" restyle
(`2026-10-12-shell-dense-cards-restyle-design.md`), which must land first; this spec does not change its
visual tokens.

Decided in a visual-companion session (2026-10-12) from screenshots of the running app. Reference mockups
(gitignored, local only): `.superpowers/brainstorm/74341-1791822694/content/09-a-plus-c.html`,
`10-overview-open-close.html`, `11-cycle2-design.html`.

## Problem (observed in the running app)

1. On Início, the Explorer mixes three unrelated things: the personal Instruction, app shortcuts
   (Starter Pack, Marketplaces, Diagnóstico) and the workspace list, which has an always-visible 🗑 on every row.
2. Início is labelled "Default · Global" with `/Users/<user>` as its path, so it reads as one more workspace —
   after cycle 1 it is not one.
3. Switching workspaces requires going back to Início (🏠 in the Explorer header). No switcher, no recents,
   no "open folder".
4. Início's Control panel has a stray "Workspace" label, and its session list mixes every context (148 rows).
5. The Workbench is empty ("Nenhuma aba aberta") in both contexts — the centre of the screen orients nobody.
6. "Instructions" is a tree row in both contexts, with different icons and meanings.

## Principle

Same shell in both contexts; content changes, positions don't.

| Region | Role | Início | Workspace |
|---|---|---|---|
| TopNav | context switcher | `🏠 Início ▾` | `📁 <name> ▾` |
| Left panel | **where** (navigation) | Workspaces + App | Arquivos \| Git |
| Workbench | **work** (tabs) | pinned Visão geral + tabs | pinned Visão geral + tabs |
| Right panel | **what** (current scope) | Global | Workspace + "Herdado do Global" |

## Design

### 1. TopNav — context switcher

`src/renderer/components/shell/TopNav.tsx`, new `components/shell/ContextSwitcher.tsx`.

- Right of back/forward: a button showing `🏠 Início` or `📁 <workspace.name>` with a ▾. Tooltip = the
  workspace root path (the path no longer appears anywhere else in the chrome).
- Menu items, in order: **Início** · divider · **Recentes** (up to 5, by `lastOpenedAt`, excluding the
  current one) · **Todos os workspaces ▸** (submenu, alphabetical) · divider · **Abrir pasta… ⌘O** ·
  **Remover este workspace…** (only when a workspace is active; opens the existing
  `WorkspaceRemoveConfirmDialog`, then goes home).
- "Abrir pasta…" = `dialog.selectFolder` → `workspace.open({ path })`. Cancel is a no-op; errors (e.g. home
  dir → `validation`) show the existing toast.
- Clicking the label of the context you are already in focuses its Visão geral tab.
- Switching context goes through the existing `resetTabs()` guard (dirty tabs prompt).
- **Removed:** `WorkspaceBreadcrumbHeader` (name, path, 🏠, ⋮ menu). Its ⋮ items move: "mostrar
  entidades globais" is replaced by §5; "remover" moves to the switcher; panel toggles move to the TopNav
  icon group (existing `PanelLeft`/`PanelRight` icons, next to theme/settings).
- **Model addition:** `Workspace.lastOpenedAt?: string` (ISO), stamped by `WorkspaceService` on
  `switchTo`/`open`. Optional, so cycle-1 data needs no migration; missing values sort last.

### 2. Visão geral — pinned icon-only tab

`WorkspaceScreen` tab model + new `components/workspace/overview/{HomeOverview,WorkspaceOverview}.tsx`.

- A new `OpenTab` kind `'overview'`, id `overview`, always present at index 0, rendered icon-only (🏠 /
  📁 glyph, tooltip "Visão geral"). No close button; "close", "close others", "close all" skip it; it cannot
  be reordered. It is the active tab whenever a context is entered and when the last other tab closes.
- Shortcut **⌘0** activates it (registered with the existing keyboard handling in `WorkspaceScreen`).
- Replaces the "Nenhuma aba aberta" empty state, which is deleted.
- Cards are read-only summaries with links; **no editing inside the overview**.
- **Início cards:**
  - *Sessões ativas* — live sessions across all contexts (`useSessions`), each row `context › title · age`,
    click = switch context if needed and focus the session tab. Footer: today's spend + "ver histórico"
    (opens the existing history tab, scope `all`).
  - *Recentes* — up to 5 workspaces by `lastOpenedAt`; click = switch. Empty → "Abrir pasta…" button.
  - *Saúde* — `useHealthReport` worst severity + top 2 messages; "Abrir Diagnóstico" opens that tab.
  - *Global* — counts (personal Instruction present?, skills, agents, MCP servers) + per-harness sync state
    (same source as `AppFooter`).
- **Workspace cards:**
  - *Git* — branch, change count, ahead/behind, last commit age (existing `git.status`); "Ver alterações"
    switches the left panel to Git. Not a repo → "Inicializar repositório" (existing `git.init`).
  - *Sessões* — this workspace's live sessions + spend; "+ Nova sessão" (existing new-session action,
    workspace anchor).
  - *Instruction do workspace* — first instruction's name, line count, `updatedAt`; click opens its tab; none →
    "Criar instruction".
  - *Launch* — configs from the workspace root `.vscode/launch.json` with ▶ per supported config (existing
    launch-config actions); none → card hidden.

### 3. Left panel — "where"

`ExplorerPanelContent.tsx`, `WorkspaceManagementList.tsx`, `FolderTree.tsx`.

- **Início:** two sections.
  - *Workspaces* — header action "+ Abrir pasta"; rows = name + ● when it has live sessions; click = switch;
    row context menu = "Abrir", "Revelar no Finder" (existing open-with), "Remover…". The always-visible 🗑
    is removed.
  - *App* — Starter Pack, Marketplaces, Diagnóstico (● when health is not ok); each opens its existing
    Workbench tab (`workspace-area-store`).
  - The "Novo workspace" button is replaced by "+ Abrir pasta" (same `workspace.open` flow).
- **Workspace:** Arquivos | Git toggle as today (refresh action stays in that toggle row, per the restyle
  spec).
  - A sub-folder whose real path equals a registered workspace root gets a small 📁 badge (tooltip
    "Workspace").
  - Folder context menu: "Abrir como workspace" (`workspace.open`) — replaces cycle 1's interim entry.
- The **Instructions** row is removed from the left tree in both contexts (moves to §4).

### 4. Right panel — "what" (current scope)

`ControlPanelContent.tsx`.

- Kicker: `Global` on Início, `Workspace · <name>` in a workspace. The stray "Workspace" label goes.
- Order: **Instruction** (Início: the personal instruction; workspace: its instructions, "+" to add) ·
  **Skills** · **Agents** · **Integrações** · **Sessões** (scope's own sessions; "+" = new session in this scope;
  "ver todas" opens history with scope `workspace` or, on Início, `all`).
- Início's Sessões group lists **Global** sessions only (anchor `personal`); live sessions of other contexts
  are on the Visão geral card, not here.
- **Workspace only — "Herdado do Global"**: a collapsed group at the bottom listing global skills/agents/
  instruction read-only (rows open the entity tab in read-only mode with a "Editar no Início" action that
  switches to Início and opens it there). Replaces the `showGlobal` toggle and its menu item.

### 5. Command palette and footer

- `CommandPalette.tsx`: add "Abrir pasta…" (⌘O), "Ir para workspace…" (lists workspaces), "Ir para Início",
  "Visão geral" (⌘0). ⌘O is registered globally in `AppShell`.
- `AppFooter.tsx`: the health dot becomes a button that opens the Diagnóstico tab **in the current
  context** (Starter Pack / Marketplaces / Diagnóstico are app-level tabs; only their *entry rows* live on
  Início's left panel). The same holds for ⌘K entries for these three.

## Non-goals

- Visual tokens / card styling (restyle spec), editor Save button, hook/MCP editor gaps (UI/UX backlog).
- Multiple windows or workspaces open side by side.
- Any change to the model beyond `Workspace.lastOpenedAt`.

## Testing (Testing Library, jsdom project)

- **ContextSwitcher:** shows Início / workspace name; recents ordered by `lastOpenedAt` excluding current;
  "Abrir pasta" calls `dialog.selectFolder` then `workspace.open`; cancel no-op; remove only when a
  workspace is active and goes through the confirm dialog; clicking current context focuses the overview.
- **Overview tab:** present at index 0 on entering a context; has no close button; survives close-all;
  ⌘0 activates it; becomes active when the last tab closes.
- **HomeOverview / WorkspaceOverview:** each card renders from mocked queries, including empty states
  (no recents, not a git repo, no instruction, no launch configs → hidden).
- **Left panel:** Início sections; no 🗑 on rows; context-menu remove; workspace badge on matching
  sub-folder; "Abrir como workspace" in folder menu.
- **Right panel:** kicker per scope; Início sessions = personal-anchored only; "Herdado do Global" collapsed
  by default, read-only rows.
- **Main:** `WorkspaceService` stamps `lastOpenedAt` on `switchTo`/`open`.
- Existing `data-testid`s are kept where the element survives; tests for removed elements
  (`WorkspaceBreadcrumbHeader`, `workspace-toggle-global`, empty state) are deleted with them.
- Gate: `npm run lint`, `npm run typecheck`, `npm test` green.

## Docs to update

`docs/reference/architecture.md` (renderer shell section), `docs/reference/ipc-contract.md`
(`Workspace.lastOpenedAt`), and the `docs/how-to/` pages that describe switching workspaces, global
entities and the Explorer header.
