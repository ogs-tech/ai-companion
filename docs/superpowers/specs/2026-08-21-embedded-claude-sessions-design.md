# Embedded Claude Sessions — Design

- **Date:** 2026-08-21
- **Status:** Design approved by author; pending implementation plan.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Let the author launch and interact with a real, interactive `claude` CLI session from
  inside AI Companion, attached to a specific customization (Skill, Agent, or Instruction), instead
  of alt-tabbing to a terminal. This is a new bounded context (`session`) alongside the existing
  `entity` one — it does not touch Skill/Agent/Instruction CRUD, sync, or the adapter machinery.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

The author's stated goal for this round of work was broader: "centralize AI Companion as my
workplace and replace the terminal." Checked against `docs/explanation/prd.md`, that PRD currently
scopes the app as a solo dogfooding spike limited to customization CRUD + symlink sync, and
explicitly lists "tools other than Claude Code" and "marketable product" as out of scope. The
author confirmed during brainstorming that **the PRD is already stale** and this pivot is expected
to extend it, not fit inside it as written — but rewriting the PRD itself is a separate follow-up,
not part of this spec.

"Replace the terminal" was decomposed during brainstorming into a much narrower, concrete slice
(see §2). The two pains that motivated it: juggling multiple terminal tabs across
sessions/projects, and poor visibility into what a running `claude` session is doing. Full
multi-agent orchestration / tool-calling (hinted at in the author's own `new-version.md` draft) and
a general-purpose shell replacement (git/npm/etc.) were both explicitly ruled out for this slice —
see §2 for the specific decisions and why.

## 2. Decisions made during brainstorming

1. **Scope is "embed the `claude` CLI," not "build a terminal."** The embedded PTY only ever runs
   `claude` (interactively, with resume support) — never a general shell. git/npm/etc. keep
   happening in a real terminal. This keeps the product's identity as a Claude Code companion
   rather than turning it into a terminal emulator (which would compete with iTerm2/Warp and has
   nothing to do with the original problem).
2. **Not per-project — per customization.** The first pass of this design anchored sessions to
   "projects" (a `repoPath`-keyed list). That was rejected: `settings.linkedRepos` was already
   removed from this app (see CLAUDE.md), and reintroducing an independent "project" registry would
   contradict that decision. Instead, a session is anchored to **any single customization entity**
   (Skill, Agent, or Instruction — all types, uniformly, "simplify" per the author), keyed by its
   `urn`. The entry point is a button inside that customization's own editor screen, not a separate
   top-level "Sessions" nav item — the editor and the live session sit side by side.

   > **Superseded in part** by the 2026-08-22 Workspace/Project design (see its §2.12): a new,
   > independent `Project` concept now exists there, and sessions may additionally anchor directly to
   > a `Workspace` or `Project`, not only to a customization entity. The per-entity anchor described
   > above is unchanged and still valid — this is additive, not a reversal.
3. **Working directory is derived from the entity, not asked for.**
   - `ProjectInstruction` → its own `repoPath`.
   - Everything else (`Skill`, `Agent`, `PersonalInstruction` — none of which carry a `repoPath`
     today) → the app's workspace root (`~/.ai-companion/`), where that customization's own file
     already lives and is already symlinked into `~/.claude/`. Testing there reflects exactly what
     Claude Code itself will see.
4. **No background daemon — sessions die with the app.** Closing AI Companion sends the PTY
   processes SIGTERM (`before-quit` in `src/main/index.ts`). Reopening a customization's session
   resumes via `claude --continue`/`-r`, which already knows how to pick the conversation back up
   from Claude Code's own history. A persistent background daemon (sessions surviving the app
   closing, reconnected on reopen) was considered and explicitly rejected as unnecessary complexity
   for a solo local app.
5. **One active session per customization.** Reopening a customization that already has a live
   session reconnects to it instead of spawning a second PTY. Not explicitly requested by the
   author — a default chosen for simplicity; flag for confirmation if multiple concurrent sessions
   per customization turns out to be wanted later.
