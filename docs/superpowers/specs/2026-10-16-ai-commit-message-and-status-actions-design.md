# AI commit message and inline status actions — design

Date: 2026-10-16 · Branch: `feat/folder-workspace-model` · Status: draft for review

## Goal

Two improvements to the Explorer's git integration:

1. **Manage file status in place.** Stage, unstage and discard from the tree row itself, stage a whole folder, and see at a glance how many files are staged vs. changed.
2. **Generate the commit message with AI.** One click in the commit popover turns the staged diff into a message that follows the project's own commit convention.

## What exists today

- Status display is already built (uncommitted work on this branch): `git/git-decorations.ts` gives each file a letter (`M A D R C T U !`), a colour and `staged`/`unstaged` flags; `FolderTree` decorates rows and marks dirty directories.
- Management is minimal: right-click menu on a file (Open diff, Stage, Unstage, Descartar…) and **Stage all** in `ExplorerToolbar`. The old per-row buttons died with `GitView`/`RowAction`.
- Commit: `CommitPopover` → `CommitBox` → `git.commit` (free-text message).
- Nothing in the app calls a model. "No backend, no API" stays true: the only AI path is the user's own `claude` CLI.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| AI transport | `claude -p` (headless) as a subprocess. No SDK, no API key, no new dependency. |
| Message format | Detect the project's convention; fall back to Conventional Commits. |
| Convention sources | Markdown guidance, then formal config, then history, then default (see below). |
| AI button placement | Beside **Commit** in the popover action bar. |
| Status management | Hover actions on rows + toolbar summary chips + **Unstage all**. |
| Autonomy | The message only fills the editable field. It never commits on its own. |
| User's personal rules | Not applied. The message follows the *project's* convention only. |

## UX

### Status management (tree + toolbar)

- **File row, on hover**: inline icon buttons right-aligned before the badge.
  - `+` Stage — shown when the file has an unstaged side.
  - `−` Unstage — shown when it has a staged side.
  - `↶` Descartar — shown when it has an unstaged side; opens the existing confirmation (`requestDiscard`).
  - A file with both sides (`M·M`) shows all three; each acts on its own side.
- **Folder row, on hover**: `+` stages every change under the folder, `−` unstages every staged file under it. A button appears only if the folder contains something it would affect. Paths sent are the folder path itself (`git add -- <dir>` / `git restore --staged -- <dir>`).
- **Toolbar**: chips `N staged` and `N changes` (from `groupChanges`), **Stage all**, new **Unstage all**, **Commit…**. Chips and buttons are hidden/disabled when their count is 0.
- The right-click menu stays as is (still the only place for "Abrir diff").
- Hover buttons are keyboard-reachable: they are real `IconButton`s with `aria-label`s and become visible on row focus-within, not only on hover.

### Commit popover

Action bar: `☐ Amend … [✦ Gerar] [Commit]`.

| State | Behaviour |
|---|---|
| Idle, empty field | "✦ Gerar" enabled. |
| Generating | Button reads "◌ Gerando…" and is disabled; **Commit is disabled** (prevents committing mid-generation). |
| Generated | Message in the field, editable; button becomes "✦ Regerar". |
| Field already has text | Inline confirmation "Substituir o texto atual…? Substituir / Cancelar" before overwriting. |
| Error | Inline error below the field (`GitErrorAlert` style), e.g. missing `claude`. Field untouched. |
| Nothing staged | "Gerar" and "Commit" disabled, hint "Faça stage de ao menos um arquivo para gerar." |
| Amend ticked | "Gerar" is disabled (the staged diff is not the amended commit's content). |

## Convention detection

Pure function `detectCommitConvention(inputs) → CommitConvention`, in `src/main/application/services/git/`. Inputs are read by the service; the function does no I/O.

Precedence, highest first. Sources 1–3 **add up** in the prompt; 4 and 5 apply only if 1–3 produced nothing.

1. **Markdown guidance.** Look in the repo root for `CONTRIBUTING.md`, `.github/CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `docs/contributing*`. From each, keep only sections whose heading or body mentions "commit" (case-insensitive). Total capped at ~3,000 chars; if over, truncate per file in the order listed.
2. **Formal config.** `commitlint.config.*`, `.commitlintrc*`, `commitlint` key in `package.json`, or git's `commit.template`. Contents are passed as-is (capped at ~2,000 chars).
3. **History ratio.** Last 30 subjects: if ≥ 60 % match `^\w+(\([^)]+\))?!?: .+`, convention = Conventional Commits.
4. **Style examples.** History exists but is not conventional: pass the last 10 subjects as "match this style".
5. **Default.** Empty/unborn history: Conventional Commits, imperative mood, subject ≤ 72 chars, optional body explaining *why*.

The result is a `CommitConvention` value (`{ guidance?: string; config?: string; kind: 'conventional' | 'examples' | 'default'; examples?: string[] }`) that the prompt builder renders.

## Architecture (hexagonal)

```
renderer  CommitBox ──callIpc('git.generateCommitMessage')──┐
                                                            ▼
