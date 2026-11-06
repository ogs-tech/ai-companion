# IDE basics: explorer, tabs, search and navigation

Status: draft for review · Date: 2026-11-05 · Source checklist: `~/Downloads/ide-spec.md` (generic "basic IDE" checklist, groups 1 to 3 only)

Choices the user made are marked **Decided**. Everything else is the author's call and is marked **Call**.

## Intent

The app is moving toward an AI-first IDE that brings the user's own harness ([ide-direction.md](../../explanation/ide-direction.md)). The editor is there to read, edit in place and review what an agent changed; it is not meant to compete with VS Code as an editor ([prd.md](../../explanation/prd.md) section 6). The checklist is a generic IDE bar. This spec takes the part of it that makes the workbench pleasant for that job, in a lean form:

- **Explorer:** know which project you are in even with a single folder, tell files apart at a glance, and organize files (create, rename, delete, copy, move, drag and drop) without losing anything.
- **Tabs:** pin, reorder, close in bulk, reopen.
- **Search and navigation:** open a file by name, jump to a line, search the project.

The checklist's own acceptance test is the target for this slice: **open a project, organize its files (drag and drop included) without losing anything, search the project, and never freeze the UI.** Terminal and editing already exist.

Current state (audit 2026-11-05): the Explorer tree (`FolderTree.tsx`) has no drag and drop, no create/rename/delete, one generic file icon (line 172), and for a single folder it lists entries with no root node. The command palette (`CommandPalette.tsx`) only navigates areas and workspaces. There is no project search. `CodeEditorView.tsx` is CodeMirror 6 with fixed line wrapping.

## Goals

- A single-folder project is named in the tree, like a multi-folder one.
- Files are recognizable by type, in light and dark.
- Every file operation in the checklist's Explorer section works, and any operation that moves or copies can be undone.
- Open tabs never lose edits because a file was renamed or moved.
- Open a file by fuzzy name, go to a line, and search text across the project, from the keyboard.

## Non-goals

- LSP features (completion, diagnostics, go to definition, rename symbol, quick fix, Problems panel), the debugger, Output panel. Checklist groups 4 and parts of 6 and 7. **Decided** (scope).
- Replace across the project. In-file find/replace stays CodeMirror's (`⌘F`/`⌘H`). **Call.**
- Minimap, multiple cursors beyond CodeMirror's defaults, code folding, split editor, encoding/EOL detection, large-file warning, project-level settings, custom shortcuts. They serve a general-purpose editor; PRD non-goal. **Call**, deferred below.
- Progress and cancel for very large operations; dragging a file out to another app. **Call.**
- Fixing the editor light/dark theme. The user fixed it separately. **Decided.**
- Cursor/Claude adapters, entity schema, anything in `customization-schema.md`.

## Anti-goals

- Losing or silently overwriting user files. Anything destructive is confirmed or recoverable.
- A second palette component, or a second tree implementation, next to the existing ones.
- Colour noise: the file-type colour must never be confused with Git status.

## Constraints

- Hexagonal rule (`CLAUDE.md`): services depend on ports, not `node:fs` or `electron`. File operations (create, rename, move, copy, trash) and project search need ports with adapters in `infrastructure/`; moving to the OS trash goes through an adapter around Electron's `shell.trashItem`.
- Every new IPC method follows `ipc:call` and is documented in `docs/reference/ipc-contract.md`.
- Paths follow the multi-folder model: with several folders, tree paths start with the folder alias and are routed back by that first segment (`folderRoutingFor`). Every new operation must work in both shapes.
- All file work runs in the main process and is asynchronous; the renderer never blocks on it.
- Flag new dependencies and alternatives before adding them. Project search: a Node walker plus regex needs no dependency; a bundled ripgrep binary is faster on large trees but adds native packaging. Fuzzy matching: an in-house scorer versus a library. **Call:** start with no new dependency and add one only if measured to be too slow.
- Strict TS flags, `.js` import extensions, lint + typecheck + tests green before done. UI strings in pt-BR; code, comments, identifiers and tests in English.
- The author only has macOS. Windows/Linux modifier keys (`Ctrl` instead of `⌘`/`⌥`) are written to the spec but unverified.

