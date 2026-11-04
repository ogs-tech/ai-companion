# Explorer Panel redesign — one shell for Global, Workspace and Multi-folder Workspace

Status: approved in mockups (visual companion, 2026-11-03). Mockups live in `.superpowers/brainstorm/*/content/` (`explorer-full-v1.html`, `explorer-no-color-v2.html`, `explorer-git.html`, `explorer-global-rail.html`); they are gitignored, so the decisions are restated here.

## Intent

The left panel (`ExplorerPanelContent` and its three implementations: `HomeNavList`, `WorkspaceExplorer`, `MultiFolderExplorer`) changes nature by scope, duplicates its header/rail/git logic, and its Git view piles up controls. Redesign it so the **same anatomy** holds in every scope: **rail = where I am · section header = what I see · body = content**. The scope only changes the body.

## Goals

- One shell (rail + section headers + body) used by Global, single-folder workspace and multi-folder workspace.
- Git view with **one primary action** instead of ~8 controls.
- Multi-folder: one list of repositories, dirty folders open, clean ones collapsed.
- Remove folder colour from the whole app; folder identity is the name (plus a neutral folder icon).

## Non-goals / anti-goals

- No new IPC methods, no main-process changes, no change to git semantics (stage/commit/discard behave as today).
- Do not build new content for Starter Pack / Marketplaces / Diagnóstico — they stay canvas pages.
- Anti-goal: a design that needs per-view bespoke chrome. If a view needs its own header style, the shell is wrong.

## Decisions (the user's)

1. **Global (Início):** the four destinations — Workspaces, Starter Pack, Marketplaces, Diagnóstico — live **only in the rail** (no duplicate rows in the body). The rail icon opens its page on the canvas (as today). The body is always the **workspaces list**: header "Workspaces" with `＋`, search field, recents with relative time, "Ver todos (n)…".
2. **Workspace rails:** Arquivos · Git · Terminais, with counters (git changed files, running terminals). "Início" leaves the workspace rail; the TopNav context switcher already covers going back.
3. **Arquivos:** the headerless action strip goes away. Sections "Editores abertos" (collapsible, with count) and "Arquivos" (title + `👁 ⟳` actions in the section header). Same `ContainerHeader` language as the right panel.
4. **Git (single folder):** header `⎇ branch ⟳ ⋯`; sections **Staged · n** (header action `−` unstage all) and **Changes · n** (header actions `＋` stage all, `↶` discard all); one primary button pinned at the bottom, **"Commit (n)"** (disabled when nothing is staged). The staged/changes chips and the Stage all / Unstage all / Commit… text buttons are removed.
5. **Git (multi-folder):** one "Repositórios" list. Each folder row: neutral folder icon · name · `⎇ branch` · changes pill. Dirty folders expanded (files + "Commit (folder)…"), clean ones collapsed ("limpo"), folders without git are a single muted line "sem git · iniciar" (no init card). Commit stays per folder (each folder is its own repository).
6. **Multi-folder Arquivos:** top-level rows are folders with name, branch and changes pill. **No colour dots.**
7. **Terminais (multi-folder):** grouped by folder (collapsible group headers, like Git); the "＋" menu loses its dots. The only colour left is terminal **status** (running/ended).
8. **Folder colour removed everywhere:** delete `FOLDER_PALETTE`, `SHARED_COLOR`, `folderColor()` from `src/renderer/lib/folder-identity.ts` (keep `basename`); remove uses in `MultiFolderExplorer`/`FolderTree` (`rootColors`), `TerminalsSection`, `CustomizationsList` (`accent`), `NewSessionDialog`. In all of these the folder name is already rendered as text, so no information is lost.
9. **Delivery:** two commits on one branch, in this order — (1) remove folder colour, (2) explorer redesign. Per the project owner's rule: implement fully, review, then commit; no commit-per-step.

## Constraints

- Hexagonal rules unchanged; this is renderer-only. Imports use `.js` extensions; strict TS flags on.
- Existing behaviours to preserve: clicking the active rail icon collapses the panel; Git status polls only while the panel is visible; sessions survive scope switches (see CLAUDE.md "Two data dirs at once"); Início never mounts git hooks.
- Green `npm run lint`, `npm run typecheck`, `npm test` is a release gate. Existing renderer tests for the explorer, `SessionsTreeGroup`, terminals and customizations will need updating along with the code.
- Read before editing: `docs/reference/architecture.md`.