6. **Output delivery: event push on a new channel, not polling.** The existing `ipc:call` envelope
   (`docs/reference/ipc-contract.md`) is request/response and unsuited to a continuous PTY stream.
   Chosen: keep `ipc:call` for control actions (spawn/write/resize/kill) under a new `session.*`
   namespace, and add a **separate** push channel (`webContents.send('session:output', …)` /
   `'session:exit'`) for streamed output — the standard pattern used by VS Code's integrated
   terminal and other Electron + xterm.js apps. Two alternatives were considered and rejected:
   a dedicated `MessageChannelMain` per session (more throughput, but real added lifecycle
   complexity for a single-user local app with modest output volume) and polling the existing
   `ipc:call` on an interval (reuses the contract as-is, but introduces perceptible input lag —
   unacceptable for something meant to feel like a real terminal).
7. **`Session` is not a fourth `Entity` kind.** It is ephemeral process state, not a Markdown+YAML
   file synced by symlink, so it does not go through `EntityService`/`EntityRepository`. It is a
   new, separate bounded context.

## 3. Architecture

Mirrors the existing hexagonal split (`domain` / `application/{ports,services}` / `infrastructure`
/ `ipc`) used by the `entity` context, so the pattern stays consistent across the codebase.

- **`src/main/application/ports/claude-session-port.ts`** — `ClaudeSessionPort`:
  `spawn(entityUrn, cwd, opts)`, `write(sessionId, data)`, `resize(sessionId, cols, rows)`,
  `kill(sessionId)`, plus `onData`/`onExit` callbacks. Services depend on this port only, never on
  `node-pty` directly — same rule the rest of `src/main/` already follows.
- **`src/main/application/services/session-service.ts`** — owns the one-session-per-entity
  invariant, assigns/looks up session ids by `entityUrn`, resolves `cwd` from the entity (§2.3),
  exposes spawn/write/resize/kill/get-status to the IPC layer, and kills every live session on
  `killAll()` (called from `before-quit`).
- **`src/main/infrastructure/claude-cli/node-pty-session-adapter.ts`** — implements the port via
  `node-pty`, spawning `claude` (with `--continue`/`-r` when a prior session/transcript exists) with
  the resolved `cwd`. Separate from the existing `node-claude-cli-adapter.ts`, which only does
  one-shot, tool-free, non-interactive calls (used today for instruction-draft generation) — that
  adapter is untouched.
- **IPC:** new `session.*` namespace in `src/main/ipc/registry.ts` (`spawn`, `write`, `resize`,
  `kill`, `status`) via the existing `ipc:call` request/response envelope, validated with
  `_validators.ts` helpers per the existing convention. Plus the new push channel described in §2.6,
  wired once per renderer window and bridged through `src/preload/index.ts` as
  `window.api.session.onOutput(sessionId, cb)` / `onExit(sessionId, cb)`, both returning a disposer
  so the renderer can unsubscribe cleanly (important for HMR — see §5).
- **Renderer:** each customization's editor screen (`CustomizationEditor.tsx` and equivalent
  Instruction screens) gains a session panel — an "Open session" action plus, once spawned, a
  terminal pane. The terminal pane wraps `@xterm/xterm` + `@xterm/addon-fit`.

### New dependencies (flagging per project convention — none exist as native modules today)

- **`node-pty`** — spawns a real PTY. This would be the **first native module** in this codebase
  (current `package.json` has none), which means a native-rebuild step (`electron-rebuild` /
  `@electron/rebuild`) becomes part of `npm install` / CI for the first time. Recommended over
  faking a PTY with plain `child_process` pipes because `claude`'s interactive TUI checks
  `process.stdout.isTTY` and needs a real PTY to render correctly (cursor movement, spinners, raw
  keyboard input). If the native rebuild proves painful against Electron 41 in practice, the fallback
  is a prebuilt-binary fork such as `@homebridge/node-pty-prebuilt-multiarch`, API-compatible with
  `node-pty`.
- **`@xterm/xterm` + `@xterm/addon-fit`** — terminal rendering in the renderer. Pure JS, no native
  code. Industry-standard choice (VS Code, Hyper, every Electron terminal app); hand-rolling ANSI
  parsing was not seriously considered.

