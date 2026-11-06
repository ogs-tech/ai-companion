# Desktop basics: safety net, native conventions, title and header

Status: implemented, pending user review and manual testing · Date: 2026-11-05 · Source checklist: `~/Downloads/spec.md` (generic "basic desktop app" checklist)

Choices the user made are marked **Decided**. Everything else is the author's call and is marked **Call**.

## Intent

The checklist is a generic bar for desktop apps. An audit of the code (2026-11-05) shows AI Companion
meets very little of it, and the gaps that hurt are not cosmetic:

- The editor already tracks dirty state (`onDirtyChange` in `EditorPanel.tsx`), but nothing uses it:
  closing a tab or the app discards unsaved work without a word.
- There is no global error capture (`uncaughtException`, `render-process-gone`, an error boundary), no
  log file. A renderer crash leaves a blank window with no explanation.
- There is no native menu. ⌘Q, ⌘, and Copy/Paste rely on defaults, and shortcuts are scattered across
  four `keydown` listeners (`AppShell.tsx`, `WorkspaceScreen.tsx`, `EditorPanel.tsx`, `SessionPanel.tsx`).
- The window is fixed at 1024×768 with no minimum size and no memory of where the user left it.
- The OS title bar says only "AI Companion" and the 40px header (`TopNav.tsx`) repeats the name. Neither
  says where the user is.

The checklist's own acceptance test is the target: **no data is lost without warning, no error closes
the app silently, the UI never freezes, everything can be done from the keyboard.**

## Goals

- No unsaved edit is lost without the user being asked first.
- No error closes the app or blanks the window without an explanation and a way to recover.
- A native menu exists on every OS and is the single registry of shortcuts.
- The window remembers its size, position and maximized state.
- Title bar and header together answer "where am I?" without repeating the app name.

## Non-goals

- Checklist items that do not fit an IDE-like harness manager: Print, New document, Save As,
  CPF/e-mail format validation. **Call.**
- A custom (frameless) title bar, a hamburger menu, or any window-chrome work. **Decided** (see Header).
- Auto-update delivery itself. Only a "Check for updates" entry and the About dialog are in scope, and
  only if an update channel exists; if none does, the entry is omitted rather than stubbed. **Call.**
- Making workspace switching faster. The user wants it to be performant, but nothing has been measured, so
  it is a separate spec (see Deferred). This spec must only avoid making the switch slower: the dialog
  swap above adds no work to the switch path.
- Changing the session attention states, the Sessions panel, or the explorer redesign (separate specs).
- Cursor/Claude adapters, IPC schema of entities, anything in `docs/reference/customization-schema.md`.

## Anti-goals

- A confirmation dialog for every action. Dialogs are for the one case below; elsewhere prefer undo/toast.
- A status bar full of rarely useful data. Each item must change what the user does next.
- Windows and Linux users hunting for the menu. Native chrome stays native on each OS.

## Constraints

- The author only has macOS. Windows and Linux layout is written to Electron's documentation and is
  **not verified visually**; the plan must keep it behind plain `process.platform` checks and call it out.
- Hexagonal rule (`CLAUDE.md`): services depend on ports, not `electron` or `node:fs`. Logging, window
  state and drafts need ports with adapters in `infrastructure/`.
- Every new IPC method follows the `ipc:call` contract and is documented in `docs/reference/ipc-contract.md`.
- Strict TS flags, `.js` import extensions, lint + typecheck + tests green before done.
- UI strings in pt-BR; code, comments, identifiers and tests in English.
- Terminal sessions live in the main process (`SessionService`, node-pty), so they survive a renderer reload.
  This is why the recovery screen can truthfully say sessions keep running (verified in code 2026-11-05).

## Design

### 1. Unsaved changes. Decided: classic dialog

Closing a tab with unsaved edits, closing a workspace, or quitting (⌘Q, ⌘W on the last window, window
close) shows a dialog: **Salvar / Não salvar / Cancelar**. Enter = Salvar, Esc = Cancelar. "Não salvar" is
styled as the destructive action. With several dirty tabs on quit, the dialog lists them and offers
"Salvar tudo". The title bar and the status bar both flag dirty state (see sections 4 and 5).

No draft-and-undo flow was chosen. Autosave is **not** part of this spec's decided scope. **Call:** a
separate crash-recovery draft is deferred (see Deferred) because the user chose the classic dialog.

**Call, who owns the dialog.** Dirty state lives in the renderer (`WorkspaceScreen` receives it from
`EditorPanel` via `onDirtyChange`), while quit and window close are main-process events. So:
- Closing a tab or workspace uses an in-app MUI dialog (it can list the dirty tabs and offer "Salvar tudo").
- Quitting (⌘Q, window close on Windows/Linux, dev) goes through a main→renderer request: main intercepts
  `before-quit`/`close`, asks the renderer whether anything is dirty and waits for the answer with a short
  timeout (~3 s). If the renderer answers, the same in-app dialog runs. If it does not answer (crashed or
  frozen), main quits without asking, because a frozen renderer cannot be saved anyway and the app must
  never become impossible to close.
