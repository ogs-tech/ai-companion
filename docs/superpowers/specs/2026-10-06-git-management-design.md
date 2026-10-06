# Git Management — Design

- **Date:** 2026-10-06
- **Status:** Spec written; pending author review. Section-by-section approval was skipped at the
  author's request — every decision in §2 was made by Claude and is open to correction.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** A general-purpose git client for the app's Projects (and the workspace root, when it is a
  repo), delivered as five independently shippable phases: **A** working tree, **B** branches,
  **C** remote sync, **D** history, **E** conflicts and stash. Each phase is sized to be implemented on
  its own (e.g. one `/feature-dev` run per phase), in order.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and problem

The app already owns the developer's day-to-day loop around a repo: it registers **Projects**
(`src/shared/project.ts`), browses and edits their files, and spawns `claude` sessions inside them. Those
sessions change files — and the moment the user wants to see *what* changed, stage it, commit it, switch
branch or push, they leave the app for a terminal or a separate git client.

What exists today is plumbing for a different audience:

- `GitPort` (`src/main/application/ports/git-port.ts`) + `SimpleGitClient`
  (`src/main/infrastructure/git/simple-git-client.ts`) serve **plugins and marketplaces** only — clone,
  pull, tag, publish. None of it is about a user's working tree.
- `RepoService` (`src/main/application/services/repo-service.ts`) reads `.git/HEAD` by hand for
  `detectGit` / `getCurrentBranch`. No IPC caller uses it from the renderer.
- The PRD lists **"Git history in the UI"** as a non-goal (`docs/explanation/prd.md` §6). This spec
  reverses that decision (§9).

## 2. Decisions

1. **Full git client, phased.** The author chose "general git client" over narrower framings
   (review-what-the-agent-did, branch-per-session, versioning `.ai-companion/`). Delivered as phases
   A→E; each phase is a complete, releasable slice that does not depend on a later one.
2. **Target = a repo root, addressed like `openWith.*`.** Every `git.*` method takes an optional
   `projectId`: present → that `Project`'s `path`; absent → the active workspace's `rootPath`. Same
   convention the `openWith` namespace already uses (`docs/reference/ipc-contract.md`, "Open with").
   The renderer never sends an absolute path. The repo root is *the target path itself* — a Project
   that is a subfolder of a larger repo is reported as `isRepo: false` (no `--show-toplevel` walking up),
   so a Project can never mutate files outside its own folder.
3. **A new port, not a bigger `GitPort`.** `GitPort` stays the plugin/publish port. Working-tree
   operations get their own `RepoGitPort`. The two have different callers, different error vocabularies
   and different safety rules; merging them would couple plugin publishing to UI concerns. `RepoService`
   is absorbed: its `detectGit`/`getCurrentBranch` are superseded by `git.status` and it is deleted in
   Phase A along with the `repo.detectGit` IPC method (no renderer caller exists).
4. **Shell out to the system `git` through `simple-git`** (already a dependency). No libgit2/isomorphic-git:
   the system binary gives us the user's own config, hooks, credential helpers and SSH agent for free —
   which is exactly what a git client used daily needs to respect.
5. **Parse machine formats, never human output.** Status via `git status --porcelain=v2 --branch -z
   --untracked-files=all`, diffs via `git diff --no-color --no-ext-diff -U3`, logs via
   `git log -z --format=<fixed record format>`. Parsers are pure functions with fixture-based tests.
6. **Reads never take locks.** Every read command runs with `--no-optional-locks` (env
   `GIT_OPTIONAL_LOCKS=0`), so polling `status` can't collide with a running `claude` session or the
   user's own terminal fighting over `index.lock`.
7. **Non-interactive, always.** Every spawned git gets `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`,
   `GIT_MERGE_AUTOEDIT=no`, `GIT_PAGER=cat`, `LC_ALL=C` (stable parseable messages), and a timeout
   (30s local ops, 120s network ops). A command that would prompt fails fast with a classified error
   instead of hanging the main process.