## Design

### 1. Project root node in the tree. Decided: option A

With a single folder the tree gets a root node on top, like the multi-folder alias nodes: chevron, root-folder glyph (`FolderRoot` tone azul), the folder name in bold, and the Git branch at the right. Everything else sits inside it. A single folder is the N=1 case of several, with no special rule. Paths do not change: with one folder the tree's paths stay workspace-relative with no alias (the explorer already treats a single folder as "the workspace itself" and sends git calls with no folder), so `openEditors`, persisted tabs and the file-browser API keep their format. The root node is purely visual. **Call (verified in `ExplorerPanelContent.tsx`).**

- Expanded by default; collapsing is allowed and is not persisted. **Call.**
- Context menu on the root: New file, New folder, Copy path, Reveal in Finder, Open in terminal. No rename, delete, cut or duplicate on the root. **Call.**
- The existing "registered as workspace" badge on sub-folders stays.

### 2. File icons. Decided: option B (glyph + tone by category)

Each file gets a Lucide glyph and a tone from the design-system colour roles (`colorRoles` in `tokens.ts`), in both themes. One pure function `fileIconFor(name)` returns glyph and tone; the tree, Open Editors, tabs, quick open and search results all use it. **Call (mapping):**

| Category | Examples | Glyph | Tone |
|---|---|---|---|
| Code | ts, tsx, js, jsx, mjs, cjs, py, go, rs, java, css, html, sh | file-code | azul |
| Data / config | json, yaml, yml, toml, xml, env | file-json | ambar |
| Docs / text | md, mdx, txt | file-text | slate |
| Media | png, jpg, jpeg, gif, webp, svg, ico | image | verde |
| Anything else | other, no extension | file | muted (no tone) |

Folders keep the neutral folder glyph. `erro` is not used: it is reserved for errors and Git deletions. A file's Git state stays on the name colour and the M/A/? badge; the glyph tone never changes with Git state, so the two signals do not mix. The mockup's rejected concern (colour competing with Git) is handled by that separation.

### 3. Explorer operations

All from the context menu (approved mockup) and the keyboard. The menu has: New file, New folder, Rename `F2`, Duplicate, Copy `⌘C`, Cut `⌘X`, Paste `⌘V`, Copy path, Reveal in Finder, Open in terminal, Move to trash `⌘⌫`.

- **Create and rename** happen inline in the tree: a text field in place; Enter confirms, Esc cancels; on rename only the base name is pre-selected. An invalid or already-used name shows its message under the field, no dialog. **Call (details).**
- **Duplicate** creates `name copy.ext`, then `name copy 2.ext`. **Call.**
- **Copy/Cut/Paste** use an in-app clipboard of paths, active only when the tree has focus, so they never fight CodeMirror or the terminal. Paste into a folder, or beside a selected file. **Call.**
- **Delete. Decided: confirmation dialog.** "Mover "x" para a lixeira?" with the OS trash as the destination (recoverable from Finder). The dialog has a "Não perguntar novamente" checkbox, stored in the global `Settings`, with a way to turn the confirmation back on from the Settings screen. **Call (checkbox and where it lives).** No undo toast for delete: the trash is the way back. Note: the user chose dialogs for destructive actions in this spec, which differs from the neighbouring desktop-basics preference for undo; the rule used here is "dialog when something is deleted or overwritten, Undo when something is only moved or copied".
- **Open tabs follow the file.** Rename or move retargets the tab's path without losing its content or dirty state. Deleting a file that is open leaves the tab open, marked as removed, keeping its unsaved content so it can be saved elsewhere or closed. The same applies per tab when a folder holding open files is moved or deleted. A rename done outside the app looks like a removal to the watcher, so its tabs are marked removed too. **Call.**
- **External changes.** The tree refreshes when files change outside the app. Today the file watcher only covers entities, so it must be extended to the workspace tree. Ignored folders (`node_modules`, `.git`, `bin`, `obj`) are a fixed default list used by the watcher and by search; the Explorer display keeps the existing show-hidden toggle. **Call.**
- **Git markers** (modified, new, ignored) already exist; the checklist's error markers are out (they need LSP).

