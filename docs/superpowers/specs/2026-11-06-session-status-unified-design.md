# Unified session status: working, asking, idle, closed

Status: mockups approved phase by phase by the user · builder check pending · Date: 2026-11-06

**The mockups are normative for the UI.** Folder `2026-11-06-session-status-unified-mock/` (open each HTML in a browser): `phase1-states.html`, `phase2-external-notify.html`, `phase3-canvas-customizations.html`, `phase4-answer-cost.html`. Hex values illustrate intent; implement with the tokens in `src/renderer/theme.ts` (the mockups already use the app palette: canvas/paper/rail, azul/verde/ambar). Visual deviations need the user's approval. Frontend-design review was applied: the brief fixed the visual language (the app's own), so no new identity was introduced; shape carries state, colour only reinforces, animations honour `prefers-reduced-motion`.

This extends, and where they conflict supersedes, `2026-11-03-session-attention-states-design.md` (list layout, chips, reason pills stay as approved there) and the "Session status (bug)" section of `2026-11-05-control-panel-customizations-design.md`.

## Intent

The user runs several AI sessions (Claude and Cursor, some inside the app, some in other terminals) and is the bottleneck. They need to know in one glance which sessions are **working**, which are **blocked on them**, which are **idle**, which are **closed**, wherever they are looking: the sessions list, the open session, the editor, the customizations tree, the OS. Today each screen speaks its own dialect (lifecycle `idle|starting|running|exited|error` vs activity `working|idle|needs-input`), the open session's pill sticks on "Iniciando", and sessions started outside the app are invisible.

## Goals

- One vocabulary, four states, one indicator design everywhere: **Trabalhando** (`✻`, green, spins), **Pergunta** (`!`, yellow, pulses), **Ocioso** (`◌`, grey), **Fechado** (`×`, grey). Shape differs per state; colour is never the only cue.
- The state model is performant: event-driven sources, a single main-process store that emits only on real change, one batched IPC event (250 ms window), per-session selectors in the renderer, elapsed time computed client-side. No polling from the renderer.
- Sessions running outside the app are detected and shown with the same states, labelled "externa · <terminal>", with honest precision (measured vs estimated).
- The same state shows up in the editor canvas (tabs, file marks) and the customizations panel (who is using what).
- Optional, off by default: answer a permission prompt from the list.

## Non-goals

- Reverting or undoing a session's file changes from the app (the diff uses the workspace's git, as today).
- Controlling or killing external processes. The app observes them; "Assumir aqui" resumes the conversation in the app only when the external one is idle or closed.
- Answering open questions or any prompt for external or Cursor sessions from the list.
- A fifth state. Rate limit is a detail of Ocioso.
- **Next project, not this one: an MCP server exposed by the app** (open file, selection, who is editing what), reusing the Phase 3 file map. It needs its own spec: new agent-facing security surface (content from files/web is data, not orders).
- Agent View extras (PR/review group, peek, grouping by directory, summaries) and cost/budget enforcement (only notifications).

## Anti-goals

- A yellow "Pergunta" on a session that merely finished its turn. If it cries wolf, the feature is worse than today. When detection is uncertain, degrade to Ocioso or an estimated Trabalhando, never to Pergunta. This holds for Cursor and for external sessions without hooks.
- Colour as the only state carrier.
- Silent edits to the user's own config files (`~/.claude/settings.json`, `~/.cursor/hooks.json`): consent first, reversible, only the entries the app owns.
- One-click approval of something the user could not fully see.

## Constraints (verified in the code)

- `SessionService` already maintains `activity` + `activitySince` + `attention` per session from a hook signal file (`AI_COMPANION_SIGNAL_FILE`, `session-activity.ts`, `session-signal-hooks-installer.ts`) and a Cursor PTY-tail approval detector (`detectCursorApprovalPrompt`). Cursor's `hooks.json` hooks are global but no-ops without that env var. `SessionPanel` still reads only lifecycle status and starts at `'starting'` (the "Iniciando" bug described in the 2026-11-05 spec).
- There is no Cursor equivalent of Claude's `Notification` event (`hook-translation.ts`).
- Hexagonal rule: services depend on ports; file watching, process listing, notifications and Dock badge live in `infrastructure/` behind ports. IPC changes follow `docs/reference/ipc-contract.md` and must update it. No backend, no telemetry.
- Project release gate: lint, typecheck and tests green.

## Phase 1: one state model (foundation)

Mockup: `phase1-states.html`.