## Builder's calls (mine — check these)

- The Terminais rail counter keeps counting **running** terminals only (as today).
- Section collapse state ("Editores abertos", repo rows, terminal groups) is per-view and not persisted across sessions, except where the code already persists group state (`PersistedGroup` in Customizations).
- "Commit (n)" opens the existing `CommitPopover`; no new commit UI.
- A folder with git but a read error shows the existing alert icon on its row instead of the per-folder toolbar.
- Single shared section-header component is reused from `ContainerChrome` (extend it if needed) rather than a new one.

## Left to the builder

Component split and file names, whether `WorkspaceExplorer` and `MultiFolderExplorer` merge into one component parameterised by folders (preferred: a single-folder workspace is the N=1 case), test structure, and exact spacing/typography within the existing theme tokens.

## Wireframes (normative for layout and order)

Rail on the left (`|`), then section headers in CAPS, then rows. `●n` = counter on a rail icon. `[M 3]` = changes pill (the only coloured element of a folder row). Source HTML: `.superpowers/brainstorm/*/content/explorer-full-v1.html` (local, gitignored).

**Global** — rail: Workspaces · Starter Pack · Marketplaces · Diagnóstico (active one marked `>`)
```
>📂 | WORKSPACES                ＋
 ★  | [🔍 Buscar…              ]
 🛒 | 📁 ai-companion     agora   (active row highlighted)
 🩺 | 📁 engine-api        2h
    | 📁 docs-site       ontem
    | Ver todos (12)…
```

**Workspace, single folder — Arquivos** — rail: Arquivos · Git●n · Terminais●n
```
>▤  | ▸ EDITORES ABERTOS          2
 ⎇4 | ▾ ARQUIVOS               👁 ⟳
 ▣2 | ▾ src
    |   ▾ main
    |       index.ts [M]
```

**Workspace, single folder — Git**
```
 ▤  | ⎇ main                    ⟳ ⋯
>⎇4 | ▾ STAGED · 1                 −
 ▣2 |     env.ts                   A
    | ▾ CHANGES · 3              ＋ ↶
    |     index.ts                 M
    |     App.tsx                  M
    | [        Commit (1)         ]   ← pinned bottom, primary
```

**Workspace, multi-folder — Arquivos** (folder rows: icon · name · branch · pill; no colour)
```
    | ▸ EDITORES ABERTOS          2
    | ▾ ARQUIVOS               👁 ⟳
    | ▾ 📁 web       ⎇ main  [M 3]
    |     ▸ src
    | ▸ 📁 api   ⎇ feat/x   [M 1]
    | ▸ 📁 infra     ⎇ main          (dimmed = clean)
```

**Workspace, multi-folder — Git** (dirty open, clean collapsed, no-git = one muted line)
```
    | REPOSITÓRIOS                 ⟳
    | ▾ 📁 web       ⎇ main  [M 3]
    |     index.ts                 M
    |     App.tsx                  M
    |     Commit (web)…              ← link-style, opens CommitPopover for this folder
    | ▸ 📁 api   ⎇ feat/x   [M 1]
    | ▸ 📁 infra   ⎇ main · limpo    (dimmed)
    | ▸ 📁 notes     sem git · iniciar (dimmed; click inits)
```

**Workspace, multi-folder — Terminais** (grouped by folder; status dot is the only colour)
```
    | TERMINAIS                    ＋
    | ▾ 📁 web
    |     ● dev server         rodando
    | ▾ 📁 api
    |     ● testes  src        rodando
    | ▸ 📁 infra                       (dimmed)
```
`＋` menu items: "📁 Novo terminal em <folder>" (no dot), then "Novo terminal na raiz do workspace".

**Customizações / Nova sessão (multi):** same structure as today; the coloured dot on group headers and folder checkboxes becomes the neutral 📁 icon.

## Not verified

Mockups are HTML wireframes, not the running app. Real rendering — dark theme contrast, glyph availability, narrow-width wrapping of the repo rows, and light theme — must be checked in the app after implementation.