- **Lifecycle, verified in `src/main/index.ts` (`window-all-closed`):** in production on macOS, closing the
  window does not quit the app, so terminal sessions keep running until ⌘Q; on Windows/Linux and in dev it
  quits. ⌘W with no tab open closes the window. There is one window.

**Workspace switch (verified in code 2026-11-05).** A guard already exists: `registerUnsavedTabsGuard` /
`confirmDiscardUnsavedTabs` (`src/renderer/lib/workspace-tabs-guard.ts`) is called by `ContextSwitcher`,
`use-context-navigation`, `use-area-navigation` and the history store, and `resetTabs()` in
`WorkspaceScreen.tsx` answers it with two blocking `window.confirm` calls ("N aba(s) com alterações não
salvas. Descartar tudo?" and "N terminal(is) em execução serão encerrados…"). So a switch already asks
before discarding; the gap is that the question is binary (Descartar / Cancelar) and offers no way to save.
**Call:** keep that guard as the single entry point and replace its two `window.confirm` calls with this
spec's in-app dialog (Salvar / Não salvar / Cancelar for dirty tabs; a separate confirm for running
terminals stays, restyled). The switch itself is not changed by this spec.

### 2. Errors. Decided: details inside the app

- **Operation failure** (save, git, network): a persistent toast anchored to the action, in the form
  *what happened + what to do*, with a primary action ("Tentar de novo") and a "Detalhes" disclosure that
  expands the technical error in place plus "Copiar detalhes".
  **Call:** the mockup shows "Salvar em outro lugar", but Save As is a non-goal (it needs a native file
  picker and a new IPC), so that action is dropped. The message says what to do instead ("Verifique a
  permissão da pasta e tente de novo").
  **Call, scope:** the reusable toast and the human-message mapping apply to **save and git** failures
  only. Sweeping every other `callIpc` failure (sync, sessions, network) is a follow-up, not this spec.
  Errors never apologize and are never vague. The cases to map to human messages: file not found, no
  permission, disk full, offline, timeout. Everything else gets a generic message plus Detalhes.
- **App failure**: capture `uncaughtException` / `unhandledRejection` in main and the renderer's
  `render-process-gone` / `unresponsive` events, plus an error boundary around the renderer root. A
  recovery screen replaces the blank window: title "O AI Companion encontrou um problema", a line that
  terminal sessions keep running, buttons **Recarregar** and **Copiar detalhes**, details expandable.
- **Log file**: every captured error is written to `~/.ai-companion/logs/` (date, app version, process,
  stack). Rotated by size/age (**Call**: 5 files × 1 MB). A Help menu entry opens the folder.
- Details are copied to the clipboard only on the user's action. Nothing is sent anywhere (no telemetry,
  see `CLAUDE.md`).

### 3. Window and menu

- **Call:** minimum size 800×560; size, position and maximized state persisted and restored. A saved
  position that is off-screen (monitor removed) falls back to centered.
- **Decided:** native menu on every OS: **Arquivo, Editar, Exibir, Sessões, Janela, Ajuda**; on macOS the
  first menu carries the app name (Sobre, Configurações ⌘,, Sair ⌘Q).
  - *Arquivo*: Abrir pasta ⌘O, Abrir recente ▸, Salvar ⌘S, Salvar tudo ⌥⌘S, Fechar aba ⌘W, Fechar
    workspace ⇧⌘W, Configurações ⌘,.
  - *Editar*: Desfazer, Refazer, Recortar, Copiar, Colar, Selecionar tudo, Buscar no arquivo ⌘F,
    Paleta de comandos ⌘K.
  - *Exibir*: Painel de arquivos, Painel Git, Terminais, Tema ▸ (Sistema/Claro/Escuro), zoom in/out/reset,
    Tela cheia.
  - *Sessões*: Nova sessão, Ir para a que precisa de você, Encerrar sessão, Ir para Início, Próximo
    workspace.
  - *Janela*: Minimizar, Ampliar, Trazer tudo para a frente.
  - *Ajuda*: Documentação, Atalhos de teclado, Abrir pasta de logs, Verificar atualizações (only if an
    update channel exists), Sobre.
- **Call:** the menu is the single shortcut registry. The four scattered `keydown` listeners become menu
  accelerators or a small renderer-side registry fed from the same table. Shortcuts show `⌘` on macOS and
  `Ctrl` elsewhere.
- **Call, menu state:** menu items only fire events to the renderer; the menu does not mirror renderer
  state. Items that do not apply (Salvar with nothing dirty, workspace items at Início, ⌘F outside the
  editor) do nothing in the renderer instead of being greyed out, and the Tema submenu has no check mark.
  This avoids a continuous renderer→main state channel. If greying out is wanted later, it is a follow-up.