8. **Hooks run.** `commit` never passes `--no-verify`. A failing hook is surfaced with its output.
9. **Auth = whatever the user's git already uses.** SSH agent / keychain / `credential.helper`. The
   GitHub PAT stored in `safeStorage` is **not** injected into git in this spec (it would mean writing a
   credential helper or putting a secret in argv/env); a failed auth surfaces `kind: 'auth'` with a hint.
   Trade-off: HTTPS remotes without a configured helper won't push from the app. Revisit as its own spec.
10. **No new dependency for diffs.** Diffs render in a custom read-only `DiffView` (unified view) from the
    parsed hunks. `@codemirror/merge` (side-by-side, editable) was considered and rejected for now: new
    dependency, and editing belongs in the existing `EditorPanel`.
11. **Refresh by polling, not watching.** react-query refetch: on window focus, after every mutation
    (invalidation), and every 5s **only while the Git view is visible**. No chokidar watcher on the
    worktree: agent sessions write files without touching `.git/`, so a `.git`-only watcher would miss
    most changes, and a full worktree watcher is too expensive on large repos.
12. **Mutations are serialized per repo.** `GitService` holds a per-repo-root promise queue; two
    mutations on the same repo never run concurrently from the app. Reads bypass the queue.
13. **Destructive operations require explicit confirmation in the UI** (discard, branch force-delete,
    force-push, stash drop, abort). The IPC itself does not confirm — the renderer does, with a dialog
    naming exactly what will be lost.

## 3. Architecture

```
renderer                         main
────────                         ────
GitView (Explorer Panel)  ─┐
DiffTab / LogTab (Workbench)├─ callIpc('git.*') ─► registry.ts (validate) ─► GitService ─► RepoGitPort
use-git-*.ts hooks         ─┘                                                    │              │
                                                                   RepoRootResolver       SimpleGitRepoClient
                                                                   (ProjectService,       (simple-git + parsers)
                                                                    WorkspaceService)
```

### 3.1 Main process

| Layer | File | Responsibility |
|---|---|---|
| shared | `src/shared/git.ts` | All `git.*` param/result types (§4). |
| port | `src/main/application/ports/repo-git-port.ts` | `RepoGitPort` — one method per git operation, takes an absolute `root`, returns parsed domain types. |
| service | `src/main/application/services/git-service.ts` | Resolves `projectId?` → root, validates repo-relative paths, serializes mutations, maps port errors to `DomainError`. Depends only on ports. |
| domain | `src/main/domain/git-errors.ts` | `NotARepositoryError` (`not_found`), `GitConflictError` (`conflict`), `GitAuthError` (`auth`), `GitCommandError` (`io`, carries trimmed stderr in `details.stderr`). |
| infra | `src/main/infrastructure/git/simple-git-repo-client.ts` | Implements `RepoGitPort` over `simple-git` with the env/timeout policy of §2.6–2.7. |
| infra | `src/main/infrastructure/git/parsers/{status,diff,log,branches}.ts` | Pure parsers for porcelain v2 status, unified diff, `-z` log records, `for-each-ref` output. |
| infra | `src/main/infrastructure/git/classify-git-error.ts` | Maps git stderr (under `LC_ALL=C`) to error classes: `not a git repository`, `Authentication failed` / `Permission denied (publickey)`, `index.lock`, `CONFLICT`, `non-fast-forward`, `would be overwritten by checkout`, etc. Unknown → `GitCommandError`. |
| ipc | `src/main/ipc/git-handlers.ts` | Handlers for the `git` namespace, wired into `registry.ts`; validates with `_validators.ts` helpers. |
| composition | `src/main/index.ts` | Wires `SimpleGitRepoClient` → `GitService` → handlers. Rebuilt on `workspace.switchTo` like the other workspace-bound services. |

