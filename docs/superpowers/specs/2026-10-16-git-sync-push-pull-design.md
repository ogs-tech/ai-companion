# Git sync (push / pull / fetch / publish) in the Explorer — design

## Intent

The Explorer can stage, discard and commit, but a commit is a dead end: nothing can send it to the remote. `RepoGitPort` has no `push`, `pull` or `fetch`; the UI only shows `↑ahead ↓behind` in `GitBranchChip`. The user commits and cannot push.

## Goals

- Push, pull, fetch and publish a branch without leaving the Explorer.
- One smart button next to the branch chip whose action follows the repo state (layout "A", chosen in the visual companion).
- Failures (no upstream, rejected push, auth, network, divergence) are classified and explained, never a raw stderr dump alone.

## Non-goals

- Force push in v1 (**my call**: no `⋯` entry; revisit if requested).
- Credential management UI, PAT/SSH setup, credential prompts. Git runs non-interactively and uses the user's own credential helper / ssh-agent.
- Merge/rebase conflict resolution UI, "Commit & Push" split-button (option B was not chosen), multi-remote selection (uses the upstream's remote, else `origin`).
- Auto-fetch polling (v1 is manual; fetch on workspace activation is a later option).

## Behavior

Button state, derived from `GitStatus.head` (`upstream`, `ahead`, `behind`), `state === 'clean'` and an open repo:

| State | Button | Action |
|---|---|---|
| no `upstream`, `oid !== null` | ☁ Publicar branch | `git push --set-upstream <remote> <branch>` |
| `ahead > 0`, `behind === 0` | ↑ Push N | `git push` |
| `ahead === 0`, `behind > 0` | ↓ Pull N | `git pull --ff-only` |
| `ahead > 0`, `behind > 0` | ⟳ Sincronizar ↑N ↓M | pull `--ff-only`; if it can't fast-forward, stop with the divergence error (no merge/rebase created behind the user's back); on success then push |
| both `0` with upstream | ⟳ Fetch | `git fetch` |
| unborn branch, detached HEAD, or `state !== 'clean'` | hidden / disabled with tooltip | — |

The `⋯` menu lists Fetch, Pull and Push individually (each disabled when meaningless). While running: button shows "Enviando… / Baixando…", all git mutations disabled via the existing `busy` flag. After any op, invalidate the git status query so the chip counters refresh.

Errors map to domain errors in `domain/git-errors.ts` (new classes beside the existing ones) and flow through `toReport` → `GitErrorAlert`:

- `GitAuthError` — "Sem permissão para `origin`. Configure sua chave SSH ou credential helper." + stderr.
- `GitPushRejectedError` — remote has new commits; alert offers "Pull e tentar de novo".
- `GitNonFastForwardError` — pull can't fast-forward (divergence); explains and leaves the repo untouched.
- `GitNetworkError` — remote unreachable.
- Fallback: existing generic git error with stderr.

Classification is by stderr patterns in `simple-git-repo-client.ts` (auth: `Authentication failed`, `Permission denied (publickey)`, `could not read Username`; rejected: `[rejected]`/`fetch first`; network: `Could not resolve host`, `unable to access`). Git is spawned with `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND` unchanged except `-o BatchMode=yes` so a missing credential fails fast instead of hanging the app.

## Architecture (follows the existing hexagon)

- `RepoGitPort`: add `push(root, { setUpstream })`, `pull(root)`, `fetch(root)`; implement in `SimpleGitRepoClient`; add to `fake-repo-git-port.ts`.
- `GitService` (`application/services/`): thin methods validating state (clean, has commits) and the sync decision (the table above lives here, not in the renderer — renderer only renders `GitStatus`).
- IPC: `git.push`, `git.pull`, `git.fetch`, `git.sync` in `git-handlers.ts` + `registry.ts`; document in `docs/reference/ipc-contract.md` and `architecture.md`; update `docs/how-to/use-the-git-panel.md`.
- Renderer: `use-git.ts` mutations (`useGitPush/Pull/Fetch/Sync`), `useGitActions` gains them, new `GitSyncButton.tsx` (+ `⋯` menu) placed beside `GitBranchChip` in the Explorer toolbar; `GitErrorAlert` gets the "Pull e tentar de novo" action.

## Left to the builder

Exact copy/icon choices (pt-BR strings, lucide glyphs), menu component details, how `git.sync` reports partial success (pull ok, push failed) — the error must say which half failed.

## Verification

TDD where it fits: classification of stderr samples, `GitService` sync decision table, handler validation, renderer button states. Lint + typecheck + `npm test` green (release gate).
