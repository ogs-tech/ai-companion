# Cursor sessions (`run` capability for the Cursor harness)

Status: approved ("pode implementar direto") · implemented · Date: 2026-11-02

## Intent

Today the app can only open sessions for Claude Code: a real `claude` process in a PTY, plus
read-only history read off its JSONL transcripts. The user also works in Cursor and wants the
same thing for it: open a Cursor Agent session from the app, see it in the same list, reopen it
later. Same behavior as Claude, with a Cursor-specific adapter behind it.

This changes a premise in `docs/explanation/harness-model.md`: Cursor was `manage`-only because
its loop runs inside the GUI. That stays true for the GUI, but the Cursor Agent CLI
(`cursor-agent`, also installed as `agent`) runs the same loop in a terminal, so Cursor gains
`run` too. Update `harness-model.md` and the `HARNESSES` registry accordingly.

## Goals

- Start a Cursor Agent session from "Nova sessão", in a PTY, in the same terminal panel as Claude.
- Resume it later (same `resume` flow as Claude).
- Show it in the sessions list with the harness icon on the model line.
- Read Cursor history (title, created/updated time, folder) read-only.
- Same folder scoping as Claude: one folder runs in it; several run from the helper directory.

## Non-goals

- **Cost, tokens, model and health for Cursor.** The Cursor transcript has no usage data (see
  Findings). A separate spec will define how cost is computed. This work shows "—".
- Per-session `--model` / `--mode` / `--force` flags. Sessions start with the CLI's defaults.
- Driving the Cursor GUI. Only the CLI.
- Changing how Cursor customizations are synced (`manage`, `adapters.cursor`).

## Anti-goals

- A second, parallel session pipeline for Cursor. If Cursor needs its own copy of
  `session-service`, the abstraction is wrong.
- Inventing numbers. Where Cursor gives no data the UI says so ("—"), it never estimates.

## Findings (verified on this machine, 2026-11-02)

- `cursor-agent` 2026.10.22 is installed at `~/.local/bin/cursor-agent`.
- `cursor-agent create-chat` returns a new chat id; `--resume <chatId>` reopens it. This mirrors
  Claude's pre-minted session UUID, so `SessionService`'s "mint id, then start/resume" shape fits.
- `--workspace <path>` and `--add-dir <path>` exist. We still reuse the helper-directory approach
  for multi-folder so both harnesses behave identically.
- Chat metadata: `~/.cursor/chats/<hash>/<chatId>/meta.json` →
  `{ schemaVersion, createdAtMs, updatedAtMs, title, hasConversation, cwd }`.
- Transcripts: `~/.cursor/projects/<folder-slug>/agent-transcripts/<chatId>/<chatId>.jsonl`;
  lines are `{ role, message: { content: [...] } }`. No `usage`, `model` or cost fields.

## Design

### Registry
`src/shared/harness.ts`: `cursor.capabilities` becomes `['manage', 'run']`. A harness is offered
for a new session only when it supports `run`, is enabled in Settings, and (for the CLI check
below) its binary is found. The Settings toggle now gates both `manage` syncing and `run`
for that harness. Update the toggle's label/help text so it says so, and
`docs/how-to/enable-cursor-adapter.md`.

### Session abstraction
Today `SessionService` talks to `SessionRuntimePort` and stores a `conversationId`. Generalize:

- Rename the port to a harness-neutral session-runtime port (spawn / write / resize / kill /
  onData / onExit) with one implementation per harness (`claude-runtime` exists; add a Cursor one
  under `src/main/infrastructure/`). `SessionService` receives a map keyed by `HarnessId`.
- `SessionSnapshot` and the persisted session record gain `harness: HarnessId`, defaulting to
  `'claude'` when absent so existing sessions keep working.
- `conversationId` becomes a harness-neutral conversation id. Keep the persisted field readable
  for old records; do not rewrite them eagerly.
- Starting a Cursor session: run `cursor-agent create-chat`, store the id, then spawn
  `cursor-agent --resume <id>` in the PTY. Resuming reuses the stored id.

### History
A second implementation of the transcript/history port for Cursor, reading `meta.json` and
listing chats whose `cwd` is inside the active scope. It returns the same
`SessionHistoryEntry` shape with `costUsd`, `model` and health absent. Confirm the entry type
allows absent values before touching it; if not, loosen it rather than faking values.

### UI
- `NewSessionDialog` (`src/renderer/components/workspace/NewSessionDialog.tsx`): add a harness
  segmented control above the folders (mockup option A). The control lists only the harnesses
  enabled in Settings (the existing `adapters.<harness>` toggles; Claude is on by default, Cursor
  off). With a single enabled harness the control is hidden and the dialog looks as it does
  today. An enabled harness whose CLI is not found is shown disabled with a short reason. The dialog always opens on Claude; the choice is made per session
  and not remembered. (Remembering the last harness was considered and dropped: it adds a
  settings field for a small convenience. Revisit if switching proves annoying.)
- `SessionRow`: the harness icon (Claude / Cursor marks) goes on the second line, before the
  model, with a "—" cost for Cursor. The same icon appears on terminal tabs.
- Icons: two marks from `simple-icons` as inline paths in `src/renderer/components/HarnessMark.tsx` (no new dependency).
  The Cursor mark uses the theme text color so it works in light and dark. The Claude mark uses
  the brand orange. Check each vendor's brand guidelines before release.
- IPC: `session.spawn` params gain `harness`. Types in `src/shared/`, validation via
  `_validators.ts`, documented in `docs/reference/ipc-contract.md`.

### Detection of the CLI
A small port that answers "is `cursor-agent` runnable" (look it up on `PATH`, plus
`~/.local/bin`). Result is cached for the app session and re-checked when the dialog opens.

## Constraints

- Hexagonal rule: services depend on ports; process spawning and filesystem reads live in
  `infrastructure/`.
- Strict TS flags in the repo (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- Green lint, typecheck and tests before done; renderer changes need jsdom tests, services need
  node tests.
- Keep refactors out of the feature where possible. The port rename and the `harness` field are
  part of the feature; unrelated cleanups are not.

## Left to the builder

- Exact names for the generalized port and conversation id.
- Whether the CLI check lives inside the runtime or as its own port.
- How to read `meta.json` efficiently across many chats (index vs scan).
- Wording of the "CLI not found" message (pt-BR, sentence case).

## Open points (mine to settle unless you say otherwise)

- Behavior when `cursor-agent` is not authenticated: the CLI itself prompts to log in inside the
  PTY. We do not handle login in the app (my call).
