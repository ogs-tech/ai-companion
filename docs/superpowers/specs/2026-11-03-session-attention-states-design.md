# Session attention states in the control panel "Sessões" list

Status: layout approved by the user (mockup H3 final) · detection approach open · Date: 2026-11-03

**The approved mockup is normative for the UI.** `2026-11-03-session-attention-states-mockups.html`
(same folder, open in a browser) shows the three situations below. The implementation must match it;
any visual deviation needs the user's approval. Hex values in the mockup illustrate intent: use the
tokens in `src/renderer/theme.ts` (and `StatusPill` variants where they fit), not literal colours.

## Intent

The control panel's "Sessões" list is ordered by recency and cost. With several sessions running
(Claude and Cursor), the user cannot tell at a glance **which sessions are waiting for them** and
which are simply working. The one thing the user is the bottleneck on, a session blocked on a
question or permission prompt, is invisible until they open each session.

Goal: make the list answer "what is running, and what needs me?" in one look, following the
state model of Claude Code's own Agent View (https://code.claude.com/docs/en/agent-view), applied
to Claude **and** Cursor sessions.

## Goals

- Every live session has one of four states: **needs-input**, **working**, **idle**, **exited**.
- The list is a single flat list ordered by state: needs-input, working, idle, exited
  (recency within a group). Group order is the only "grouping"; there are no section headers.
- A chip row under the "Sessões" title shows counts and filters the list in place.
- Same behavior for Claude and Cursor sessions.

## Non-goals

- Answering from the list. The list only signals; clicking a row opens the session (existing
  behavior) and the user answers there.
- Agent View extras: PR/review group, peek panel, grouping by directory, summaries.
- Changing the full history screen ("Ver as N sessões"), cost display or the "Nova sessão" flow.
- OS notifications or badge counts outside the panel (possible follow-up).

## Anti-goals

- A "needs-input" signal that fires on idle prompts. The yellow state must mean "blocked on a
  question or permission only you can give". If it cries wolf, the feature is worse than today.
- Colour as the only carrier of state (a colour-blind user must still read it).

## Decided with the user

- Needs-input means a question or permission prompt. A session that finished its turn and waits for
  the next prompt is **idle** (dimmed), not needs-input. Matches Agent View.
- Pattern follows Agent View for both harnesses.
- Layout "H3": flat list + counter chips acting as filters, no section headers.
- The state indicator (left of the row) is separate from the harness. The harness is shown as text on
  the row's second line (e.g. `claude · sonnet-5-5`, `cursor · <model>`), not as the left icon.

## Layout

- Header: title "Sessões" and the existing "＋".
- Chip row: `Precisa de você N` · `Trabalhando N` · `Concluídas N`.
  - No chip active (default): the full list, ordered by state.
  - Clicking a chip filters to that state; clicking it again clears the filter.
  - A chip with count 0 is dimmed. The needs-input chip is yellow when N > 0.
- Row, left to right: state indicator, name, second line, cost/time on the right.
  - needs-input: yellow bar and yellow pulsing indicator; second line carries a short reason pill
    (e.g. `Permissão: aws s3 ls`, `Pergunta`) when it can be determined, plus how long it has waited.
  - working: green bar, animated indicator.
  - idle and exited: dimmed, no bar; exited keeps today's look.
  - Second line also shows the harness as text next to the model.
- Footer unchanged: estimated cost and "Ver as N sessões".

### Approved visual spec (from the mockup)

State indicator (leftmost, one per row; shape differs per state so colour is never the only cue):

| State | Indicator | Row treatment |
|---|---|---|
| needs-input | `!`, yellow, pulsing | yellow left bar (3px) + faint yellow row background |
| working | `✻`, green, pulsing | green left bar (3px) |
| idle | `◌`, grey | no bar, row dimmed (~72% opacity) |
| exited | `×`, grey | no bar, row dimmed (~72% opacity) |