**Root resolution** reuses the `projectId?` → root logic already duplicated in the open-with handlers
(see the "Open-with handler DRY debt" note). This spec does **not** fix that debt — it adds a small
`resolveRepoRoot(projectId?)` inside `GitService` and leaves consolidation to its own PR, per the
"keep refactors out of feature PRs" rule.

**Path validation.** Every `path`/`paths` param is repo-relative: rejected (`validation`) if absolute,
empty, containing a `..` segment, or containing a NUL byte. Paths are always passed to git after `--`
so a filename starting with `-` can never be read as a flag.

### 3.2 Renderer

| File | Responsibility |
|---|---|
| `src/renderer/hooks/use-git.ts` | react-query hooks: `useGitStatus(projectId?)`, `useGitDiff(...)`, `useGitBranches`, `useGitLog`, mutation hooks that invalidate `['git', root]` on success. |
| `src/renderer/components/workspace/git/GitView.tsx` | The Source Control view inside the Explorer Panel (§3.3). |
| `src/renderer/components/workspace/git/ChangeList.tsx` | "Staged" and "Changes" groups built on `TreeGroup`/`TreeRow`; per-row stage/unstage/discard actions. |
| `src/renderer/components/workspace/git/CommitBox.tsx` | Message field + Commit button (+ "Amend" toggle). |
| `src/renderer/components/workspace/git/BranchBar.tsx` | Current branch, ahead/behind, branch picker (B), fetch/pull/push (C). |
| `src/renderer/components/workspace/git/DiffView.tsx` | Read-only unified diff from `GitFileDiff` hunks, JetBrains Mono, add/del gutters with line numbers. |
| `src/renderer/components/workspace/git/LogView.tsx` | History list with a lane graph (D). |
| `src/renderer/lib/git-graph.ts` | Pure `computeGraphLanes(commits)` → lane index + edges per row (D). |

### 3.3 Where it lives in the UI

- **Explorer Panel gets a view switch: "Arquivos | Git".** The panel header gains a two-option segmented
  control; "Git" swaps the `FolderTree` body for `GitView`. Scope follows the Explorer Panel's existing
  selected Project (`selectedProjectId`); with no Project selected it targets the workspace root.
  In multi-project view mode the Git view shows a Project picker at its top, since status is per repo.
- **New Workbench tab kinds** added to `OpenTab` in `WorkspaceScreen.tsx`:
  - `{ kind: 'git-diff'; projectId?: string; path: string; source: GitDiffSource }` — opened by clicking
    a changed file; id `git-diff:<root>:<source>:<path>`, so re-clicking focuses instead of duplicating.
  - `{ kind: 'git-log'; projectId?: string }` (D) — the history tab.
  - `{ kind: 'git-commit'; projectId?: string; sha: string }` (D) — a commit's details.
  None of these hold unsaved work, so `isDirty` stays false for them.
- A non-repo target shows an empty state ("Esta pasta não é um repositório git") with **"Inicializar
  repositório"** (`git.init`) as its only action.
- UI copy is pt-BR, matching the rest of the app; identifiers and code are English.

## 4. IPC contract (`git` namespace)

All methods accept `projectId?: string` (omitted below). Common errors: `not_found` for an unknown
`projectId` or a target that is not a repo (except `git.status`, which reports `isRepo: false`);
`validation` for bad params; `conflict` for `index.lock` contention, merge conflicts, non-fast-forward and
dirty-tree refusals; `auth` for credential failures; `io` for any other git failure (stderr in
`details.stderr`, truncated to 4KB).

### 4.1 Shared types (`src/shared/git.ts`)