### 4. Drag and drop in the Explorer. Decided: conflict option A

Behaviour approved from the mockup:

- **Inside the tree:** drag a file/folder (or a multi-selection) onto a folder to move it. Holding `⌥` (macOS) / `Ctrl` copies instead; the drag ghost shows "+ copiar". The target folder is highlighted; a closed folder expands after ~500 ms of hover; the tree auto-scrolls near its edges; invalid targets (the item itself or its own subfolder) are dimmed with a not-allowed cursor; dropping where it came from does nothing. Multi-select needs `⌘`/`⇧` click in the tree, which it may not have today (builder to check).
- **From outside:** dropping files/folders from Finder on the tree copies them into the target folder. Dropping a file on the editor area opens it in a tab, **editable and savable even when it lives outside the workspace roots. Decided.** This needs a path to read and write one absolute file outside the roots. **Call (safeguard):** the main process only accepts such a path if it came from a drop or an explicit "Abrir arquivo…" the user just did (a granted-path list kept in the main process), never from an arbitrary path sent by the renderer; the tab shows the full path, and external tabs are not restored when the project is reopened. Dropping a folder on an empty window (Início) opens it as a workspace; this picks up the deferred item from desktop-basics. Dragging a tree file onto the editor opens it.
- **Cross-folder (multi-folder workspaces):** a drag between two workspace folders always copies, never moves. **Call.**
- **Name conflict. Decided: dialog "Substituir / Manter ambos / Pular"**, with a "Aplicar a todos (n conflitos)" checkbox. **Call (details):** Replace sends the old file to the OS trash instead of deleting it; "Manter ambos" names the arrival `logo 2.png`. A folder dropped on a folder of the same name merges recursively and asks per file, only for the files that actually collide (Replace never trashes a whole folder tree). A file and a folder with the same name collide with only "Manter ambos" and "Pular" offered, never Replace.
- **No confirmation before a move or copy.** Instead, after any move/copy a toast offers **Desfazer** (also `⌘Z` while the Explorer has focus). Undo covers the last operation only. If it replaced files, undoing restores the moved items but the replaced originals stay in the OS trash (Electron does not return their trash path), and the toast says so. Undoing a move moves the items back; undoing a copy sends the copies to the trash; if the state changed since (target gone, file edited), the undo fails with a clear message. **Call.**
- **Errors:** no permission, file in use, disk full, path too long are mapped to plain pt-BR messages through the existing `operation-error` helper and shown in a toast. A multi-item operation reports which items failed and still completes the rest. **Call.**

### 5. Tabs. Decided: pinned tab compact (option A)

Approved mockup: a pinned tab shrinks to the file-type icon, sits on the left behind a thin divider, and its name is in the tooltip. Pinned tabs are always left of the others.

- Unsaved: `●` replaces the `×`; the `×` returns on hover. Closing a dirty tab uses the existing unsaved-changes dialog from desktop-basics.
- Close with middle click or `⌘W`. Drag a tab to reorder. Context menu: Close, Close others, Close to the right, Close saved, Pin tab, Copy path, Reveal in Explorer, Reopen closed tab `⇧⌘T`. Bulk closes never close a pinned tab and never discard a dirty one without asking.
- **Reopen closed** restores the last 20 closed tabs, most recent first. **Call.**
- **Restore on reopen:** the renderer already rehydrates tabs from `openEditors` when a workspace activates; the builder checks what is already restored and adds only the pinned flag and the active tab if missing. The pin flag and tab order are saved with `openEditors`, so they are per workspace. **Call.**

### 6. Editor, lean. Call

Only one editor change: a **word wrap toggle**. Today wrapping is always on; keep it as the default, expose it as a user setting reachable from the View menu defined in desktop-basics, and apply it live. The setting is global (`Settings`), not per workspace. **Call.** Folding, minimap, encoding/EOL and large-file warnings are deferred.