Row content:
- Line 1: session name (single line, ellipsis).
- Line 2: `<harness> · <model>` as plain grey text (`claude · sonnet-5-5`, `cursor · gpt-5`); the
  model is omitted when unknown. Idle rows append ` · ociosa`.
  Needs-input rows put the **reason pill** first (`Permissão: <command>`, `Pergunta`), then the harness text.
- Right column, two lines: cost then time. For needs-input the time line reads `espera <duration>`
  (how long it has waited); otherwise the existing relative time. Cursor cost keeps its `~` estimate prefix.

Chips: three, in this order, `Precisa de você N`, `Trabalhando N`, `Concluídas N`.
- Needs-input chip is yellow-outlined when N > 0; it becomes filled (active) when selected.
- An active chip is filled neutral; chips with N = 0 are dimmed to ~40%.
- When filtered by a chip, the list shows only that state's rows (no empty placeholder rows).

The three mockup situations are the acceptance scenarios: default list, needs-input filter active,
and nothing needing the user (needs-input chip dimmed, list unchanged in shape).

The harness is deliberately **not** an icon: an earlier mockup used a harness glyph in the indicator
slot and was rejected because one slot was carrying two meanings.

## Constraints and current state (verified in the code)

- `SessionStatus` is `'running' | 'exited'` (`src/shared/session.ts:3`). There is no activity
  state; the app does not currently know whether a running session is working, idle or blocked.
- The list lives in `src/renderer/components/workspace/ControlPanelContent.tsx` (uses `useSessions`);
  status badge wording is shared via `src/renderer/lib/session-status-pill.ts` with `SessionPanel`.
- Sessions are real CLI processes in a PTY (`node-pty-session-adapter.ts`); Claude and Cursor have
  different transcript/history adapters under `src/main/infrastructure/session-runtime/`.
- Hooks: `hook-translation.ts` maps Claude hook events to Cursor. It covers `UserPromptSubmit`,
  `Stop`, `PreToolUse`, `PostToolUse` etc., but **there is no equivalent for Claude's
  `Notification` event** (the one Claude fires for permission/idle prompts). So hooks alone do not
  give a needs-input signal for Cursor, and probably not cleanly for Claude either without it.
- No backend, no telemetry. Detection must be local to the app.

## Calls made by the author (not yet confirmed by the user)

- The `Concluídas` chip counts **idle + exited** (four states, three chips).
- Within needs-input, order by longest waiting first; within the other groups, most recent first.
- A just-spawned session counts as working until a signal says otherwise.
- The filter is not persisted across restarts.
- Chip labels stay in pt-BR like the rest of the UI.

## Left to the builder

- **How to detect each state, per harness.** This is the main risk and the first thing to
  investigate. Candidates:
  - Claude: hooks the app injects for its own sessions (`Notification`, `Stop`, `UserPromptSubmit`),
    and/or the live JSONL transcript the app already reads.
  - Cursor: the stop / before-submit hooks give working vs idle; a permission prompt may need a
    PTY-output heuristic. Verify what `cursor-agent` actually exposes before choosing.
  - A PTY heuristic (output quiet + known prompt shapes) is the fallback; its false-positive rate must
    be measured against the anti-goal above.
  Prefer the most reliable signal per harness over one uniform mechanism; the shared type below is
  the contract, the detection behind it can differ per harness.
- Where the state lives: extending `SessionSnapshot`, a new field/event over IPC, and the update
  cadence. Follow `docs/reference/ipc-contract.md` and update it.
- Whether a user's own hooks in settings can collide with the injected ones.
- Exact wording/i18n of chip labels and reason pills; a11y (icon shape + text, not colour alone).
- Behavior of an unknown state (detection failed or no signal yet): the builder's call, but it must
  degrade to today's "running" look rather than guess needs-input.

## Success

- With one session blocked on a permission prompt and two working, the user sees which is which
  without opening anything, for both a Claude and a Cursor session.
- No yellow state on a session that is merely idle.
- Lint, typecheck and tests green (project release gate).