```ts
export type GitChange =
  | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'
  | 'typechange' | 'untracked' | 'unmodified';

export interface GitFileChange {
  path: string;            // repo-relative, forward slashes
  origPath?: string;       // renames/copies only
  index: GitChange;        // X column of porcelain v2
  worktree: GitChange;     // Y column
  conflicted: boolean;     // 'u' records
}

export type GitRepoState = 'clean' | 'merging' | 'rebasing' | 'cherry-picking' | 'reverting';

export interface GitBranchHead {
  name: string | null;     // null when detached
  oid: string | null;      // null on an unborn branch
  upstream?: string;
  ahead: number;
  behind: number;
}

export type GitStatus =
  | { isRepo: false }
  | { isRepo: true; head: GitBranchHead; state: GitRepoState; files: GitFileChange[]; truncated: boolean };

export type GitDiffSource =
  | { kind: 'worktree' }               // index → worktree   (A)
  | { kind: 'index' }                  // HEAD  → index      (A)
  | { kind: 'commit'; sha: string };   // sha^  → sha        (D)

export interface GitDiffLine { kind: 'context' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number }
export interface GitHunk { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: GitDiffLine[] }
export type GitFileDiff =
  | { kind: 'text'; path: string; oldPath?: string; hunks: GitHunk[] }
  | { kind: 'binary'; path: string }
  | { kind: 'too-large'; path: string; bytes: number };
```

`files` is capped at 5,000 entries (`truncated: true` beyond that). A diff over 1MB or 20,000 lines
returns `too-large`. Untracked files diff against `/dev/null` (`git diff --no-index`), so they render as
all-added.

### 4.2 Phase A — working tree

| Method | Params | Result | Notes |
|---|---|---|---|
| `git.status` | — | `GitStatus` | Never throws for a non-repo. |
| `git.diff` | `{ path: string; source: GitDiffSource }` | `GitFileDiff` | `commit` source rejected (`validation`) until Phase D. |
| `git.stage` | `{ paths: string[] }` | `void` | `git add -- <paths>`; also stages deletions. |
| `git.unstage` | `{ paths: string[] }` | `void` | `git restore --staged -- <paths>`; on an unborn branch, `git rm --cached`. |
| `git.discard` | `{ paths: string[] }` | `void` | Tracked: `git restore --worktree -- <paths>` (back to the index). Untracked: `git clean -f -- <paths>`. Never touches the index. Renderer confirms first. |
| `git.commit` | `{ message: string; amend?: boolean }` | `{ sha: string }` | `validation` if `message.trim()` is empty or nothing is staged (unless `amend`). Hook failure → `io` with hook output. Message passed via `-F -` (stdin), never argv. |
| `git.init` | — | `void` | Only when `git.status` reports `isRepo: false`; `conflict` otherwise. |

Removed in Phase A: `repo.detectGit` (no renderer caller), `RepoService`, its `RepoReader` port if
nothing else uses it.

### 4.3 Phase B — branches

| Method | Params | Result | Notes |
|---|---|---|---|
| `git.branches` | — | `{ local: GitBranch[]; remote: GitBranch[] }` | via `git for-each-ref`. |
| `git.checkout` | `{ branch: string }` | `void` | A remote-only branch (`origin/x`) creates a local tracking branch `x`. Dirty-tree refusal → `conflict` with git's file list in `details.files`. Never `--force`. |
| `git.createBranch` | `{ name: string; from?: string; checkout: boolean }` | `void` | Name validated with `git check-ref-format --branch`. |
| `git.deleteBranch` | `{ name: string; force: boolean }` | `void` | Current branch → `validation`. Unmerged without `force` → `conflict` (renderer then offers a confirmed force delete). |

```ts
export interface GitBranch {
  name: string; current: boolean; upstream?: string; ahead: number; behind: number;
  lastCommit: { sha: string; subject: string; date: string /* ISO */ };
}
```

### 4.4 Phase C — remote sync