- Define one shared type for the four user-facing states, derived from existing `status` + `activity` (Fechado = exited, with reason: ok / error code / interrupted as detail; Ocioso = running with idle or no signal yet; unknown signal never becomes Pergunta). Replace the panel's lifecycle-only pill and fix the stuck "Iniciando" by subscribing to the store instead of a one-shot lookup.
- Surfaces: sessions list rows (order Pergunta, Trabalhando, Ocioso, Fechado; chips from the 2026-11-03 spec), session tabs in the canvas, status bar summary (counts, click filters the list), open-session header (state + current detail + Parar).
- Detail line for Trabalhando: current tool and elapsed turn time (`Edit CartService.ts · 2m14s`). A Trabalhando session with no output for 3 minutes shows an amber "Sem saída há 3 min" note (not a new state). Pergunta shows the reason pill and wait time.
- Performance architecture: sources are events only (hook signal files, PTY tail, JSONL growth). A main-process `ActivityStore` holds one state machine per session and emits only on state or detail change. One batched IPC event per 250 ms window; the renderer keeps a store with per-session selectors so only the changed row re-renders; elapsed time is a client-side timer.

## Phase 2: external sessions and notifications

Mockup: `phase2-external-notify.html`.

- External detection (Claude and Cursor sessions not spawned by the app):
  - Preferred: global hooks. When `AI_COMPANION_SIGNAL_FILE` is absent the hook writes to `~/.ai-companion/signals/external/<session_id>.jsonl` (id from the hook payload); one OS-level watcher (FSEvents) on that directory.
  - Fallback (no hooks installed): watcher on `~/.claude/projects`, reading only the last ~8 KB of a changed transcript; state is **estimated** (e.g. modified in the last 3 s = Trabalhando). Estimated states render with a dashed indicator border and an "estimado" note.
  - Live processes: a `ps` scan every 5 s only while the window is visible and there are candidates, every 30 s when hidden, none if the feature is off. Used for Fechado and for the origin terminal label.
  - Cursor external with no hook: only a live process, shown as Ocioso/estimated, never Pergunta.
- One-time consent banner ("Ver o estado exato de sessões fora do app"): installs signal hooks into `~/.claude/settings.json` and `~/.cursor/hooks.json` through `MergeMaterializer` (owned entries only), removable in Settings; alternative "Só estimado".
- Actions on an external row: **Observar** (read-only live view tailing the transcript, always available) and **Assumir aqui** (resume in the app; enabled only when the external session is idle or closed; never kills the external process).
- Notifications: native notification only on the transition Trabalhando to Pergunta (click opens the session, or Observar for external), Dock badge counting Pergunta only. Settings (defaults): ask notification on, long-turn-finished (over 2 min) off, include external on, silence while that session is focused on, Dock badge on.

## Phase 3: canvas and customizations panel

Mockup: `phase3-canvas-customizations.html`.