ipc       registry.ts  git.generateCommitMessage handler
                                                            ▼
service   commit-message-service
            ├─ RepoGitPort           (staged diff, --stat, recent subjects, config paths)
            ├─ ConventionSourcePort  (read the Markdown/config files — no node:fs in the service)
            ├─ detectCommitConvention (pure)
            ├─ buildCommitPrompt      (pure)
            └─ CommitMessageGeneratorPort
                                                            ▼
infra     ClaudeCliCommitMessageGenerator  (spawns `claude -p`)
```

- **`CommitMessageGeneratorPort`**: `generate(prompt: string, signal?: AbortSignal): Promise<string>`.
- **`ClaudeCliCommitMessageGenerator`**: spawns `claude -p`, writes the prompt to **stdin** (never argv), cwd = workspace root, 60 s timeout, captures stdout, strips code fences/quotes, rejects empty output.
- **`RepoGitPort` additions**: `stagedDiff(maxChars)`, `stagedStat()`, `recentSubjects(n)`, `commitTemplate()`. Same port as `git.commit` — user's repo, not the plugin `GitPort` (the two stay separate).
- **`ConventionSourcePort`**: reads named files relative to the workspace root; lives in `infrastructure/`.
- Wired in the composition root `src/main/index.ts`; the generator is only built in workspace-scoped services (at Início the method fails `validation`, like every `git.*`).

### Prompt contents

System instruction (fixed): write only the commit message, no preamble, no code fences, no co-author trailers; describe *what changed and why*; follow the convention below. Then: convention block (from detection), `git diff --staged --stat`, and the diff.

### Diff limits

- Diff capped at ~30,000 chars. Lockfiles, generated files and binaries appear only in `--stat`.
- Over the cap: `--stat` in full plus hunks of the first files until the budget ends, with a trailing note "diff truncated" in the prompt.

## IPC

| Method | Params | Result | Notes |
|---|---|---|---|
| `git.generateCommitMessage` | — | `{ message: string }` | `validation`: nothing staged or no workspace open. `not_found`: `claude` not on PATH (message names the command). `io`: timeout (`ClaudeTimeout`), non-zero exit (stderr in `details.stderr`, truncated to 4 KB) or empty output. |

Documented in `docs/reference/ipc-contract.md` under `git`. No new shared types beyond the result.

## Security and privacy

- The diff leaves the machine only through the user's own `claude` CLI, same trust boundary as any `run` session. No telemetry, no key stored.
- Prompt via stdin: no shell, no argv injection, no size limits from the OS.
- The model runs with **no tools** and must not modify the repo; the invocation disables tool use and does not persist a session (so it does not pollute the `~/.claude` transcripts the history screen reads).
- The user's personal `~/.claude/CLAUDE.md` should not influence the output. If the CLI cannot isolate user-level memory by flag, the prompt states that the project convention overrides any other instruction.

## Risks / to verify at implementation

- **Exact `claude -p` flags** for: disabling tools, not persisting the session, skipping user-level memory, plain-text output. Must be confirmed with `claude --help` before the adapter is written; if a flag does not exist, the design falls back to the prompt-level guard above and the spec is amended.
- Double reading of project `CLAUDE.md`: `claude -p` with cwd = repo may load it by itself; harmless duplication, bounded by the 3k-char cap.
- Latency of 2–5 s is expected; the UI must stay responsive (async + disabled states above).

## Testing

- `detectCommitConvention`: each precedence level, ratio threshold (59 % vs 60 %), empty history, Markdown section extraction and caps.
- `buildCommitPrompt`: truncation note, lockfile exclusion.
- `commit-message-service` with fake ports: nothing staged → `validation`; generator error mapping.
- `ClaudeCliCommitMessageGenerator`: against a fake executable (success, non-zero exit, timeout, empty output, fenced output, `ENOENT` → `not_found`). Never calls the real CLI.
- IPC handler: param validation (no params), error `kind` passthrough.
- Renderer (`CommitBox`/`CommitPopover`): all six states in the table, overwrite confirmation, Commit disabled while generating, Amend disables Gerar.
- Renderer (`FolderTree`, `ExplorerToolbar`): hover/focus actions per status combination (`M`, `M·M`, `U`, `D`, staged-only), folder-level stage/unstage, chips and **Unstage all**.
- Gate: `npm run lint`, `npm run typecheck`, `npm test` green.

## Docs to update

`docs/reference/ipc-contract.md` (new method), `docs/reference/architecture.md` (new ports/service), `docs/how-to/use-the-git-panel.md` (hover actions, chips, generate button, convention detection), `CLAUDE.md` line on "No backend, no API" gets a note that the AI path is the user's own `claude` CLI, headless.

## Out of scope

Multi-select and checkboxes, committing from a prompt without review, AI for PR descriptions or branch names, non-`claude` models, per-hunk staging, storing a user-chosen convention in settings (detection only).