| Method | Params | Result | Notes |
|---|---|---|---|
| `git.remotes` | — | `{ name: string; fetchUrl: string; pushUrl: string }[]` | URLs with credentials stripped (`https://***@…`, same sanitizer as `SimpleGitClient`). |
| `git.fetch` | `{ remote?: string }` | `void` | `--prune`; all remotes when omitted. |
| `git.pull` | `{ strategy: 'ff-only' \| 'merge' \| 'rebase' }` | `{ updated: boolean }` | UI default `ff-only`; a divergence returns `conflict` and the UI offers merge/rebase. A pull that stops on conflicts returns `conflict` and the repo enters `merging`/`rebasing` (→ Phase E UI; before E ships, the UI shows a banner telling the user to resolve in a terminal). |
| `git.push` | `{ remote?: string; setUpstream?: boolean; forceWithLease?: boolean }` | `void` | No upstream → UI offers `setUpstream` against `origin`. Plain `--force` is never exposed; only `--force-with-lease`, behind a confirmation. |

Network operations show progress as an indeterminate spinner on the `BranchBar`; cancellation is out of
scope (they time out at 120s).

### 4.5 Phase D — history

| Method | Params | Result | Notes |
|---|---|---|---|
| `git.log` | `{ ref?: string; path?: string; skip: number; limit: number }` | `GitCommitSummary[]` | `limit` ≤ 200. `ref` defaults to `HEAD`. `path` filters to one file (`--follow`). |
| `git.show` | `{ sha: string }` | `GitCommitDetail` | Files with per-file add/del counts (`--numstat`). |

`git.diff` accepts `source: { kind: 'commit'; sha }` from this phase on.

```ts
export interface GitCommitSummary {
  sha: string; parents: string[]; subject: string;
  authorName: string; authorEmail: string; date: string; // ISO
  refs: string[]; // decorations: branches, tags, HEAD
}
export interface GitCommitDetail extends GitCommitSummary {
  body: string;
  files: { path: string; oldPath?: string; change: GitChange; additions: number | null; deletions: number | null }[];
}
```

`LogView` paginates with `useInfiniteQuery` (`skip` += `limit`). The lane graph is computed in the
renderer by `computeGraphLanes` from `parents` alone. No extra git call per row.

### 4.6 Phase E — conflicts and stash

| Method | Params | Result | Notes |
|---|---|---|---|
| `git.resolve` | `{ path: string; take: 'ours' \| 'theirs' \| 'manual' }` | `void` | `ours`/`theirs`: `git checkout --ours/--theirs -- path` then `git add`. `manual`: `git add` only, rejected (`validation`) if the file still contains conflict markers (`^<<<<<<< `, `^>>>>>>> `). |
| `git.continue` | — | `void` | Continues the operation named by `state` (`merge --continue`, `rebase --continue`, `cherry-pick --continue`, `revert --continue`). `conflict` if unresolved files remain. |
| `git.abort` | — | `void` | Aborts the operation named by `state`. Renderer confirms first. |
| `git.stashList` | — | `{ index: number; message: string; date: string }[]` | |
| `git.stashPush` | `{ message?: string; includeUntracked: boolean }` | `void` | |
| `git.stashApply` | `{ index: number; pop: boolean }` | `void` | Conflicts → `conflict`. |
| `git.stashDrop` | `{ index: number }` | `void` | Renderer confirms first. |

Conflicted files open in the existing `EditorPanel` as plain file tabs (conflict markers are text). A
three-way merge editor is out of scope. The Git view, when `state !== 'clean'`, shows a banner naming the
operation with **Continuar** / **Abortar**, and lists conflicted files in their own group above
"Staged" with **Usar nosso / Usar deles / Marcar como resolvido** row actions.

## 5. Data flow (Phase A, end to end)

1. User switches the Explorer Panel to "Git". `GitView` mounts → `useGitStatus(projectId)` →
   `callIpc('git.status', { projectId })`.
2. Handler validates params → `GitService.status(projectId)` → resolve root → `RepoGitPort.status(root)` →
   `git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=all` → `parseStatus`.
3. `GitView` renders "Staged" (`index !== 'unmodified' && index !== 'untracked'`) and "Changes"
   (`worktree !== 'unmodified'`). A file with both partial index and worktree changes appears in both.
4. Click a row → `openGitDiffTab({ projectId, path, source })` → `DiffView` → `useGitDiff` → `git.diff`.
5. Stage → `git.stage` → `GitService` enqueues on the root's mutation queue → on success the hook
   invalidates `['git', root]`; status and any open diff tabs for that root refetch.