- Canvas: file tree marks (green: being edited now, with session name; grey: changed in this turn; amber: conflict with the user's unsaved edits); editor banner on conflict with "Ver o que mudou" and "Salvar mesmo assim" (no locking); after the turn a summary banner (`alterou 3 arquivos, +42 −9`) with "Ver diff" / "Abrir sessão". Source: `tool_input.file_path` from Edit/Write/MultiEdit hook events (external via signal files). No hook means no mark.
- Customizations panel: each skill / agent / MCP shows "N sessões" with a popover listing the sessions and their states; filter chip "Em uso agora". "In use" = invoked in the current turn or the last 10 minutes, read from transcript entries (`Skill`, `Task` subagent, `mcp__server__tool`) through an incremental per-session index. Hooks show "configurado", never "em uso".
- Disabling or editing an in-use customization: inline notice + undo toast, no dialog. Copy says running sessions "podem continuar usando-a até reiniciar" (author's assumption, not verified).
- Signal health item: per harness installed / needs reload (Cursor sessions opened before install report state only after Cursor reloads).
- Rendering: a store map `file → sessions` and `entity → sessions`; the tree subscribes only to visible rows.

## Phase 4: inline answer (opt-in) and cost/context/limit

Mockup: `phase4-answer-cost.html`.

- Inline permission answer, setting **off by default**: the Pergunta row expands to the full command, working directory and the last assistant sentence, with "Permitir uma vez", "Negar", "Abrir sessão". Only app-spawned Claude sessions and only permission prompts. No "Sempre permitir", no "approve oldest" shortcut; Enter acts only on the focused, fully visible row. Mechanism to confirm: Claude's `PermissionRequest` hook returning the decision on the target CLI version (unverified). Cursor/external: not supported.
- Context bar per session (row and header): amber over 70%, red over 90%; Claude from the last assistant message's `usage` (input + cache) over the model window, Cursor estimated and marked "~".
- Cost updates on JSONL growth inside the Phase 1 batch. Optional notifications, default off: cost crossing US$ 5 and US$ 10; context over 90% (on, once per session).
- Rate limit: detail of Ocioso ("Limite de uso · volta em 14 min") from the rate-limit error entry in the transcript, with the return time when present; never Pergunta.

## Phase order (approved)

1 foundation, 2 external + notifications, 3 canvas + customizations, 4 inline answer + cost. Each phase is shippable on its own and should be its own plan/PR.

## Verification gates and dependencies

- **Phase 2 starts with a verification spike**, not a block: confirm with real `claude` and `cursor-agent` sessions started outside the app that the global hooks fire and carry `session_id`, `cwd` and `tool_input.file_path`. Plan the rest with the hypothesis. If the spike fails for a harness, that harness ships as **estimated only** (transcript / process), which the design already supports; the Phase 3 file marks then have no source for it and are simply absent.
- **Phase 4 starts with the same kind of spike** for `PermissionRequest` returning a decision. If it fails, inline answer (G) is dropped from the phase and the rest (context, cost, rate limit) ships unchanged.
- **Phase 3 does not depend on Phase 2.** Plan it for app-spawned sessions first; external sessions feed the same maps when Phase 2's signal files exist.
- **Phase 1 keeps the existing Cursor approval detector** (`detectCursorApprovalPrompt`, already shipped and approved in the 2026-11-03 spec) for in-app Cursor sessions. The false-positive measurement gates only the *new* cases (external, estimated).
- **Hooks installer:** extend `SessionSignalHooksInstaller` (and Claude's equivalent) rather than replace it; no migration of installed entries. The hook command gains the external-write branch, which only records when a consent marker (`~/.ai-companion/signals/external-enabled`) exists, so the already-shipped behavior outside the app stays a no-op until the user accepts the banner. Removing consent deletes the marker and the owned entries.
- **External "Fechado":** the app cannot see the exit code of a process it did not start, so external sessions show "Fechado, motivo desconhecido".
- **Cursor context window:** a fixed model-to-window table maintained in code; unknown model means the bar is hidden (never guessed).

## Left to the builder

- Exact IPC event shape and store location; follow `docs/reference/ipc-contract.md` and update it.
- Whether the activity store extends `SessionService` or is extracted; the state machine must be testable without Electron.
- Per-harness reliability of each source; measure the Cursor false-positive rate for Pergunta before enabling it for external/estimated cases.
- Behavior with user-owned hooks colliding with the injected ones.
- pt-BR wording of all labels, a11y labels (shape + text), persistence of filters (default: not persisted).
- Thresholds above (3 s, 3 min, 8 KB, 5 s/30 s, 250 ms, 70/90%) are starting values; tune with measurements.

## Calls made by the author (not yet confirmed by the user)

- Fechado covers ok, error and interrupted, with the reason as detail.
- "Assumir aqui" only for idle/closed external sessions.
- "Em uso" window of 10 minutes; hooks are "configurado".
- Long-turn notification default off; cost notifications default off; context >90% notification default on.
- Rate limit as detail of Ocioso instead of a fifth state.
- Removal of the "approve oldest" shortcut and of "Sempre permitir" from the inline answer.
- Everything in "Verification gates and dependencies" above (spike-then-decide instead of blocking, installer extended not replaced, consent marker, external Fechado reason, Cursor window table).

## Not verified

Everything visual was checked only in HTML mockups (dark theme only; fonts, real panel density and light theme unchecked). The detection approaches per harness (global hooks for external sessions, `PermissionRequest` decision, Cursor edit events, JSONL `usage`/rate-limit entries) are readings of the code and docs, not reproductions with real sessions; the first task of Phases 2 and 4 is to verify them.

## Success

- With one session blocked, two working and one external idle, the user sees which is which in the list, the tabs, the status bar and the Dock without opening anything, for Claude and Cursor.
- No Pergunta on a session that is merely idle, in any harness or source.
- An external Claude session started in another terminal appears within a few seconds with a correct state.
- Idle CPU stays negligible with 10+ sessions (no renderer polling; watchers and scans per the rules above).
- Lint, typecheck and tests green.
