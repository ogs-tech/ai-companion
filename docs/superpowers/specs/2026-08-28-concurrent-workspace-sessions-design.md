# Concurrent Workspace/Project Sessions — Design

- **Date:** 2026-08-28
- **Status:** Design approved by author; pending implementation plan.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Let the "+" in the Sessões panel always start a brand-new `workspace`/`project`-anchored
  session, even while another session for that same anchor is already open, instead of just
  refocusing the one existing tab. `entity`-anchored sessions (the panel embedded in
  `CustomizationEditor`) are unchanged.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

A prior change (this same day, not separately spec'd — a small UI relocation) moved the "Abrir
sessão" action from a header button into a "+" icon in the Sessões panel, reusing the existing
`session.spawn(anchor)` call. Because `session.spawn` is idempotent per anchor (one live session per
`workspace`/`project`, per the 2026-08-21 design's §2.5 default), clicking "+" a second time while a
session was already running just refocused the same tab — visually indistinguishable from doing
nothing. The author's report: *"agr quando ja tenho uma sessão o botão de '+' para de funcionar"*
("+" stops working once a session already exists) and *"deve criar uma sessão nova do zero"* ("+"
should always create a session from scratch).

This is the confirmation flagged in the original spec: *"Not explicitly requested by the author — a
default chosen for simplicity; flag for confirmation if multiple concurrent sessions per
customization turns out to be wanted later."* The answer, scoped to `workspace`/`project` anchors
only: yes, multiple concurrent sessions per anchor are wanted, VS Code-terminal-"+"-style (a new
independent PTY/tab each click, the old one keeps running).

**Superseded:** 2026-08-21 embedded-claude-sessions design, §2.5 ("One active session per
customization") — narrowed. `entity` anchors keep that one-live-session invariant unchanged (the
author confirmed the embedded `CustomizationEditor` panel should not change). `workspace`/`project`
anchors no longer follow it.

## 2. Decisions made during brainstorming

1. **Scope is `workspace`/`project` only.** `entity`-anchored sessions (Skill/Agent/Instruction,
   opened from inside their own editor) keep the exact one-session-per-anchor behavior from the
   2026-08-21 design — no changes to `CustomizationEditor`'s embedded session panel, its reattach
   logic, or its single-slot semantics. The blast radius of this change is deliberately kept to the
   Sessões panel's "+" and the Workbench tabs it opens.
2. **"+" always creates, never refocuses.** Coexistence, not replacement: clicking "+" while a
   session is already running for that workspace/project does not kill it — a second, fully
   independent PTY spawns alongside it, its own row in the Sessões list, its own Workbench tab.
3. **No AI-generated session title.** Investigated during brainstorming: no file on disk
   (`~/.claude/projects/**/*.jsonl`, `~/.claude.json`, `~/.claude/history.jsonl`) reliably carries a
   persisted, per-session AI-generated title the app could read. `lastSessionFirstPrompt` in
   `~/.claude.json` only tracks the *last* session per project directory, not a per-session field;
   `isCompactSummary` entries only exist for conversations long enough to trigger auto-compaction.
   Pulling a real title would require capturing the `claude` CLI's own internal session id at spawn
   time, locating its transcript file, and reading the first user message — a separate piece of work,
   explicitly deferred (see §7).
4. **Labeling: numbered, computed at spawn time.** The first session for an anchor keeps its plain
   name ("Acme"); subsequent ones get a suffix ("Acme (2)", "Acme (3)"). The ordinal is a
   monotonically increasing per-anchor counter in `SessionService` — it is never reused, even after
   the session holding a given number is removed, so a number always identifies the same session for
   as long as anyone might remember it.
5. **Resume-by-click, not a separate button.** Clicking an *exited* row in the Sessões list resumes
   it (equivalent to today's `session.spawn` idempotent-restart, now addressed by `sessionId` — see
   §3) and opens/focuses its tab in one action; clicking a *running* row just opens/focuses. The
   dedicated hover-only "Retomar" row action is removed as redundant — the row click **is** resume
   now, for every anchor kind (entity included, since the underlying behavior is unchanged for
   `entity`, only the call shape changes).

## 3. Architecture

No new bounded context, no new dependency — this reshapes identity and call shapes inside the
existing `session` context (`src/main/application/services/session-service.ts`,
`src/main/ipc/session-handlers.ts`, `src/shared/session.ts`), plus the renderer components that
assume "one session per anchor" as an identity invariant.

- **Session identity (`session-service.ts`).** Today `sessionId` is always `sessionAnchorKey(anchor)`
  — deterministic, one slot per anchor, for every kind. That invariant is now **kind-conditional**:
  - `entity` anchors: unchanged. `sessionId = sessionAnchorKey(anchor)`; `spawn` still dedupes
    against a running session and still resumes an exited one in place.
  - `workspace`/`project` anchors: `spawn` always mints a fresh `sessionId` (`crypto.randomUUID()`)
    and always starts a new PTY — no existing-session lookup, no in-flight-spawn dedupe by anchor
    (each call already owns its own id, so there is nothing to collide with).
  - `SessionSnapshot.anchor` keeps carrying the anchor on every entry regardless of kind, so
    "everything for this anchor" is still a simple filter over `list()` — multiple entries can now
    share one `anchor` for `workspace`/`project`.
- **Per-anchor ordinal counter.** A new private `Map<string, number>` in `SessionService`, keyed by
  `sessionAnchorKey(anchor)`, incremented once per `workspace`/`project` spawn (not touched for
  `entity`, which never needs a suffix). `resolveAnchor`'s returned `label` becomes `name` for
  ordinal 1, `${name} (${ordinal})` after — computed once at spawn time and stored on the
  `SessionSnapshot`, same as today's plain label.
- **New IPC verb: `session.resume`.** `{ sessionId: string } → SessionSnapshotWithOutput`. Restarts
  the PTY for one specific, already-known session id in place (must currently be `exited`; a
  currently-`running` id is returned as-is, idempotently, same guard `spawn` already uses). Backing
  method `SessionService.resume(sessionId)` looks up the existing snapshot (kind-agnostic — it works
  identically whether that entry's anchor is `entity`, `workspace`, or `project`, since it operates
  purely on the stored `anchor`/`cwd` of that one entry) and relaunches through the same internal
  spawn-a-pty logic `spawn` already uses, keeping the same `sessionId` **and** the same stored
  `label` — resume never runs the ordinal-increment step from §2.4, since it restarts an existing
  session rather than minting a new slot. Unknown `sessionId` → the
  `not_found` `DomainError` kind, consistent with `session.spawn`'s existing `not_found` for an
  unresolvable anchor target (see `docs/reference/ipc-contract.md`'s current session section).
  `session.spawn`'s own shape/behavior for `entity` is untouched by adding this verb.
- **Tab identity (`WorkspaceScreen.tsx`).** The Workbench tab id changes from
  `session:${sessionAnchorKey(anchor)}` to `session:${sessionId}`. For `entity` this is a no-op
  (`sessionId` already equals `sessionAnchorKey(anchor)` there), so no existing entity tab changes
  identity. For `workspace`/`project`, this is what actually allows more than one tab to exist for
  the same anchor. `openSessionTab` takes the concrete `sessionId` (from a `spawn`/`resume` response,
  or from an existing `SessionSnapshot` row) instead of deriving one from `anchor`.
- **`SessionPanel.tsx`.** Gains an optional `sessionId` prop.
  - Present (every tab opened from the Workbench, any anchor kind): the panel attaches directly to
    that known id via `session.status(sessionId)` — no anchor-keyed reattach lookup, no idle
    "Abrir sessão" first-click state, since by construction the caller already has a live or
    resumed session by the time the tab opens. Its own inline "Retomar" button (shown once the
    session exits while the tab is open) calls `session.resume(sessionId)` instead of
    `session.spawn(anchor)`.
  - Absent (unchanged `CustomizationEditor` usage): today's full behavior — mount-time reattach by
    `sessionAnchorKey(anchor)`, idle state, `session.spawn(anchor)` on the inline "Abrir sessão"
    click.
- **`SessionsTreeGroup.tsx`.** One row per `SessionSnapshot` as today (already keyed by `sessionId`,
  so nothing structural changes there — there are just more rows sharing an `anchor` now). Row click
  merges what were two separate code paths (`onOpen` / `handleResume`) into one: `exited` → call
  `session.resume(sessionId)`, invalidate, then open/focus the tab; `running` → open/focus directly,
  no network call. The hover-only "Retomar" icon action is deleted (see §2.5); "Encerrar" (running)
  and "Apagar" (always) are unchanged.
- **`useSessionStatus` / `SessionStatusBadge`.** Currently exact-matches `session.sessionId ===
  sessionAnchorKey(anchor)`. Changes to matching **any** entry whose `sessionAnchorKey(entry.anchor)
  === sessionAnchorKey(anchor)`, reduced to one aggregate status: `running` if any match is running,
  else `exited` if any match exists, else `undefined` (no badge). For `entity`, where there is still
  at most one match, this is behaviorally identical to today's exact check — the change is only
  observable for `workspace`/`project` anchors, which is exactly where `WorkspaceManagementList` and
  `FolderTree` use this badge today.

## 4. Data flow

**"+" in the Sessões panel (workspace or project anchor):**

1. Renderer calls `callIpc('session.spawn', { anchor })`.
2. `SessionService.spawn` sees a `workspace`/`project` anchor → mints a fresh `sessionId`, bumps that
   anchor's ordinal counter, resolves `cwd`/base label via the existing `resolveAnchor`, computes the
   final label (§2.4), spawns the PTY, stores the new `SessionSnapshot`, returns it with its (empty)
   `outputBuffer`.
3. `WorkspaceScreen` opens a new Workbench tab keyed `session:${sessionId}`, rendering
   `<SessionPanel anchor={anchor} sessionId={sessionId} />` — already attached, already streaming,
   no idle state shown.

**Clicking a row in the Sessões list:**

1. `running` row → `onOpen` opens/focuses `session:${sessionId}` directly; no IPC call.
2. `exited` row → `callIpc('session.resume', { sessionId })` → `SessionService.resume` relaunches the
   PTY under that same id → renderer invalidates `session.list`'s query cache → opens/focuses
   `session:${sessionId}`, now attached to the freshly-relaunched process.

**Entity sessions (`CustomizationEditor`):** unchanged from the 2026-08-21 design — first click on
"Abrir sessão" calls `session.spawn(anchor)`, which behaves exactly as it does today for `entity`.

## 5. Error handling

- `session.resume` on an unknown `sessionId` → `not_found` `DomainError`, surfaced through the
  existing dispatcher mapping — same shape as `session.spawn`'s existing `not_found` case, so no new
  renderer-side error handling pattern is needed.
- `session.resume` on a `sessionId` that is currently `running` is a no-op that returns the existing
  snapshot (matches `session.spawn`'s existing idempotent-while-running guard) — covers a
  double-click on a row between "exited" render and the resume call landing.
- Everything else — spawn failures surfaced as `io`, writes/kills/removes on unknown ids silently
  no-op — is unchanged from the current contract.

## 6. Testing

- `tests/main/application/services/session-service.test.ts` — new coverage: two `spawn` calls for
  the same `workspace`/`project` anchor produce two distinct `sessionId`s and both appear in `list()`
  simultaneously; the ordinal counter and its label suffix; `resume(sessionId)` restarting a specific
  exited entry in place, `not_found` for an unknown id, idempotent no-op while running; `entity`
  spawn/resume behavior asserted unchanged (regression coverage, not new behavior).
- `tests/main/ipc/session-handlers.test.ts` — the new `session.resume` handler's param validation and
  `DomainError` → `IpcError` mapping, following the existing per-method test shape in that file.
- `tests/renderer/components/session-panel.test.tsx` — the new `sessionId`-present code path
  (attaches directly, no idle state, inline "Retomar" calls `session.resume`) alongside the existing
  `sessionId`-absent (`entity`) coverage, unchanged.
- `tests/renderer/components/workspace/SessionsTreeGroup.test.tsx` — row click on an exited session
  calls `session.resume` then opens the tab; row click on a running session opens the tab with no IPC
  call; the "Retomar" icon's removal (assert it's gone, not just untested).
- `tests/renderer/screens/workspace/WorkspaceScreen.test.tsx` — clicking "+" twice in a row produces
  two distinct Workbench tabs (regression test for the exact bug reported); tab id keyed by
  `sessionId`.
- `tests/renderer/hooks/use-sessions.test.tsx` / `SessionStatusBadge.test.tsx` — aggregate-by-anchor
  status matching, including the "one running + one exited for the same anchor → shows running" case.
- `docs/reference/ipc-contract.md` — update the session section: the new `session.resume` row in the
  method table, the kind-conditional identity rule replacing today's blanket "one live session per
  anchor key" sentence, and the ordinal-suffix label rule.

## 7. Explicitly out of scope (for this spec)

- Pulling a real, AI-generated session title from the `claude` CLI's own transcript — investigated
  and deferred, see §2.3. A real follow-up would need to capture `claude`'s internal session id at
  spawn time and read its `.jsonl` transcript, which is its own separate piece of work.
- Extending multi-session (coexisting, not one-per-anchor) behavior to `entity` anchors — explicitly
  ruled out during brainstorming (§2.1); the embedded `CustomizationEditor` panel is unchanged.
- A cap on how many concurrent sessions one anchor can have — not raised during brainstorming, no
  cap is being added.