6. While the Git view stays visible, status refetches every 5s; switching back to "Arquivos" stops it.

## 6. Error handling

- **Classification** (`classify-git-error.ts`) runs on stderr under `LC_ALL=C`. Every class has a fixture
  test. Unknown stderr → `GitCommandError` (`io`) with stderr in `details.stderr` — never swallowed, never
  rewritten as success.
- **Renderer** shows mutation errors in the existing snackbar pattern, with `details.stderr` behind a
  "Ver detalhes" disclosure. `conflict` errors carrying `details.files` list those files.
- **`git` missing from PATH:** `git.status` returns `io` with `message: 'GitNotFound'`; `GitView` shows
  an empty state explaining it. Packaged Electron apps on macOS get launchd's minimal PATH. Phase A must
  confirm the app's existing PATH handling (whatever `SimpleGitClient.checkGitAvailable` relies on) covers
  Homebrew git, and fix it there if not.
- **Timeouts** kill the child process and return `io` with `message: 'GitTimeout'`.
- **Partial batch failures** (`stage`/`unstage`/`discard` on several paths) are all-or-nothing from git's
  side for a single invocation. The service issues one invocation per call, so there is no partial state
  to report.

## 7. Testing

| Level | What | Where |
|---|---|---|
| Parser unit | porcelain v2 (renames, conflicts `u`, unborn branch, detached HEAD, paths with spaces/unicode/newlines via `-z`), unified diff (no-newline-at-EOF, binary, mode-only, rename), log `-z` records, `for-each-ref` | `tests/main/infrastructure/git/parsers/*.test.ts` |
| Error classification | One stderr fixture per class | `tests/main/infrastructure/git/classify-git-error.test.ts` |
| Adapter integration | Real temp repos (`mkdtemp` + `git init`, the pattern in `simple-git-client.test.ts`): each phase's operations against a real git, including a bare repo as remote for Phase C and a forced conflict for Phase E | `tests/main/infrastructure/git/simple-git-repo-client.test.ts` |
| Service | `FakeRepoGitPort` (`__fixtures__/fake-repo-git-port.ts`): root resolution, path validation (`..`, absolute, NUL, leading `-`), mutation serialization (two concurrent mutations run in order), error mapping | `tests/main/application/services/git-service.test.ts` |
| IPC | Param validation per method; error kind passthrough | `tests/main/ipc/git-handlers.test.ts` |
| Renderer | `GitView` (groups, empty states, non-repo, confirm dialogs on destructive actions), `DiffView` rendering, `computeGraphLanes` (linear, merge, octopus, branch fan-out) | `tests/renderer/...` |

Coverage thresholds from `vitest.config.ts` apply to the new `application/`, `ipc/`, `infrastructure/`
code. Each phase ships with green `npm run lint`, `npm run typecheck`, `npm test`.

## 8. Phase boundaries (what each `/feature-dev` run delivers)

| Phase | Delivers | Done when |
|---|---|---|
| **A** | §3 scaffolding, `git.status/diff/stage/unstage/discard/commit/init`, Explorer view switch, `GitView`, `ChangeList`, `CommitBox`, `DiffView`, `git-diff` tab, removal of `RepoService`/`repo.detectGit`, PRD + docs updates (§9) | A user can review, stage, discard and commit agent changes without leaving the app. |
| **B** | `git.branches/checkout/createBranch/deleteBranch`, `BranchBar` with picker | Switch/create/delete branches from the Git view. |
| **C** | `git.remotes/fetch/pull/push`, sync buttons + ahead/behind in `BranchBar` | Round-trip with a remote over the user's existing SSH/credential setup. |
| **D** | `git.log/show`, `commit` diff source, `git-log` + `git-commit` tabs, `LogView`, `computeGraphLanes` | Browse history with a graph, open any commit, view any file diff in it. |
| **E** | `git.resolve/continue/abort/stash*`, state banner, conflict group | Finish or abort a conflicted pull/merge/rebase and manage stashes in-app. |