### 7. Search and navigation

- **One palette, three modes. Decided: option A.** `⌘P` opens the existing `CommandPalette` in file mode (fuzzy match over the workspace files, ignoring the default ignored folders; recently opened files first, **Call**). `⇧⌘P` opens it with `>` typed (commands, today's behaviour). `⌘G` opens it with `:` (go to line in the active editor). Deleting the prefix switches mode. The existing palette shortcut from desktop-basics (`⌘K`) stays as an alias. Each file result shows its type icon, the match highlighted, and the folder path.
- **Search in project panel (approved mockup).** A new view `search` next to Arquivos/Git/Terminais in the rail (extends `ExplorerView`). Query field with three toggles: match case, whole word, regex. Results are grouped by file with a count, each hit showing line number and text with the match highlighted; the header says "n resultados em m arquivos". Clicking a hit opens the file at that line and selects the match. Shortcut `⇧⌘F` focuses it.
- **Limits. Call:** search runs in the main process, debounced 250 ms, a new query cancels the previous one; text files only, skipping binary files, files above 1 MB and the ignored folders; stops at 2000 matches with a "mostrando os primeiros 2000" notice.
- **Scope. Call.** At Início there is no file browser: `⌘P` and project search are disabled there (the palette keeps its commands). In a multi-folder workspace both cover every folder, with results prefixed by the folder alias; the search IPC takes no folder parameter by default and routes by alias like the tree.
- **Not in this slice:** replace in project, go to definition/references, navigate back/forward between positions. **Call.**
- **Shortcut scoping. Call.** `⌘Z` undoes an Explorer operation only while the tree has focus; with the editor focused it stays CodeMirror's text undo. `⌘G` opens go to line only when an editor tab is active, otherwise it does nothing; it is "find next" in many macOS apps, so check it does not collide with CodeMirror's keymap. All new shortcuts go in the single native-menu table from desktop-basics, and must not shadow xterm or CodeMirror when those have focus.

## Suggested phasing

Each phase ships on its own: (1) root node and file icons, (2) file operations and context menu, (3) drag and drop with conflicts and undo, (4) tabs, (5) palette modes and project search. The plan decides the final order.

## Deferred (not decided, not built here)

LSP and Problems panel; debugger; Output panel; replace in project; navigate back/forward; minimap; folding; encoding/EOL detection; large-file warning; split editor; per-project settings; custom shortcuts; progress and cancel for very large operations; dragging a file out to another app; per-folder ignore list as a setting.

## Left to the builder

Port and adapter names and the IPC method names and namespace (follow the existing file-browser one); how the file watcher is extended from entities to the tree; the fuzzy scorer; the search walker and whether it needs a worker; how multi-select is added to the tree if absent; clipboard and undo-stack structure; test strategy (green gate bar); exact pt-BR copy for every string (sentence case, active voice, same verb in the button and its toast); keyboard focus and ARIA for the tree edit field, drag targets and the palette modes.

## Not verified in the running app

Everything here was designed from mockups and a code audit, not from the running app. Visual rendering, dark theme (the mockups include light and dark for the icons only), drag and drop with real OS drags, the OS trash, Windows and Linux modifier keys and layout, and the editor behaviour are unverified until implemented and run.

## Approved mockups

**The approved mockups are normative for the UI.** They sit next to this file (open in a browser). Each page has a green banner naming the approved option; the other options are rejected references. Hex values illustrate intent: use the tokens in `src/renderer/theme.ts`.

- `2026-11-05-ide-basics-mockup-root-and-icons.html`: root node A, icons B.
- `2026-11-05-ide-basics-mockup-drag-drop-conflicts.html`: drag behaviour as shown, conflict option A.
- `2026-11-05-ide-basics-mockup-context-menu-delete.html`: menu and inline edit as shown, delete option A.
- `2026-11-05-ide-basics-mockup-tabs.html`: menu and rules as shown, pinned tab option A.
- `2026-11-05-ide-basics-mockup-search-and-palette.html`: project search as shown, palette option A.
