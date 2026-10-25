---
title: IPC contract
description: Methods exposed by the preload bridge from the renderer to the main process — naming, params, results and error shape.
---

# IPC contract

A single Electron IPC channel routes every renderer ↔ main call. The renderer sends a `{ method, params }` envelope; the main process dispatches by method name and replies with a typed `IpcResult`.

## Wire shape

```ts
const IPC_CHANNEL = 'ipc:call';

interface Envelope { method: string; params: unknown; }

type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };

interface IpcError {
  kind: IpcErrorKind;
  message: string;
  details?: Record<string, unknown>;
}

type IpcErrorKind =
  | 'validation'
  | 'io'
  | 'symlink_conflict'
  | 'not_found'
  | 'external_api'
  | 'unauthorized'
  | 'auth'
  | 'conflict'
  | 'internal';
```

Defined in [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts).

## Push channels (exception to request/response)

Every method above is request/response over `ipc:call`. One exception: `session:output` and `session:exit` (defined in [`src/shared/session.ts`](../../src/shared/session.ts)) stream live PTY output and report a session's exit code while a `claude` process spawned via `session.spawn` is running — that streaming can't fit the request/response `ipc:call` envelope. **Multiple sessions can be live at once** — one per anchor for `entity`, but any number for `workspace`/`personal` (see [`session`](#session) below) — so preload itself filters by `sessionId` before invoking the renderer's listener — there's no single "the" session to assume, and `sessionId` is only the anchor's own key (`entity:<urn>`) for `entity`; for `workspace`/`personal` it's an opaque `crypto.randomUUID()` with no relationship to any `urn`. Preload exposes these as `window.api.session.onOutput(sessionId, listener) → unsubscribe` and `window.api.session.onExit(sessionId, listener) → unsubscribe`, each listener receiving only the payload (`chunk` / `exitCode`) for that session. A third push channel, `external-link:open` (`src/shared/external-link.ts`, payload `{ url }`), carries a URL a session's CLI opened itself; preload exposes it unfiltered as `window.api.externalLink.onOpen(listener) → unsubscribe` (see [External link routing](architecture.md#session-bounded-context)). A third accessor, `window.api.session.onAnyExit(listener) → unsubscribe`, skips the `sessionId` filter entirely — it exists for `useSessions()`, which needs to notice a session exiting in the background without already knowing every live `sessionId` up front.

A third pair, `terminal:output`/`terminal:exit` (`src/shared/terminal.ts`), streams a terminal's PTY output
and reports its exit the same way, filtered by `terminalId` instead of `sessionId` —
`window.api.terminal.onOutput(terminalId, listener) → unsubscribe`, `.onExit(terminalId, listener) →
unsubscribe`, and an unfiltered `.onAnyExit(listener) → unsubscribe` mirroring `session.onAnyExit`.

A second exception: `entity:changed` (defined in [`src/shared/entity.ts`](../../src/shared/entity.ts)), fired whenever `EntityWatchService` (`src/main/application/services/entity-watch-service.ts`) re-syncs a Skill/Agent/Instruction edited outside the app's own `save()` — e.g. by a `claude` session writing to the entity's canonical source file directly. Payload is `{ kind: EntityKind; urn: string }`. Preload exposes it unfiltered as `window.api.entity.onChanged(listener) → unsubscribe` (the renderer doesn't know ahead of time which urn an external edit touched), used to invalidate that kind's list query so the tree picks up the change.

## Preload bridge

`src/preload/index.ts` exposes `window.api.call`, the single entry point for every request/response method above:

```ts
window.api.call<T>(method: string, params: unknown): Promise<IpcResult<T>>;
```

It also exposes one non-IPC helper, `window.api.getPathForFile(file: File): string`, wrapping Electron's `webUtils.getPathForFile` — needed because the app runs with `sandbox: true`/`contextIsolation: true`, which drops the renderer's own `File.path`. `SessionPanel`'s drag-and-drop attach handler is the only caller: it resolves a dropped `File`'s real filesystem path so it can write `@<path>` into the session the same way a pasted clipboard image does after `session.stageAttachment` (see [`session`](#session) below).

The renderer wraps it via `callIpc` ([`src/renderer/lib/ipc.ts`](../../src/renderer/lib/ipc.ts)), which unwraps `data` on success and throws `IpcCallError` on failure:

```ts
import { callIpc } from './lib/ipc.js';

const list = await callIpc<Skill[]>('skill.list');
```

## Dispatch and error mapping

[`src/main/ipc/dispatcher.ts`](../../src/main/ipc/dispatcher.ts) wraps every handler in a try/catch:

| Thrown | `IpcError.kind` | Notes |
|---|---|---|
| `DomainError(kind, …)` | `kind` (carried verbatim) | `details` propagated when present. |
| `Error` | `internal` | Message preserved; details dropped. |
| Anything else | `internal` | Message: `"Unknown error"`. |
| Unknown method | `not_found` | Returned without invoking any handler. |

## Methods

Grouped by namespace. Source: [`src/main/ipc/registry.ts`](../../src/main/ipc/registry.ts).

A `scope?: 'personal' | 'project'` param (on `skill.list`/`agent.list`, `hook.*`, `marketplace.*`, `plugin.*`, `health.getReport`) is Claude Code's own plugin/settings tier, not an entity `Scope`: `'project'` resolves against the open workspace's root (`<root>/.claude/settings.json`, `<root>/.ai-companion/plugins`, …) and is not available at Início — with no workspace open, resolving those paths throws `validation`, so the renderer only sends `'personal'` there.

### `app`

| Method | Params | Result |
|---|---|---|
| `app.restore` | — | `void` |

> **Destructive (scoped).** `app.restore` restores the app to its initial state: it removes the app-created symlinks and generated files under adapter targets (`AdapterManager.removeAllAdapterSymlinks`/`removeAllGeneratedFiles`), deletes Global's data directory `~/.ai-companion/`, and clears the app's marketplace/plugin registry in `~/.claude/settings.json`, then quits. Each workspace's own `<root>/.ai-companion/` is left in its folder. It does **not** delete the rest of `~/.claude/` or any `.env.local` — only this app's own footprint. Orchestrated by `WorkspaceTeardownService`; no raw filesystem access lives in the IPC layer.

### `settings`

| Method | Params | Result |
|---|---|---|
| `settings.get` | — | `Settings \| null` |
| `settings.save` | `Settings` | `void` |
| `settings.merge` | `Partial<Settings>` | `Settings` (merged result) |
| `settings.setLanguage` | `{ language: LanguagePreference }` | `{ settings: Settings; syncReport: SyncResult[] }` |

`settings.setLanguage` persists the language preference **and** rewrites the `<language>` block of the default `instruction` entity, returning the sync report from that save.

`Settings` shape lives in [`src/shared/settings.ts`](../../src/shared/settings.ts).

### `repo` *(removed)*

`repo.detectGit` / `repo.getCurrentBranch` were removed — superseded by `git.status` (see `git` below); neither had a renderer caller. The older `repo.link` / `repo.unlink` / `repo.list` methods and their `LinkedRepoView` type were removed with `settings.linkedRepos` — workspace scope now lives on each entity's own `scopes`/`scopeId` (see the `instruction` namespace below).

### `workspace`

| Method | Params | Result |
|---|---|---|
| `workspace.list` | — | `Workspace[]` |
| `workspace.getActive` | — | `Workspace \| null` |
| `workspace.create` | `{ name: string; rootPath: string }` | `Workspace` |
| `workspace.open` | `{ path: string }` | `Workspace` |
| `workspace.goHome` | — | `void` |
| `workspace.switchTo` | `{ id: string }` | `Workspace` |
| `workspace.delete` | `{ id: string }` | `void` |
| `workspace.listDir` | `{ path?: string, showHidden?: boolean }` | `FileBrowserEntry[]` |
| `workspace.readFile` | `{ path: string }` | `FilePreview` |
| `workspace.writeFile` | `{ path: string; content: string }` | `void` |
| `workspace.resolvePath` | `{ path: string }` | `{ absolutePath: string }` |

A workspace is any folder; Global (`~/.ai-companion`, "Início") is not one — see [Architecture → Global / Workspace](architecture.md#global--workspace). `Workspace` (`src/shared/workspace.ts`) is `{ id, name, rootPath, createdAt, lastOpenedAt? }`, `rootPath` a real path. `lastOpenedAt` (ISO) is stamped by every `workspace.switchTo`/`workspace.open` — the TopNav switcher's "Recentes" sorts by it — and is absent until a workspace is first opened (`workspace.create` doesn't set it), so pre-existing registries need no migration; missing values sort last. `workspace.list` returns every registered workspace. `workspace.getActive` returns the open workspace, or `null` at Início. `workspace.create` registers a folder under a chosen name and bootstraps its `.ai-companion` data dir (does not open it); it rejects (`validation`, `details.reason: 'duplicate-root'`) a folder that already has a workspace. `workspace.open` finds the workspace whose root is `path`'s real path (symlinks resolved, trailing slash stripped) or creates one named after the folder, then activates it; `path` must be an existing directory (`validation`, `reason: 'not-a-directory'`) and must not be the home dir (`validation`, `reason: 'home-dir'`). `workspace.goHome` closes the open workspace (`activeWorkspaceId = null`). `workspace.switchTo`, `workspace.open` and `workspace.goHome` all activate: the selection is persisted first (a rejected `open` changes nothing), then the outgoing graph's live sessions and terminals are killed and the Entity-backed service graph is rebuilt — at Início too. `workspace.delete` unregisters a workspace (its folder and data dir stay on disk); deleting the open one goes home first. `workspace.listDir`/`readFile`/`writeFile`/`resolvePath` need an open workspace — at Início they fail `validation`. `workspace.listDir` lists a directory relative to the active workspace's root (`path` defaults to `''`, the root itself) and rejects paths escaping the root. Dot-entries are skipped unless `showHidden` is `true`; `.git` and `.DS_Store` are never listed. `workspace.listFolders` returns every non-hidden folder as a root-relative path (breadth-first, depth ≤ 4, capped at 1000, `node_modules` skipped) — the candidate list for the terminal folder picker. `workspace.readFile` reads a file for preview, returning `{previewable:false, reason}` for binary/oversized files instead of throwing. A previewable result also carries a `kind`: `'text'` (`{content, truncated}`, content capped at 256KB) or `'spreadsheet'` for a `.xlsx` or `.numbers` file (`{sheets: SpreadsheetSheet[], truncated}`, parsed with `exceljs`; formula cells show their last-cached result, not the formula; each sheet capped at 2000 rows) — spreadsheets are view-only, `workspace.writeFile` only ever writes `kind: 'text'` content back. A `SpreadsheetSheet` (`src/shared/file-browser.ts`) is `{name, rows: SpreadsheetCell[][], merges: SpreadsheetMerge[], columnWidths: (number|undefined)[], defaultColumnWidth?, rowHeights: (number|undefined)[], frozenRows, frozenCols}`: each `SpreadsheetCell` is a plain `string` for an unstyled cell, or `{value, style}` when the source file styled that cell (`style: {bold?, italic?, color?, backgroundColor?, align?, wrapText?, verticalAlign?}`, read from the cell's own font/fill/alignment — no workbook theme-color resolution; `wrapText` mirrors the cell's "wrap text" flag and `verticalAlign` is `top`/`middle`/`bottom`, absent for Excel's `justify`/`distributed`, which CSS has no equivalent for); `merges` are 0-indexed `{row, col, rowSpan, colSpan}` ranges anchored at each merge's top-left cell; `columnWidths` mirrors the workbook's own column widths in its character-width unit (`undefined` where the file left a column unsized) and `defaultColumnWidth` is the sheet's own override of Excel's 8.43-character default, absent when it sets none — together they give the renderer a real width for every column, which its fixed table layout requires; `rowHeights` mirrors the file's explicit row heights in points (`undefined` where it set none — there is deliberately no default-row-height counterpart, since Excel's 15pt default is too cramped for the preview grid's type); `frozenRows`/`frozenCols` come from the sheet's frozen-pane view, 0 when it has none. Numbers render through their own cell number format (currency, percentage, thousands grouping); dates stay `YYYY-MM-DD` regardless of the source format — full Excel date-token formatting isn't implemented. A `.numbers` document is converted to `.xlsx` before that parsing: it is an iWork Archive (Snappy-compressed protobuf with no published schema), so the app drives Numbers itself over Apple events (`SpreadsheetConverterPort` → `NumbersConverterAdapter`) and feeds the result through the same reader — the renderer cannot tell the two formats apart. The conversion always runs against a temp copy, never the file itself, because `open` on a document Numbers already has open returns that document and closing it would discard the user's unsaved edits; the preview therefore shows what is saved on disk, not unsaved changes in a Numbers window. Numbers also prepends a localized export-summary sheet to multi-table documents, which is dropped by comparing the parsed sheet count against the table count Numbers reports, never by matching its (translated) name. It is macOS-only and needs Numbers installed and Automation permission granted — each missing piece yields `{previewable:false, reason}` naming the cause rather than a throw. The 5MB cap applies to the converted workbook, not to the `.numbers` file, whose embedded image assets say little about the size of its grid. `workspace.writeFile` overwrites an existing file in place with the same containment guard as `readFile`; it rejects (`not_found`) if the file doesn't already exist, (`validation`) if the target isn't a regular file or `content` exceeds the same 5MB cap `readFile` enforces on the read side — it never creates a new file or its parent directories. `workspace.resolvePath` resolves a workspace-relative path to an absolute one (used by the folder tree's "Abrir como workspace", which then calls `workspace.open`), applying the same containment guard as the other two methods.

### `project` *(removed)*

The `project.*` namespace (`list`/`create`/`findOrCreateByPath`/`update`/`delete` and the
`listDir`/`readFile`/`writeFile`/`resolvePath` file browser) is gone with the `Project` concept — a sub-folder
is opened as its own workspace instead (`workspace.open`). Calling any of them returns `not_found`. Existing
projects were turned into workspaces by the boot migration — see
[Architecture → Global / Workspace](architecture.md#global--workspace).

### `dialog`

| Method | Params | Result |
|---|---|---|
| `dialog.selectFolder` | `{ defaultPath?: string }` (or `null`) | `{ canceled: boolean; path?: string }` |

### `openWith`

| Method | Params | Result |
|---|---|---|
| `openWith.suggest` | `{ path: string; kind: 'file' \| 'dir' }` | `OpenWithSuggestions` |
| `openWith.open` | `{ path: string; kind: 'file' \| 'dir'; appId: string; appPath: string }` | `void` |
| `openWith.chooseApp` | `{ path: string; kind: 'file' \| 'dir' }` | `{ canceled: boolean }` |
| `openWith.openDefault` | `{ path: string }` | `void` |
| `openWith.reveal` | `{ path: string }` | `void` |
| `openWith.openInBrowser` | `{ path: string }` | `{ tabId: string }` |
| `openWith.revealWorkspace` | `{ id: string }` | `void` |

Backs the file tree's right-click "Abrir com" submenu and its "Abrir no navegador"/"Revelar no Finder" siblings. Each of these six resolves `path` against the open workspace's root through the very same `FileBrowserService` containment guard as `workspace.*` (`..`, absolute paths and escaping symlinks all rejected), and fails `validation` at Início, where there is no file tree. `path` is always workspace-relative and, unlike the other file-browser methods, may be the empty string — that is the workspace root itself, a real target here. No renderer-supplied absolute path ever reaches the OS.

`openWith.revealWorkspace` reveals a registered workspace's root in the file manager — Início's workspace rows ("Revelar no Finder"), where no workspace is open to resolve a relative path against. It takes the workspace `id`, never a path: the root comes from the registry (`WorkspaceService.get`, `not_found` for an unknown id), so the no-absolute-path rule above still holds.

`openWith.openInBrowser` resolves the row the same sandboxed way, converts the absolute path to a `file://` URL (`node:url`'s `pathToFileURL`, which handles spaces and other characters a hand-rolled encoder would get wrong) and hands it to `EmbeddedBrowserPort.openTab` — opening it as a fresh **manual tab** of the app's own embedded browser (see the `browser` namespace below), the same kind the Workbench tab strip's "+" affordance opens.

`openWith.suggest` asks the platform which applications are registered for the path, then filters, dedupes and ranks them into `{ primary, more }` (`src/shared/open-with.ts`): `primary` is the first 6, `more` the rest. Each `ExternalApp` is `{ id, name, path, isDefault, isRemembered, iconDataUrl? }`, where `id` is the bundle identifier — the key everything downstream uses, because a bundle survives being moved or renamed and its display name is localized. Filtering drops bundles under `/Library/Caches/`, inside `node_modules`, or in any dot-prefixed directory (test-runner and editor-extension copies of real apps, which Launch Services reports as installed); dedupe keeps one copy per bundle id, preferring `/Applications` over a system or external-volume location. Ranking is: remembered choice → OS default → curated rank for the path's category → alphabetical (`src/main/application/open-with/catalog.ts`). The curated table only *scores*; it never hides an application the OS offered.

`openWith.open` launches the path in the chosen application and then records it in `settings.openWith`, keyed by extension (`.md`), `dir` for folders or `file` for names without one — in that order, so a failed launch never leaves a preference pointing at a bundle that isn't there. `openWith.chooseApp` opens the native application picker and, on a pick, resolves that bundle's own identifier before delegating to the same path. If the bundle can't be read, the application is still launched but nothing is remembered: a preference stored under a filesystem path could never match a suggestion (which always carries a bundle id), so the entry would be permanent dead weight in settings.json. `openWith.openDefault` and `openWith.reveal` are the portable subset (Electron `shell.openPath` / `showItemInFolder`).

Application discovery is macOS-only: `MacAppLauncher` asks Launch Services through `osascript -l JavaScript`, which ships with every macOS install and so needs no Xcode, no compiled helper and no extra dependency. The target path is passed as `argv`, never interpolated into the script — filenames are attacker-influenced whenever the workspace is. Every failure mode (timeout, unparseable output, an unregistered type) degrades to an empty candidate list rather than throwing. On other platforms `SystemDefaultAppLauncher` returns no candidates, so the submenu shows only "abrir com o aplicativo padrão"; `openWith.open` there rejects with `validation`.

### `openEditors`

Remembers which Workbench tabs were open, per data dir, so a reload reopens them. Stores references only
(`PersistedTab`, `src/shared/open-editors.ts`) — files and entities are re-read from disk on restore, so a
restored tab is never stale. Unsaved "new" entities and entity-body previews are not persisted; browser tabs
recover from their own main-process store.

| Method | Params | Result |
|---|---|---|
| `openEditors.get` | none | `OpenEditorsState` (`{ tabs: PersistedTab[]; activeTabId: string \| null }`) |
| `openEditors.save` | `OpenEditorsState` (raw — the service validates it) | `void` |

`openEditors.get` reads `open-editors.json` from the data dir of the **active context**: the open workspace's, or
Global's at Início. A missing or corrupt file is "nothing was open", never an error. `openEditors.save` drops every
malformed or duplicate-id tab itself before writing, because the file is hand-editable and nothing in it is trusted.

### `skill`

| Method | Params | Result |
|---|---|---|
| `skill.list` | `{ scope?: 'personal' \| 'project' }` | `Skill[]` (workspace + plugin-provided, with `source` field) |
| `skill.get` | `{ id: string }` | `Skill` |
| `skill.resolvePath` | `{ id: string }` | `{ absolutePath: string }` |
| `skill.save` | `{ skill: Skill; isCreate?: boolean }` | `{ skill: Skill; syncReport: SyncResult[] }` |
| `skill.delete` | `{ id: string; removeSymlinks: boolean }` | `{ ok: true }` |

`Skill` is the canonical `Entity` shape (`kind: 'skill'`) from [`src/shared/entity.ts`](../../src/shared/entity.ts) — flat fields (`name`, `description`, `content`, …), no nested `frontmatter`/`body`. A slash-command is now just a skill with `explicitOnly: true` (on-disk `disable-model-invocation: true`); there is no separate `command.*` namespace.

Saving or deleting a plugin-provided skill (`source.kind === 'plugin'`) raises `OperationNotAllowedForOriginError` (`kind: 'internal'` unless mapped). Validated by `EntityValidator` against `skillEntitySchema` in [`src/main/application/schemas/entity-schema.ts`](../../src/main/application/schemas/entity-schema.ts).

`skill.resolvePath`/`agent.resolvePath`/`instruction.resolvePath` return the absolute path of the entity's own canonical source file on disk (rejects `not_found` for a missing id) — used by the tree row's "New Action" context-menu entry to seed a new session's first message with an `@`-reference to the item.

### `agent`

| Method | Params | Result |
|---|---|---|
| `agent.list` | `{ scope?: 'personal' \| 'project' }` | `Agent[]` (workspace + plugin-provided) |
| `agent.get` | `{ id: string }` | `Agent` |
| `agent.resolvePath` | `{ id: string }` | `{ absolutePath: string }` |
| `agent.save` | `{ agent: Agent; isCreate?: boolean }` | `{ agent: Agent; syncReport: SyncResult[] }` |
| `agent.delete` | `{ id: string; removeSymlinks: boolean }` | `{ ok: true }` |

`Agent` is the canonical `Entity` shape (`kind: 'agent'`) — `systemPrompt` replaces the old `body`, plus optional `model` / `tools` / `deniedTools`. Same plugin-source guard as `skill.*`.

### `instruction`

| Method | Params | Result |
|---|---|---|
| `instruction.list` | `{}` | `Instruction[]` (personal singleton first when present, then the open workspace's instructions) |
| `instruction.get` | `{ id: string }` (`'default'` for personal; slug otherwise) | `Instruction` |
| `instruction.resolvePath` | `{ id?: string }` (omitted/`'default'` for personal; slug otherwise) | `{ absolutePath: string }` |
| `instruction.save` | `{ instruction: Instruction; isCreate?: boolean }` | `{ instruction: Instruction; syncReport: SyncResult[] }` |
| `instruction.delete` | `{ name: string; removeSymlinks?: boolean }` | `{ ok: true; syncReport?: SyncResult[] }` |

An `Instruction` is one of two shapes, told apart by `scopes[0]`: the personal singleton (`name === 'default'`, `scopes === ['personal']`, no `scopeId`) or a workspace instruction (any other slug, `scopes === ['workspace']`, `scopeId` = a `Workspace.id`). `scopeId` is resolved to the workspace's root at point of use via `resolveScopePath` (`src/main/application/resolve-scope-path.ts`) — never persisted as a path on the entity itself. Enforced by `personalInstructionId` / `projectInstructionSlug` (`src/main/domain/instruction-id.ts`; the latter's name is legacy — it validates any non-personal slug) and by `instructionEntitySchema` (branch via `superRefine`). Saving a workspace instruction needs that workspace to be the open one: `validation` with `details.reason` `no-active-workspace` at Início, `scope-id-mismatch` for another workspace's `scopeId`. Storage is **frontmatter-free**; the personal singleton lives at `instructions/default.md` in Global's `~/.ai-companion/`, workspace instructions at `instructions/project/<slug>/{INSTRUCTION.md,meta.json}` in that workspace's `<root>/.ai-companion/` (the `project/` dir name is legacy) — see [Entity schema](customization-schema.md#instruction). `save`'s sync report fans out to Claude (`~/.claude/CLAUDE.md` + `~/AGENTS.md` for personal, `<workspace root>/.claude/CLAUDE.md` + `<workspace root>/AGENTS.md` for workspace) and — when Cursor is enabled — either the Cursor plugin files (personal) or `<workspace root>/AGENTS.md` (workspace). `delete` removes the entity plus its symlinks / generated files by default; pass `removeSymlinks: false` to keep the sync artefacts.

The renderer never offers a folder picker for this — `instruction.*` is driven entirely from the Workspace
screen's **INSTRUCTIONS** row (`InstructionTreeRow` in
`src/renderer/components/workspace/InstructionTreeRow.tsx`): the personal row at Início, the open
workspace's row inside one.

### `git`

A git client over the open workspace's repository. No method takes a target: it is always the open workspace's `rootPath`, so the renderer never sends an absolute path, and every method fails `validation` at Início. The repo root is the target itself: a workspace opened on a subfolder of a larger repo reports `isRepo: false`. Types in [`src/shared/git.ts`](../../src/shared/git.ts).

| Method | Params | Result | Notes |
|---|---|---|---|
| `git.status` | — | `GitStatus` | `{ isRepo: false }` for a non-repo — never throws for it. `files` is capped at 5,000 (`truncated: true` beyond). |
| `git.diff` | `{ path: string; source: GitDiffSource }` | `GitFileDiff` | `source.kind`: `worktree` (index → worktree; untracked files render all-added) or `index` (HEAD → index). `commit` is rejected (`validation`) until history ships. Over 1MB / 20,000 lines → `too-large`. |
| `git.stage` | `{ paths: string[] }` | `void` | `git add -- <paths>` (stages deletions too). |
| `git.unstage` | `{ paths: string[] }` | `void` | `git restore --staged`; on an unborn branch, `git rm --cached`. |
| `git.discard` | `{ paths: string[] }` | `void` | Tracked: back to the index (`restore --worktree`); untracked: deleted (`clean --force`). Never touches the index. The renderer confirms first. |
| `git.commit` | `{ message: string; amend?: boolean }` | `{ sha: string }` | `validation` for a blank message or nothing staged (unless `amend`). Hooks run; a failing hook → `io` with its output in `details.stderr`. The message goes through a temp file (`--file`), never argv. |
| `git.generateCommitMessage` | — | `{ message: string }` | Builds a prompt from the staged diff (capped ~30k chars; lockfiles/generated files only in `--stat`) plus the project's commit convention, and asks the user's own `claude -p` for a message. `validation`: nothing staged or no workspace open. `not_found`: `claude` not on PATH (message names the command). `io`: `ClaudeTimeout` (60 s), non-zero exit (`details.stderr`, truncated to 4 KB) or empty output. Never commits and never changes the repo. |
| `git.push` | — | `void` | Pushes the current branch; with no upstream it publishes (`push --set-upstream <origin or first remote> <branch>`). Never forces. `validation`: detached HEAD, unborn branch or a merge/rebase in progress. `conflict` + `details.reason: 'push_rejected'`: the remote has newer commits. |
| `git.pull` | — | `void` | `git pull --ff-only`. `validation` without an upstream. `conflict` + `details.reason: 'non_fast_forward'` when the branches diverged — nothing is merged or rebased. |
| `git.fetch` | — | `void` | `git fetch` (the default remote). |
| `git.sync` | — | `{ action: 'publish' \| 'push' \| 'pull' \| 'sync' \| 'fetch' }` | The smart button: picks the action from `GitStatus.head` (`syncActionFor` in `src/shared/git.ts`). `sync` = `pull --ff-only` then `push`; a failure's `message` starts with the half that failed (`Pull falhou:` / `Pull concluído, mas o push falhou:`). |
| `git.init` | — | `void` | `conflict` if the target already is a repo. |

Paths are repo-relative: absolute paths, `..` segments, NUL bytes and empty strings are rejected (`validation`); they always reach git after `--`. Mutations on the same repo run one at a time. Errors: `validation` (no workspace open), `not_found` (not a repo — except `git.status`), `conflict` (`index.lock` contention, merge conflicts, dirty-tree refusals; may carry `details.files`), `auth` (credential failures — also a 401/403 from the remote), `io` (remote unreachable, or anything else; stderr in `details.stderr` truncated to 4KB; `message` is `GitNotFound` when git isn't on PATH and `GitTimeout` after 30s — 120s for push/pull/fetch). Network operations run with `GIT_TERMINAL_PROMPT=0` and ssh `-o BatchMode=yes`, so a missing credential fails fast.

### `launchConfig`

Read-only discovery over the open workspace's own `.vscode/launch.json` (one file, at the workspace root — a sub-folder's launch file is reached by opening that folder as its own workspace), plus running a `type: "node"`,
`request: "launch"` configuration — which now means **creating a [terminal](#terminal)** that runs the resolved
command. See [the integrated-terminals design](../superpowers/specs/2026-10-25-integrated-terminals-design.md).
Not Entity-backed (no `urn`, no `scopes`) — same precedent as `hook`/`mcp`.

| Method | Params | Result |
|---|---|---|
| `launchConfig.list` | — | `WorkspaceLaunchConfigs \| null` (`null` at Início) |
| `launchConfig.run` | `{ configName: string }` | `TerminalSnapshot` (`kind: 'launch'`) |

There is no `launchConfig.kill`/`status`: stopping and replaying a launched process are `terminal.kill` /
`terminal.status`, since it is a terminal like any other.

`LaunchConfig` (`src/shared/launch-config.ts`): `{ name: string; type: string; request: string; program?: string;
runtimeExecutable?: string; runtimeArgs?: string[]; args: string[]; cwd?: string; env?: Record<string,string>; supported: boolean }` — `supported` is `true` only for
`type: 'node'`, `request: 'launch'` with a `program` or `runtimeExecutable`; anything else is listed but `launchConfig.run` on it throws
`kind: 'validation'` (`resolveLaunchCommand`/`UnsupportedLaunchTypeError`,
`src/main/domain/launch-config-command.ts`) even if called directly, re-deriving support from `type`/`request`
rather than trusting a client-sent flag. `WorkspaceLaunchConfigs`: `{ workspaceId: string; configs: LaunchConfig[];
error?: string }` — `error` is set (configs empty) when the workspace's `launch.json` has parse errors or a
malformed entry; a missing `.vscode/launch.json` file itself is *not* an error, just an empty `configs`
array. Running the same config twice starts two independent terminals. `launchConfig.run` surfaces `kind: 'io'`
for a spawn failure (missing `node` binary, bad cwd, or an unreadable `launch.json`), `kind: 'not_found'` for an
unknown `configName`, and `kind: 'validation'` at Início. Backed by `LaunchConfigService` over
`LaunchConfigReaderPort` (`FsLaunchConfigReader`); the run itself is `TerminalService.runLaunch`.

### `terminal`

Interactive terminals of the open workspace — shells and launched configurations alike. A terminal is an object
owned by the main process (`TerminalService`, `src/main/application/services/terminal-service.ts`, over
`TerminalPort` → `NodePtyTerminalAdapter`); a Workbench tab is only a view, so closing the tab leaves the process
running and its scrollback (200 000 chars, head-trimmed, in memory only) buffered. Stopping is always explicit.
Terminals end when the app quits or the workspace is switched (the renderer asks first when any is running), and
nothing is persisted. At Início `terminal.create`, `list` and `status` fail `validation`.

| Method | Params | Result |
|---|---|---|
| `terminal.create` | `{ relCwd?: string }` (workspace-relative; the root when omitted) | `TerminalSnapshot` |
| `terminal.write` | `{ terminalId: string; data: string }` | `void` |
| `terminal.resize` | `{ terminalId: string; cols: number; rows: number }` (positive integers) | `void` |
| `terminal.kill` | `{ terminalId: string }` | `void` |
| `terminal.restart` | `{ terminalId: string }` | `TerminalSnapshot` |
| `terminal.remove` | `{ terminalId: string }` | `void` |
| `terminal.list` | — | `TerminalSnapshot[]` |
| `terminal.status` | `{ terminalId: string }` | `TerminalSnapshotWithOutput \| null` |

`TerminalSnapshot` (`src/shared/terminal.ts`): `{ terminalId; workspaceId; kind: 'shell' | 'launch'; name;
relCwd; status: 'running' | 'exited'; exitCode: number | null; generation }`. `name` is the shell's basename
(`zsh`) or the configuration's name; `relCwd` is `''` for the root; `generation` is bumped by every restart so a
view knows its replayed buffer is stale. `TerminalSnapshotWithOutput` adds `outputBuffer` and is returned only by
`status`, never by `list`. A shell is the user's login shell (`$SHELL`, falling back to `/bin/zsh` on macOS,
`/bin/bash` elsewhere) started with `-l` in the chosen folder; a launch terminal runs the resolved `node …`
command directly, not through a shell, so exit codes stay accurate. Both run in a PTY with `TERM=xterm-256color`.
`create` rejects (`validation`) a folder that escapes the workspace root and surfaces `io` when the PTY cannot
start (a process that exits within ~150 ms without output counts as a failed start). `kill` only signals — the
row flips to `exited` when the process does — and no-ops for an unknown or already-exited id. `restart`
re-runs an **exited** terminal's command, args, env and cwd under the same `terminalId` with an empty buffer
(`validation` while running, `not_found` if unknown); `remove` forgets an **exited** terminal (`validation`
while running). Output and exit stream over the `terminal:output` / `terminal:exit` push channels. A reattaching
view subscribes first, then calls `status` and drops live chunks until it returns: push events and the reply share
one ordered channel, so anything received before the reply is already inside its buffer.

### `session`

| Method | Params | Result |
|---|---|---|
| `session.spawn` | `{ anchor: SessionAnchor }` | `SessionSnapshotWithOutput` |
| `session.write` | `{ sessionId: string; data: string }` | `void` |
| `session.stageAttachment` | `{ fileName: string; dataBase64: string }` | `{ absolutePath: string }` |
| `session.resize` | `{ sessionId: string; cols: number; rows: number }` | `void` |
| `session.kill` | `{ sessionId: string }` | `void` |
| `session.remove` | `{ sessionId: string }` | `void` |
| `session.resume` | `{ sessionId: string }` | `SessionSnapshotWithOutput` |
| `session.status` | `{ sessionId: string }` | `SessionSnapshotWithOutput \| null` |
| `session.list` | — | `SessionSnapshot[]` |

`SessionAnchor` (`src/shared/session.ts`): `{kind:'entity',urn:string} \| {kind:'workspace',workspaceId:string} \| {kind:'personal'}`. A session is anchored to one of an entity (a Skill, Agent, or Instruction, by `urn`), a workspace (by `workspaceId`), or Início (`personal`, no id). `sessionAnchorKey(anchor)` (also `src/shared/session.ts`) derives a stable string from the anchor (`entity:<urn>`, `workspace:<workspaceId>`, or `personal`) — used to group every session sharing one anchor (see `useSessionStatus` below), but no longer always the session's own `sessionId`. `SessionSnapshot`: `{ sessionId: string; claudeSessionId: string; anchor: SessionAnchor; cwd: string; label: string; status: 'running' \| 'exited' }`. `claudeSessionId` is always a UUID, minted by `SessionService` at spawn and handed to the CLI as `--session-id <uuid>`, which makes the CLI write that conversation's transcript to `~/.claude/projects/<slug>/<uuid>.jsonl` — it is the exact join between a live session and its entry in `sessionHistory.*`. It is deliberately separate from `sessionId`, the app's own key, which for an `entity` anchor is `sessionAnchorKey(anchor)` and therefore not a UUID. A session never re-mints it: reopening an exited session resumes that same conversation (`--resume <uuid>`) rather than starting a second one, and `--continue` is no longer used at all — with several sessions able to share a `cwd` it could attach to a sibling's conversation. **Session identity is kind-conditional.** For an `entity` anchor, `sessionId` is still `sessionAnchorKey(anchor)` and the original one-live-session invariant holds: `session.spawn` on an anchor with a running session returns that session instead of spawning a second PTY, concurrent calls for the same anchor share the same in-flight spawn, and spawning again after the session exited relaunches the same `sessionId` in place. For a `workspace`/`personal` anchor, `session.spawn` always mints a fresh `sessionId` (`crypto.randomUUID()`) and always starts a new PTY — multiple sessions can be live for the same anchor at once, each its own entry in `session.list`, its own Workbench tab. `label` is the anchor's human-readable name (entity/workspace name, `Início` for `personal`), resolved once at spawn time from the same lookup that resolves `cwd`; for `workspace`/`personal` anchors it also carries a numbered suffix once more than one session shares that anchor — the first keeps the plain name, later ones are `<name> (2)`, `<name> (3)`, … — computed from a per-anchor counter in `SessionService` that increments only on `spawn` (never on `resume`) and never reuses a number, even after the session holding it is removed. `SessionSnapshotWithOutput` extends `SessionSnapshot` with `outputBuffer: string` — the scrollback captured so far for that one session (capped in memory, never persisted), returned only by `spawn`/`resume`/`status` (a single-session lookup, used to replay output into a reattaching `SessionPanel` terminal) and deliberately omitted from `list`'s aggregate array so listing every session doesn't ship every buffer. `session.resume` relaunches the PTY for one already-known, currently-`exited` `sessionId` in place — of any anchor kind, since it operates purely on that entry's own stored `anchor`/`cwd`/`label` — keeping the same `sessionId` and `label`; called on a `sessionId` that's already `running` it's an idempotent no-op returning the existing snapshot (the same guard `spawn` uses for `entity`), and an unknown `sessionId` surfaces `kind: 'not_found'`, consistent with `session.spawn`'s existing `not_found` for an unresolvable anchor target. Working directory is derived from the anchor, never asked for: `{kind:'workspace'}` uses that workspace's `rootPath`; `{kind:'personal'}` uses the home dir; `{kind:'entity'}` uses `resolveScopePath(entity, …)` (`src/main/application/resolve-scope-path.ts`) — the entity's `scopeId` resolved against `WorkspaceService` — for a `workspace`-scoped Skill, Agent, or Instruction, otherwise (`personal` scope) the graph's data dir (the open workspace's `.ai-companion`, or Global's at Início). Backed by `SessionService` (`src/main/application/services/session-service.ts`) over `ClaudeSessionPort` (`NodePtySessionAdapter`, `src/main/infrastructure/claude-cli/`) — see [Session bounded context](architecture.md#session-bounded-context). `session.spawn` surfaces `kind: 'io'` for spawn failures (binary missing, PTY spawn error) and `kind: 'not_found'` when the anchor's target doesn't exist (an unknown entity `urn` or `workspaceId`); `session.write`/`resize`/`kill`/`remove`/`status`/`list` never throw for an unrecognized or non-running `sessionId` — they silently no-op (`status` returns `null`, `list` simply omits it). `session.kill` vs `session.remove`: `kill` stops the underlying `claude` process but leaves the session in `list`/`status` with `status: 'exited'` (so it can still be inspected or resumed via `session.resume`, or via `spawn` again for an `entity` anchor); `remove` kills it too if still running, then forgets it entirely — it's gone from `list`, and (for `entity`) a later `spawn` for that anchor starts with a fresh `outputBuffer`. `session.list` returns every session currently held in `SessionService`'s in-memory map — running and exited alike, in no particular order — reflecting only the current graph's process state: it's rebuilt empty on every activation (`workspace.switchTo`/`open`/`goHome`, or deleting the open workspace) and never persisted to disk, so a session is invisible to `list` (and every other `session.*` method) once what it ran under stops being open. `useSessions()` (`src/renderer/hooks/use-sessions.ts`) wraps `session.list`; `useSessionStatus(anchor)` aggregates every entry sharing that anchor's `sessionAnchorKey` into one status (`running` if any match is running, else `exited` if any match exists, else `undefined`) — for `entity`, where at most one session ever shares an anchor, this is behaviorally identical to an exact `sessionId` match. `SessionStatusBadge` (`src/renderer/components/SessionStatusBadge.tsx`) renders that aggregate running/exited indicator directly on the Skill/Agent/Instruction/Workspace tree row for the anchor, and `SessionsTreeGroup` (`src/renderer/components/workspace/SessionsTreeGroup.tsx`) is the consolidated view — **one list assembled from two sources**, `session.list` (in memory) and `sessionHistory.list` (on disk), merged on `claudeSessionId` so a running session, which is in both, appears once. Memory wins on status and label; the transcript contributes model, cost and duration. Rows are ordered by time, not name, and a history row with no in-memory match renders as ended (with no stop/delete action, since there is nothing in memory to act on), while an in-memory row with no transcript yet renders with a cost skeleton. A row click is the single resume-or-open gesture: `onOpen` directly if it is already running, `session.resume` if it is an exited session still in memory, `sessionHistory.resume` if it exists only as a transcript. Live PTY output streams separately over the `session:output` / `session:exit` push channels (see above) — `session.spawn`'s response only confirms the process started; its own `outputBuffer` field only covers output already captured before that call, not a live stream. `session.stageAttachment` is how a `SessionPanel` attaches a file that has no filesystem path of its own — a pasted clipboard image — to a running session: it base64-decodes `dataBase64`, rejects a decoded payload over 5MB (`kind: 'validation'`, mirroring the `claude` CLI's own image-attachment ceiling), sanitizes `fileName` down to its basename, and writes it under the graph's data dir — `<workspace root>/.ai-companion/attachments/`, or `~/.ai-companion/attachments/` at Início — with a `Date.now()`-and-uuid-prefixed name to avoid collisions, returning `{ absolutePath }`. It is not keyed by `sessionId` — it always stages into whatever is open, the same scope `SessionService` itself is built for — so the caller follows up with an ordinary `session.write` of `@<absolutePath>` to actually reference it in the target session's input, exactly like dragging a file onto the terminal already does by writing `@<path>` for a path the OS handed the renderer directly (no staging needed there, since a dragged file already has one).

### `browser`

| Method | Params | Result |
|---|---|---|
| `browser.enable` | `{ sessionId: string }` | `void` |
| `browser.disable` | `{ sessionId: string }` | `void` |
| `browser.openTab` | `{ url?: string }` | `{ tabId: string }` |
| `browser.closeTab` | `{ tabId: string }` | `void` |
| `browser.navigate` | `{ tabId: string; url: string }` | `void` |
| `browser.setBounds` | `{ tabId: string; bounds: { x: number; y: number; width: number; height: number } }` | `void` |
| `browser.status` | `{ tabId: string }` | `{ url: string } \| null` |
| `browser.list` | — | `{ tabId: string; sessionId?: string; url: string }[]` |

A browser embedded as **ordinary Workbench tabs**, not a separate area of the app — opening one adds an
`OpenTab` of `kind: 'browser'` to `WorkspaceScreen`'s own tab strip, the same one that already holds
session/preview/history tabs. Backed by `EmbeddedBrowserPort` (`EmbeddedBrowserAdapter`,
`src/main/infrastructure/browser/`), which owns every tab's real `WebContentsView` — no "active tab"
bookkeeping on the main-process side; positioning is purely a function of each tab's own `setBounds`
calls (see below). A tab comes in two flavors sharing the same `tabId` keyspace: a **session tab**,
opened via `browser.enable` (`tabId` is the `sessionId` itself), which also wires up a per-session
ephemeral `--mcp-config` so that session's own `claude` CLI process can drive it directly over CDP — the
agent side of the feature; and a **manual tab**, opened via `browser.openTab` (a freshly minted `tabId`,
no MCP config), used for the `TopNav` "open browser" button, for external links redirected into it
(every `target="_blank"` link in the app; `shell.openExternal`'s only other call site, the MCP re-auth
trampoline, is deliberately left alone — the embedded view has none of the user's OS-browser
session/cookies), and for the file tree's "Abrir no navegador" row action (`openWith.openInBrowser`,
which mints the tab itself with a sandboxed `file://` URL rather than going through `browser.openTab`).
See
[`docs/superpowers/specs/2026-09-19-embedded-session-browser-design.md`](../superpowers/specs/2026-09-19-embedded-session-browser-design.md)
for the full design and its later addendum, which reverses that spec's original "no standalone Browser
area" call in favor of this Workbench-tab integration.

`browser.enable`/`browser.disable` require an already-spawned `sessionId` (`kind: 'not_found'` otherwise,
mirroring `session.resume`) and go through `SessionService.setBrowserEnabled`, which flips
`SessionSnapshot.browserEnabled` and materializes/tears down that session's tab + its ephemeral MCP config
file. Enabling is idempotent and additive to whatever conversation args apply, wiring the resulting
`mcpConfigPath` into the session's next spawn (`ClaudeSessionSpawnOptions.mcpConfigPath`, appended by
`NodePtySessionAdapter` as `--mcp-config <path>`). The CLI only reads it at its own startup, so
`setBrowserEnabled` restarts a currently-running session right there — killed and immediately resumed
under the same `claudeSessionId`, so the conversation carries over — rather than leaving the toggle queued
for whenever the session next happens to exit on its own; the one cost is whatever the CLI was doing at
that instant (e.g. a tool call) getting cut off. `session.kill` deliberately leaves the tab and its config
file alone (so a `resume` reuses the same file instead of regenerating it); only `browser.disable` and
`session.remove` tear it down. `browser.closeTab` only ever tears down a *manual* tab — it silently
no-ops for a `tabId` that belongs to a session, since that one has to go through `browser.disable` instead
(to also clear `SessionService`'s own `browserMcpConfigPaths` entry). A session tab's Workbench close
button routes there for exactly that reason: closing it is a legitimate way to turn a session's browser
off, not just the toggle in `SessionPanel` — see `browser-tabs-store.ts`'s `closeBrowserTab`.
`browser.navigate`/`browser.setBounds`/`browser.status` are pure `WebContentsView` operations with no
session-lifecycle concern, so they talk to `EmbeddedBrowserPort` directly rather than through
`SessionService`, and silently no-op (or return `null`) for a `tabId` that was never opened.

Only one tab's `WebContentsView` is ever actually visible, but nothing on the main-process side enforces
that — it falls out of how `WorkbenchCanvas` already renders every open tab's content simultaneously,
switching visibility with CSS (`display: none` for every tab but the active one) rather than
mounting/unmounting. Each browser tab's own `BrowserPane` reports its bounds via `ResizeObserver`; a
`display: none` ancestor collapses that to `{0,0,0,0}`, so a hidden tab's view goes to zero size on its
own the same way `SessionPanel` already relies on `visible` to skip xterm's `fit()` while hidden — the
difference is a `WebContentsView` going to zero size *is* the correct hidden state, so no explicit
"switch tab" signal is needed the way `SessionPanel`'s xterm case needs one. The renderer side of all of
this — which tabs exist, and the registered callback that opens one into `WorkspaceScreen`'s own tab
strip — lives in `browser-tabs-store.ts` (`src/renderer/lib/`), a module-scoped store in the same shape
as `workspace-history-store.ts`/`workspace-area-store.ts`, since the things that open a tab (a
`SessionPanel` toggle deep inside the Workbench; a marketplace/footer link, or the `TopNav` button,
elsewhere entirely) have no prop path down into the screen that owns the tab strip.

A renderer reload doesn't touch any of this main-process state — `EmbeddedBrowserAdapter`'s tabs keep
running, just orphaned from the renderer's own (freshly emptied) `browser-tabs-store`. `hideAll()` (no IPC
method, wired internally to `mainWindow.webContents`' `did-start-navigation`) zeroes every tab's bounds the
moment such a reload starts, so an orphaned one doesn't render on top of the reloaded UI in the meantime.
`browser.list` is how the renderer recovers from there: `WorkspaceScreen` calls it once on mount, via
`browser-tabs-store.ts`'s `reconcileBrowserTabs`, and reopens every tab it reports — session and manual
alike — as a Workbench tab, which is what actually restores each one's bounds (`BrowserPane`'s own mount
effect reports its real container rect the moment it remounts). `sessionId` in a `browser.list` entry is
present, and equal to `tabId`, only for a session tab; a manual tab's entry omits it.

### `sessionHistory`

| Method | Params | Result |
|---|---|---|
| `sessionHistory.list` | `{ scope: HistoryScope; cursor?: string; limit?: number; filters?: HistoryFilters }` | `SessionHistoryPage` |
| `sessionHistory.stats` | `{ scope: HistoryScope; filters?: HistoryFilters }` | `SessionHistoryStats` |
| `sessionHistory.resume` | `{ claudeSessionId: string }` | `SessionSnapshotWithOutput` |

Reads the `claude` CLI's own conversation transcripts (`~/.claude/projects/<slug>/<uuid>.jsonl`) as a browsable, costed history. Read-only by contract — this app never writes into the CLI's directory. Shared types live in `src/shared/session-history.ts`; handlers in `src/main/ipc/session-history-handlers.ts`; backed by `SessionHistoryService` (`src/main/application/services/`) over `SessionTranscriptPort` (`FsClaudeTranscriptAdapter`, `src/main/infrastructure/claude-cli/`).

`HistoryScope`: `{kind:'workspace',workspaceId} \| {kind:'personal'} \| {kind:'all'}` — the renderer asks for the open workspace inside one; at Início the right panel's Sessões asks for `personal` and the Histórico tab and Visão geral for `all`. `personal` is Global's own: conversations whose directory **is** the home dir, never anything below it (every workspace lives below it). A conversation belongs to a scope by the directory it ran in — the workspace root **or anything below it**, so a session opened in a subfolder still counts; a sibling that merely shares a path prefix (`/repos/acme-archive` against `/repos/acme`) does not. `'all'` is every conversation the CLI has recorded on this machine. `HistoryFilters`: `{ models?: string[]; from?: string; to?: string; search?: string }` — `from`/`to` are inclusive and compared as local calendar days, `search` matches the title and the directory case-insensitively.

`SessionHistoryEntry` carries `claudeSessionId`, `title`, `cwd`, `model`, `costUsd`, `costSource`, the four token counts, `startedAt`/`endedAt` and `durationMs`. **`costSource` is the important field:** `'reported'` means the number is the CLI's own total, read from the `cost-state` line it appends to every transcript; `'estimated'` means the transcript predates that and the cost was reconstructed from token counts against the bundled price table (`src/main/application/pricing/model-pricing.ts`, overridable per model via `Settings.pricing`); `'unknown'` means a model with no published rate, and `costUsd` is then `null` — never `0`, never a guess. A conversation containing *any* unpriced model reports `null` rather than a total that is silently too low, and `SessionHistoryStats.unpricedCount` says how many such conversations were left out of `totalCostUsd`.

`sessionHistory.list` orders by `mtime` descending (id as tiebreak) and **pages by cursor, not offset**: `SessionHistoryPage.nextCursor` is an opaque anchor on the last row served, `null` at the end. An offset would skip or repeat a row when a live session writes to its transcript mid-scroll and jumps to the top of the ordering; an anchor cannot. Default page size is 10 (`SESSION_HISTORY_PAGE_SIZE`). A cursor this namespace did not issue surfaces `kind: 'validation'`.

`sessionHistory.resume` spawns a PTY with `--resume <claudeSessionId>` and registers the result as an ordinary session (`SessionService.adoptConversation`), so a resumed history entry is indistinguishable from any other live session from that point on — it appears in `session.list`, streams over `session:output`, and can be killed or removed normally. Its `sessionId` *is* the `claudeSessionId`, so resuming the same conversation twice reattaches rather than forking it. It is anchored to the open workspace when its `cwd` is that workspace's root or anything below it, and to `personal` otherwise — it never registers a workspace; either way it relaunches in the `cwd` it actually ran in. An id with no transcript on disk surfaces `kind: 'not_found'`.

There is **no on-disk cache**. Summarising every transcript on a real machine (169 conversations, the largest 63 MB) measures at roughly 260 ms, because `FsClaudeTranscriptAdapter` never reads the middle of a file: `cwd` comes from a 16 KB head read, and cost, models and title from a 256 KB tail read (the CLI re-appends `cost-state`, `ai-title` and `last-prompt` every turn, so the last copy of each always trails the file). `SessionHistoryService` keeps an in-memory map keyed by `mtimeMs` + `sizeBytes` so a `list` and the `stats` call beside it don't re-read the disk twice.

### `command` *(removed)*

The `command.*` namespace is gone — there is no `command` entity kind anymore. A slash-command is now a `skill` with `explicitOnly: true` (`disable-model-invocation: true` in frontmatter); it's saved and listed through `skill.*`. Pre-existing `commands/*.md` files under the workspace are orphaned — there is no migration.

### `hook`

Hooks are not part of the canonical `Entity` model yet — they live in `.claude/settings.json` and are read/written by `hook-service.ts` independently of `EntityRepository` (Phase 1 will bring them under the `Entity` contract). They share the per-entity facade *pattern* (list/get/save/delete + scope), not the type.

| Method | Params | Result |
|---|---|---|
| `hook.list` | `{ scope?: 'personal' \| 'project' }` (default `'personal'`) | `Hook[]` |
| `hook.get` | `{ id: string; scope?: 'personal' \| 'project' }` | `Hook` |
| `hook.save` | `{ hook: { id?; event; matcher?; description?; handler }; scope?: 'personal' \| 'project' }` | `{ hook: Hook; syncReport: SyncResult[] }` |
| `hook.delete` | `{ id: string; scope?: 'personal' \| 'project' }` | `{ ok: true }` |

### `marketplace`

| Method | Params | Result |
|---|---|---|
| `marketplace.list` | `{ scope: 'personal' \| 'project' }` | `MarketplaceSummary[]` (record + parsed manifest if available) |
| `marketplace.get` | `{ scope; id }` | `MarketplaceSummary \| null` |
| `marketplace.add` | `{ scope; id; source: { path: string } }` | `void` (persists to `extraKnownMarketplaces`) |
| `marketplace.remove` | `{ scope; id }` | `void` |
| `marketplace.refresh` | `{ scope; id }` | `MarketplaceSummary \| null` (re-parses manifest from disk) |
| `marketplace.addFromUrl` | `{ scope; url: string }` | `{ id; manifest }` (clones/detects a marketplace from a Git URL, then persists it) |
| `marketplace.detect` | `{ url: string }` | marketplace detection result *(registered in `plugin-handlers.ts`)* |

`plugin.installFromMarketplace` and `plugin.previewFromMarketplace` (in the `plugin` namespace) install or inspect a plugin from a marketplace entry.

### `customization` *(removed)*

The `customization.*` IPC namespace has been **removed**, and so has the polymorphic `Customization`/`CustomizationFrontmatter` model behind it. All entity access now goes through the typed namespaces above (`skill`, `agent`, `instruction`, `hook`) backed by the canonical `Entity` contract in [`src/shared/entity.ts`](../../src/shared/entity.ts) — `src/shared/customization.ts` no longer exists. The renderer's `CustomizationListScreen` component and `useCustomizationList` hook keep their (now generic) names but are parameterized by a concrete `listMethod` (e.g. `skill.list`) rather than calling a `customization.*` method.

`SyncResult` still lives in [`src/shared/sync-result.ts`](../../src/shared/sync-result.ts). See [Entity schema](customization-schema.md) for the current field contract.

### `adapter`

| Method | Params | Result |
|---|---|---|
| `adapter.syncAll` | `{ adapterId?: string }` (or none) | `SyncResult[]` |
| `adapter.removeAll` | `{ adapterId: string }` | `RemoveAdapterResult` |
| `adapter.setEnabled` | `{ adapterId: string; enabled: boolean; removeSymlinks?: boolean; runSyncAll?: boolean }` | See below |
| `adapter.countDestinations` | `{ adapterId: string }` | `{ count: number }` |

`adapter.setEnabled` returns:

- When `enabled: false` — a `RemoveAdapterResult` (default `removeSymlinks: true`); pass `removeSymlinks: false` to skip cleanup.
- When `enabled: true` — `{ syncReport: SyncResult[] }` (default `runSyncAll: true`); pass `runSyncAll: false` to skip the sync.

`RemoveAdapterResult`:

```ts
interface RemoveAdapterResult {
  removed: number;
  skipped: number;
  errors: { destination: string; kind: string; message: string }[];
}
```

### `plugin`

| Method | Params | Result |
|---|---|---|
| `plugin.import` | `{ url: string; ref?: string; scope?: string }` | `PluginSummary` |
| `plugin.list` | `{ scope?: string }` | `PluginListItem[]` |
| `plugin.get` | `{ id: string; scope?: string }` | `PluginDetail` |
| `plugin.update` | `{ id: string; scope?: string }` | `PluginSummary` |
| `plugin.remove` | `{ id: string; scope?: string }` | `void` |
| `plugin.toggle` | `{ id: string; scope?: string; enabled: boolean }` | `void` |
| `plugin.createOwned` | `{ id: string; version: string; description?: string; scope?: string }` | `PluginSummary` |
| `plugin.deleteOwned` | `{ id: string; scope?: string }` | `void` |
| `plugin.publish` | `{ id: string; scope?: string; repoName?: string; visibility?: 'public' \| 'private'; version: string; commitMessage?: string }` | `PluginPublishInfo` |
| `plugin.installFromMarketplace` | `{ plugin: MarketplacePlugin; scope?: string; marketplaceId?: string }` | `PluginSummary` |
| `plugin.previewFromMarketplace` | `{ plugin: MarketplacePlugin }` | `PluginManifest` (artifact counts shown before install) |

**Plugin types:**

```ts
interface PluginListItem {
  id: string;
  name: string;
  version: string;
  source: 'imported' | 'owned';
  enabled: boolean;
}

interface PluginDetail extends PluginListItem {
  description?: string;
  author?: string;
  publishedTo?: Array<{ registry: string; url: string; version: string; publishedAt: string }>;
}

interface PluginSummary {
  id: string;
  version: string;
  enabled: boolean;
}

interface PluginPublishInfo {
  id: string;
  version: string;
  registryUrl: string;
  releaseUrl: string;
  publishedAt: string;
}
```

**Error conditions:**

- `plugin.import` — `{ kind: 'validation' }` if `url` is empty or invalid; `{ kind: 'external_api' }` if the remote registry is unreachable; `{ kind: 'conflict' }` if a plugin with that `id` already exists.
- `plugin.publish` — `{ kind: 'auth', message: 'PublishAuthMissing' }` if no GitHub PAT is configured; `{ kind: 'conflict' }` if the version already exists or local/remote branches diverge.

### `credentials`

| Method | Params | Result |
|---|---|---|
| `credentials.setGithubToken` | `{ token: string }` | `void` |
| `credentials.clearGithubToken` | — | `void` |
| `credentials.hasGithubToken` | — | `{ hasToken: boolean }` |

**Credential storage:**

- `setGithubToken` — encrypts the PAT using Electron's `safeStorage` and persists it; the token is **never** returned by any method.
- `clearGithubToken` — erases the stored credential.
- `hasGithubToken` — returns only a boolean; never returns the token itself.

### `mcp`

| Method | Params | Result |
|---|---|---|
| `mcp.list` | `{}` | `McpServer[]` (global + project-local + project-shared + plugin + detected, with health) |
| `mcp.get` | `{ id: string }` | `McpServer \| undefined` |
| `mcp.save` | `{ server: McpServerInput; isCreate?: boolean }` | `{ ok: true }` |
| `mcp.delete` | `{ id: string }` | `{ ok: true }` |
| `mcp.setEnabled` | `{ id: string; enabled: boolean }` | `{ ok: true }` |
| `mcp.authenticate` | `{ id: string }` | `{ ok: true }` |

`McpServer` is read-only when `source.kind === 'plugin'` **or** `source.kind === 'detected'`. `mcp.delete` and `mcp.setEnabled` throw `OperationNotAllowedForOriginError` (kind `validation`) for plugin- and detected-sourced ids. `mcp.save` cannot target a plugin/detected server by construction (its `scope` excludes both). Writes to `~/.claude.json` are surgical (only `mcpServers` / `projects[path].mcpServers` are touched), atomic, and backed up to `<file>.bak`.

**Detected servers** (`source.kind === 'detected'`, `scope === 'detected'`, `transport` absent, `def === {}`) are servers the Claude Code runtime knows about (via logs / `mcp-needs-auth-cache.json`) that have a health problem (`error` or `needs-auth`) **and** no broker-readable config. They are surfaced read-only so failures are visible; healthy orphans are intentionally omitted to avoid noise. `mcp.authenticate` opens the external claude.ai connectors page (`https://claude.ai/customize/connectors`) — the app cannot complete the OAuth flow itself (it has no def/URL for runtime-managed connectors), so it acts as a trampoline. The `id` is validated but the v1 target URL is fixed regardless of which server. Throws `internal` if no shell port is configured.

Disable semantics: project-shared servers use `projects[repoPath].disabledMcpjsonServers` in `~/.claude.json`; inline (global / project-local) servers are parked in `~/.ai-companion/mcp-disabled.json` and restored on enable.

### `health`

| Method | Params | Result |
|---|---|---|
| `health.getReport` | `{ scope?: 'personal' \| 'project' }` (default: `'personal'`) | `HealthReport` |
| `health.notify` | `{ title: string; body: string }` | `void` |

`scope` only affects the **config-drift** category (it lists plugins per scope). The `mcp-auth`, `mcp-runtime`, `symlink` and `generated-file` categories read global state and are identical across scopes — see the `HealthCollector` interface docs.

**Types** (see [`src/shared/health.ts`](../../src/shared/health.ts)):

```ts
type Severity = 'ok' | 'warning' | 'error';
type HealthCategory = 'mcp-auth' | 'mcp-runtime' | 'config-drift' | 'symlink' | 'generated-file';

interface HealthCheck {
  id: string;           // stable id used for notification diffing
  category: HealthCategory;
  severity: Severity;
  title: string;
  detail?: string;
  target?: string;      // MCP/plugin/symlink name this check concerns
  remediation?: string; // actionable hint, e.g. "Run /mcp to authenticate"
  observedAt: string;   // ISO timestamp
}

interface HealthReport {
  generatedAt: string;
  worst: Severity;      // drives the nav badge color
  counts: { ok: number; warning: number; error: number };
  checks: HealthCheck[];
}
```

**Error conditions:**

- `health.getReport` — `{ kind: 'validation' }` if `scope` is present but not `'personal'` or `'project'`.
- `health.notify` — `{ kind: 'validation' }` if `title` or `body` is missing or not a string.

## Validation rules (handler side)

Every handler that takes parameters validates them before delegating to the service. Common patterns:

- Non-empty string fields → `validation` error: `Missing or invalid '<field>'`.
- Enum fields (`type`, `targetType`) → `validation` error: `Invalid '<field>' (must be <a> | <b> | …)`.
- Object fields where an object is required → `validation` error: `Invalid '<label>' payload`.
- Booleans are required when the field is non-optional → `validation` error: `Missing or invalid '<field>'`.

Schema-level validation (entity field rules) runs deeper, inside the services — see [Entity schema](customization-schema.md).

## Adding a new method

1. Define params and result types in `src/shared/` (the area's own module, or `src/shared/ipc-contract.ts`).
2. Add the handler to `src/main/ipc/<namespace>-handlers.ts` (`build<Namespace>Handlers`), validating raw params with the helpers (`asString`, `asObject`, `asScope`, …) from [`_validators.ts`](../../src/main/ipc/_validators.ts). A new namespace is also spread into `buildHandlers` in `src/main/ipc/registry.ts`.
3. Use `callIpc<Result>('namespace.method', params)` from the renderer.

There is no separate registration file for the channel itself — the dispatcher receives the full handler map and looks up `method` directly. Step-by-step guide: [Add an IPC method](../how-to/add-an-ipc-method.md).

## See also

- [Architecture overview](architecture.md) — how IPC sits between renderer and services.
- [Entity schema](customization-schema.md) — field rules enforced after the handler accepts the payload.
