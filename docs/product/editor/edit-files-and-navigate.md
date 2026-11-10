---
title: Edit files and navigate the workspace
description: Manage files in the Explorer, work with editor tabs, find files and text fast, and open files with other apps or from outside the workspace.
---

# Edit files and navigate the workspace

The Explorer panel (left) holds the file tree of the active workspace; the editor tabs sit in the Workbench (centre). This guide covers the day-to-day loop: change files, move between them, and keep unsaved work safe. Method-level details: [IPC contract](../../technical/reference/ipc-contract.md).

**Prerequisite:** an open workspace. The file tree, project search and "open by name" are not available at Início.

Shortcuts below use the macOS form (`⌘`); on Windows and Linux read `⌘` as `Ctrl`. The same list is in the app's **Atalhos de teclado**.

## Manage files in the Explorer

Select **Arquivos** in the Explorer rail. Right-click a row (or the empty area for the workspace root) for the menu.

1. **Create:** right-click a folder, then **Novo arquivo** or **Nova pasta**. Type the name and press Enter (Esc cancels). Names cannot contain slashes or be `.` / `..`; an invalid or used name keeps the field open with the reason under it.
2. **Rename:** select the row and press `F2`, or right-click then **Renomear**. Open tabs follow the new path.
3. **Duplicate:** **Duplicar** creates a copy next to the original.
4. **Delete:** **Mover para a lixeira** (`Del`, or `⌘⌫` on macOS). Nothing is deleted permanently: the item goes to the system trash. A confirmation dialog appears first; tick **Não perguntar novamente** in it, or untick **Confirmar antes de mover para a lixeira** under **Configurações → Editor e Explorer**, to skip it. Open tabs for a trashed file stay open and show a warning (see below).
5. **Select several rows:** `Shift`+click for a range, `⌘`+click to toggle. `Esc` clears the selection. Actions apply to the whole selection.

Other row actions: **Copiar caminho**, **Revelar no Finder**, **Abrir terminal aqui**, **Abrir como workspace** (folders) and, in the toolbar above the tree, the eye button (**Mostrar arquivos ocultos** / **Ocultar arquivos ocultos**) and **Reler do disco**.

### Copy, move and drag and drop

- **Copy / move with the keyboard:** select rows, `⌘C` (**Copiar**) or `⌘X` (**Recortar**), select the destination folder, `⌘V` (**Colar**). With nothing selected, paste goes to the workspace root.
- **Drag and drop:** drag rows onto a folder to **move** them. Hold `Alt` (`Ctrl` on Windows and Linux) to **copy** instead; a hint follows the cursor. You cannot drop a folder into itself.
- **From Finder:** drag files or folders from outside onto a folder in the tree. They are always **copied** in.
- **Undo:** after a copy or move, the toast offers **Desfazer**; `⌘Z` in the tree does the same for the last operation.

When the destination already has an item with that name, a dialog titled `"nome" já existe aqui` asks what to do:

| Button | Effect |
|---|---|
| **Pular** | Leaves this item out. |
| **Manter ambos** | Keeps both, giving the new one a different name. |
| **Substituir** | Overwrites. The original goes to the system trash, and the toast says so. |

If several items conflict, tick **Aplicar a todos (N conflitos)** to give one answer for all. When a file and a folder share a name, **Substituir** is not offered.

## Work with editor tabs

Opening a file from the tree creates a tab (opening it again focuses the existing one). Right-click a tab for:

- **Fixar aba** / **Desafixar aba:** a pinned tab moves to the start of the strip, behind a divider, and shows no close button. Bulk closes never touch pinned tabs.
- **Fechar**, **Fechar outras**, **Fechar à direita**, **Fechar salvas** (closes every tab without unsaved changes).
- **Copiar caminho** and **Revelar no Explorer**.
- **Reabrir aba fechada** (`⇧⌘T`): brings back the most recently closed file tab, pinned state included. The app remembers the last 20 closed file tabs.