- **Decided (final keys):** *Sessões*: Nova sessão ⇧⌘N, Ir para a que precisa de você ⇧⌘J, Encerrar sessão
  ⇧⌘K, Ir para Início ⇧⌘H, Próximo workspace ⌃⇧] (Ctrl+Tab is captured by the embedded terminal; ⌘H hides the
  window on macOS). The table lives in `src/shared/desktop.ts` (`SHORTCUTS`). ⌘0 (Visão geral) and Ctrl+`
  (terminal) remain renderer-only listeners: they are not in the menu.
- Context menu (right click): Cut/Copy/Paste/Select all in text inputs and the editor; richer entity menus
  are out of scope here. **Call.**

### 4. Title bar and header. Decided: native bar + A2

Each OS keeps its **native title bar**. No frameless window, no custom window controls.

**Window title** (also `document.title`; macOS additionally calls `setDocumentEdited` so the close button
shows the unsaved dot):

| Situation | Title |
|---|---|
| Início, no tab open | `Início — AI Companion` |
| Workspace open, no file | `<workspace>` |
| File tab active, saved | `<file> — <workspace>` |
| File tab active, unsaved | `<file> ● — <workspace>` |
| Terminal session active | `<session title> — <workspace>` |
| Settings screen | `Configurações — AI Companion` |
| Skill/agent/instruction/MCP/hook editor tab | `<entity name> — <workspace>`, with `●` when unsaved (same as a file) |
| Git diff tab | `<path> (diff) — <workspace>` |
| Recovery screen | `AI Companion` |

**Header (`TopNav`, 40px), A2:**
- Remove the logo and the repeated "AI Companion" text.
- Keep, left to right: back, forward, workspace switcher, the centered ⌘K search trigger (shows `Ctrl K`
  off macOS).
- Right side in two groups separated by a divider: [toggle left panel, toggle right panel] and
  [open browser, settings]. Six icons become four.
- The theme toggle leaves the header; theme stays in *Exibir > Tema* and in Settings.

### 5. Status bar. Decided: one global thin bar

A new bar (~24px) at the bottom, always visible, the same on every screen. Left: workspace name and git
branch (workspace only; blank at Início). Right: save state of the active file ("Alterações não salvas" in
the warning colour, or "Salvo às 12:30"), then the count of sessions that need the user ("! 1 sessão
precisa de você", clickable, jumps to it), then cursor position (editor only). It reuses the attention
state model from `2026-11-03-session-attention-states-design.md`; it adds no new detection. **Decided:** it replaces `AppFooter`
(`StatusBar.tsx`): sync health and harness adapters moved to its right side; the company line left the bar and
lives in Ajuda › Sobre.

### 6. Keyboard and accessibility. Call

Everything reachable from the menu or the ⌘K palette; visible focus ring on every interactive control;
logical Tab order; accessible labels on icon-only buttons (the header icons already have `aria-label`);
dialogs trap focus and restore it on close.

## Deferred (not decided, not built here)

- **Workspace switch performance (own spec, measure first).** What the code does on every switch
  (`activate()` in `src/main/index.ts`): kills entity sessions and all terminals, closes manual browser
  tabs, stops the entity watcher, rebuilds the whole workspace-scoped service graph, re-points
  `SessionService`; then the renderer wipes its tabs and rehydrates from `openEditors`. Workspace/Início
  sessions already survive. Open questions for that spec: where the time actually goes, what "fast enough"
  means to the user, and whether terminals and tabs should stay alive per workspace instead of being
  killed and rebuilt.

- Autosave and crash recovery of unsaved edits (would pair with a draft store).
- Required-field and validation pass on skill/agent/MCP forms (the plan should audit current behavior first).
- Drag-and-drop of folders onto the window to open them.
- Zoom persistence across restarts.

## Left to the builder

Port and adapter names; the exact set of error-to-message mappings beyond the five listed; toast layout
details; log rotation mechanics; how menu accelerators and renderer shortcuts share one table; pt-BR copy
for every string (follow the writing rules: sentence case, active voice, the same verb in the button and
its result toast); test strategy (the project is at the "green gate" bar).

## Not verified in the running app

Everything here was designed from mockups and a code audit. Visual rendering, dark theme, Windows and
Linux title-bar and menu behavior, and the macOS unsaved-dot are unverified until implemented and run.

## Approved mockups

**The approved mockups are normative for the UI.** They sit next to this file (open in a browser). Each
page has a green banner naming the approved option; the other options are rejected references. Any visual
deviation needs the user's approval. Hex values illustrate intent: use the tokens in
`src/renderer/theme.ts`, not literal colours.

- `2026-11-05-desktop-basics-mockup-unsaved-changes.html`: option A (classic dialog).
- `2026-11-05-desktop-basics-mockup-errors.html`: option A (details in the app). Ignore the
  "Salvar em outro lugar" button, it was dropped (see section 2).
- `2026-11-05-desktop-basics-mockup-status-bar.html`: option A (global thin bar).
- `2026-11-05-desktop-basics-mockup-menus.html`: option B (standard menus + Sessões, shortcuts provisional).
- `2026-11-05-desktop-basics-mockup-header.html`: option A2 (native bar + slim header). The macOS and
  Windows variants shown are the target; Windows is unverified.