## 4. Data flow

1. Author clicks "Open session" on a customization's editor screen → renderer calls
   `callIpc('session.spawn', { entityUrn })`.
2. `SessionService.spawn` looks up an existing live session for that `urn` and returns it if found
   (idempotent open — no duplicate process); otherwise resolves `cwd` from the entity and asks
   `ClaudeSessionPort.spawn` to fork a PTY running `claude` (`--continue` if a prior transcript for
   that entity exists) with that `cwd`.
3. The adapter's PTY `onData` forwards each chunk immediately; `SessionService` relays it to the IPC
   layer, which pushes `webContents.send('session:output', { sessionId, chunk })` to the owning
   window.
4. The renderer's listener writes the chunk straight into that session's `xterm.js` instance.
5. Keystrokes: `xterm.js`'s `onData` calls `callIpc('session.write', { sessionId, data })` →
   `SessionService.write` → adapter writes to the PTY's stdin.
6. Resize: the `fit` addon reacts to the terminal pane's size and calls
   `callIpc('session.resize', { sessionId, cols, rows })` → PTY `.resize()`.
7. Exit: the `claude` process exits → adapter fires `onExit` → `SessionService` marks the session
   `exited` → `session:exit` push → the pane switches to an "ended — resume" state, keeping
   scrollback visible instead of disappearing.
8. App quit: `before-quit` in `src/main/index.ts` calls `SessionService.killAll()`, SIGTERM-ing every
   live PTY so nothing leaks as an orphan process — the concrete implementation of the "sessions die
   with the app" decision (§2.4).

## 5. Error handling

- `claude` missing from `$PATH` / spawn failure → the port rejects, surfaced through the existing
  dispatcher's `DomainError` → `IpcError.kind` mapping, shown inline in the session panel — not a
  crash.
- Writing to a session that just exited (race between a keystroke and process exit) is a no-op; the
  UI reflects the `exited` state instead of throwing.
- Renderer reload/remount (Vite HMR in dev, part of this project's normal dev workflow) must not
  kill a live session: the PTY lives in the main process, independent of renderer lifecycle. Only
  the `xterm.js` view needs to re-subscribe to the existing output stream on remount. This needs an
  explicit test/manual check since HMR is exercised constantly during `npm run dev`.
- Orphaned processes on an app **crash** (as opposed to a clean quit) are an accepted edge case, not
  something this design mitigates — it follows directly from choosing "no daemon" in §2.4. Noting it
  here for awareness, not proposing recovery, since that would be scope creep beyond what was asked.

## 6. Testing

- `node` project: `SessionService` unit tests against a `FakeClaudeSessionPort` (mirrors the
  existing `tests/main/.../__fixtures__/fake-claude-cli-port.ts` pattern) — covering
  spawn/reuse-by-urn, write, kill, `killAll`, and the running → exited transition, with no real PTY
  involved.
- `node` project: `session-handlers` IPC tests following the existing
  `tests/main/ipc/typed-handlers.test.ts` pattern — param validation and `DomainError` → `IpcError`
  mapping.
- `NodePtySessionAdapter` itself gets intentionally lighter coverage — spawning a real PTY is better
  suited to a narrow manual/integration smoke test than a unit test, consistent with how thin
  infrastructure adapters are already treated elsewhere in this codebase.
- `jsdom` project: the session panel's tests mock `window.api.session.*`; they don't render a real
  `xterm.js` terminal in jsdom, only assert the write/output wiring.

## 7. Explicitly out of scope (for this spec)

- A general-purpose embedded shell (git/npm/arbitrary commands) — ruled out in §2.1.
- A dedicated top-level "Sessions" list/nav item — sessions are reached through each customization's
  own editor screen (§2.2).
- Multi-agent orchestration / tool-calling beyond what `claude` itself does — mentioned in the
  author's `new-version.md` draft as a further-out idea, not part of this slice.
- Sessions surviving the app being closed (daemon/reconnect model) — ruled out in §2.4.
- Rewriting `docs/explanation/prd.md` — flagged as stale and in need of a follow-up revision, but
  that revision is a separate piece of work from this design.