Reorder tabs by dragging one onto another. A tab never crosses the divider between pinned and unpinned tabs. The **Visão geral** tab is always first and cannot be closed (`⌘0` focuses it). The **Editores abertos** section in the Explorer lists every open tab, with a button to close them all.

A dot on a tab means unsaved changes. Save with `⌘S` (**Salvar**) or `⌥⌘S` (**Salvar tudo**). If a file is removed from disk while its tab is open, the tab shows "Este arquivo foi removido do disco" and keeps your text: save to recreate it, or close the tab.

### Unsaved-changes guard

Closing tabs with unsaved changes asks first: **Salvar alterações em `nome`?** with **Não salvar**, **Cancelar** and **Salvar** (**Salvar tudo** when several tabs are affected, listed in the dialog). Enter saves, Esc cancels. The same guard runs when you bulk-close tabs, switch to another workspace or Início, and quit the app. If a save fails, nothing is closed.

## Find files and text

| What | How |
|---|---|
| Open a file by name | `⌘P` (menu **Editar → Abrir arquivo por nome…**). Fuzzy match on the path; with an empty field it lists recent files. Enter opens the first result. |
| Jump to a line | `⌘G`, or type `:` in the palette, then the line number. Works only with an editor tab in front. |
| Search everything | `⌘K` (or the search field in the top bar) searches sessions, skills and agents, files of the open workspace and actions in grouped sections; with nothing typed it lists the sessions that are live (the ones waiting on you first). ↑↓ moves the selection, Enter opens it. A prefix narrows it to one section: `@` files, `#` sessions, `/` skills and agents, `>` actions (`⇧⌘P` opens with `>` already typed). The last row, **Perguntar ao Claude**, starts a new session in the channel shown in the chip beside the field (the first enabled one installed) with your text typed as an unsent draft; `⌘↵` does it even when a result is selected. The top-bar field shows a badge when sessions are waiting on you. |
| Search inside the file | `⌘F` in the editor. |
| Search the whole project | `⇧⌘F`, or **Buscar** in the Explorer rail. Toggles: **Aa** (case), **ab** (whole word), **.\*** (regular expression). Results are grouped by file; click one to open the file at that line. The list is capped at 2,000 results and says so. |

In the palette, `>` switches to commands, `:` to line number; delete the prefix to go back to files.

## Open with another app

Right-click a file or folder, then **Abrir com**. The submenu lists applications registered for that type (macOS only), with **Abrir com o aplicativo padrão** and **Escolher outro app…**. The app you pick is remembered for that file extension. On other platforms only the default-app entry is offered.

For a file, **Abrir no navegador** opens it in the app's embedded browser. This is a plain `file://` view: it does not reload on save.

## Files outside the workspace

You can edit a file that is not in any workspace folder:

- **Abrir arquivo…** in the command palette (`⌘K`) opens the native file picker.
- Drop a file from Finder onto the editor area.

The file opens in an editable tab; save writes to the original location. Access is granted per file and forgotten when the app restarts, and these tabs are not offered by **Reabrir aba fechada**. Dropping a folder on the empty window at Início opens it as a workspace.

## View spreadsheets

`.xlsx` and Numbers files open as a read-only grid with column letters, row numbers, a formula bar for the selected cell, merged cells, frozen rows and resizable columns. Formulas show their cached result; when the file has none, the app computes it, and a cell it cannot compute shows the formula text muted. Large sheets are truncated with a notice; editing happens in your spreadsheet app (use **Abrir com**).

## Editor settings

**Configurações → Editor e Explorer**:

- **Quebra de linha nos editores:** word wrap in every editor, on by default.
- **Confirmar antes de mover para a lixeira:** the trash dialog above, on by default.

Large text files open truncated (editing is disabled so the file is not saved incomplete); binary files and files over the size limit show **Não é possível pré-visualizar** with the reason.