Each phase updates `docs/reference/ipc-contract.md` with its own methods in the same PR.

## 9. Documentation changes

- `docs/explanation/prd.md` — remove the "Git history in the UI" non-goal; add a **Git** bullet under
  §5 "Organization" ("A git client per Project: working tree, branches, sync, history, conflicts — over
  the user's own git install and credentials"); changelog entry dated 2026-10-06 explaining the reversal
  (sessions change files in Projects; reviewing and committing that work is part of the loop the app
  already owns).
- `docs/reference/architecture.md` — `RepoGitPort`/`GitService`/`SimpleGitRepoClient` alongside the
  existing `GitPort` note, stating why they are separate (§2.3); remove the `repo-service` bullet.
- `docs/reference/ipc-contract.md` — new `git` namespace section; remove `repo.detectGit`.
- `CLAUDE.md` — one gotcha line: two git ports exist (`GitPort` for plugins, `RepoGitPort` for the user's
  repos); don't merge them.

## 10. Out of scope

- Hunk- or line-level staging (`git add -p`). Natural follow-up to Phase A once `DiffView` exists.
- Injecting the stored GitHub PAT into git HTTPS auth (§2.9).
- Three-way merge editor; interactive rebase; cherry-pick/revert initiation; tags; submodules; worktrees;
  `git blame`; signing configuration (signing that the user's git config already enables just works).
- Git decorations (M/U badges) in the file tree.
- Pull requests / GitHub API features.
- Watching the filesystem for changes (§2.11).

## 11. Open questions for the author

1. **Explorer view switch vs. Control Panel group.** This spec puts Git in the Explorer Panel (§3.3),
   next to the files it describes. The alternative is a `TreeGroup` in the Control Panel next to
   Sessions, which keeps the file tree always visible but crowds that panel.
2. **Workspace root as a target.** Supported via the absent `projectId` (§2.2). If workspaces are never
   repos in practice, dropping it simplifies the UI's scope logic.

## 12. Phase A — implementation notes (2026-10-06)

Where Phase A deviates from, or settles, what this spec said:

- **PATH (§6).** There was no PATH handling to confirm: `SimpleGitClient.checkGitAvailable` had no caller.
  `src/main/infrastructure/system/augment-path.ts` now appends `/opt/homebrew/bin:/usr/local/bin` to the
  process PATH on macOS at startup, which also covers spawning `claude`.
- **simple-git env guard (§2.7).** simple-git ≥3.36 refuses `GIT_EDITOR`/`GIT_PAGER` (and the user's
  inherited `GIT_SSH_COMMAND`/`GIT_ASKPASS`) unless opted in. `SimpleGitRepoClient` opts in to exactly
  those four categories. It also treats any non-zero exit as a failure: simple-git's default ignores a
  non-zero exit with empty stderr, which would report a hook that fails on stdout as a successful commit.
- **Commit message (§4.2).** simple-git has no stdin channel, so `-F -` became `--file <tmp>` (a private
  temp dir, removed afterwards). It is still never in argv.
- **Untracked diffs (§4.1).** These are built from the file's bytes (`addedFileDiff`) instead of
  `git diff --no-index`, with the same binary heuristic (a NUL in the first 8000 bytes) and the same size
  limits. A symlink renders as its target text, as git records it.
- **`RepoGitPort.isRepo(root)`** was added, so mutations check the target without a full `status`.
- **`repo.getCurrentBranch`** was removed together with `repo.detectGit`. Neither had a renderer caller.
- **Staged renames** diff as an added file in Phase A (`git diff --cached -- <new path>` doesn't pair the
  old path). This is acceptable until Phase D adds rename-aware diffs.
- **Errors** render inline in the Git view (an `Alert` with a "Ver detalhes" disclosure), not through the
  shared `Toast`.
