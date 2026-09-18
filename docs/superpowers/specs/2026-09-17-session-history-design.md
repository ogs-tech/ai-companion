# Session History with Cost, and Shift+Enter in the Terminal — Design

- **Date:** 2026-09-17
- **Status:** Design approved by author in brainstorming; spec pending author review.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Two deliverables. (1) `Shift+Enter` inserts a newline in the session terminal instead of
  submitting the message. (2) A session history — past sessions, scoped to the current project by
  default, each with its estimated cost — surfaced in the right-hand Control Panel and in a
  `Histórico` Workbench tab that carries a spend dashboard and a filterable listing.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

The app's "chat" is not a chat widget: `SessionPanel` (`SessionPanel.tsx:88`) mounts an `xterm.js`
terminal wired to a real PTY running the user's local `claude` CLI
(`NodePtySessionAdapter`). Every keystroke becomes bytes through `terminal.onData`
(`SessionPanel.tsx:152`); every byte of output comes back over the `session:output` push channel.
That single fact shapes both requirements.

**Requirement 1 — Shift+Enter.** There is no React `<textarea>` to intercept. `xterm.js` emits `\r`
for `Enter` and `\r` for `Shift+Enter` alike, so the CLI cannot tell them apart and submits on both.
This is not a bug in `claude`.

**Requirement 2 — history and cost.** `SessionService` keeps sessions in a `Map` in memory
(`session-service.ts:32`), never persisted; closing the app loses everything. The PTY stream is raw
ANSI, so there is no structured message from which to sum tokens. But the `claude` CLI **already**
persists every conversation as JSON Lines under `~/.claude/projects/<slug>/<sessionId>.jsonl`, and
each assistant line carries `message.model` plus a full `usage` object
(`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and a
`timestamp`, `cwd` and `gitBranch`. History is therefore a **read** problem, not a persistence one.

## 2. Decisions made during brainstorming

1. **Scope: current project by default, everything behind a filter.** The Control Panel shows the
   active scope's sessions; the `Histórico` tab opens with a `Só este projeto` filter already on, and
   turning it off reveals every project on the machine.
2. **Opening a past session resumes it for real** (`claude --resume <id>`), rather than rendering a
   read-only transcript. Reading the conversation and exporting it were considered and left out
   (§11).
3. **Row layout: two lines, infinite scroll, page size 10.** Chosen over a single-line row because
   the user wants model, duration and tokens legible without leaving the panel.
4. **The history lives in the existing right-hand Control Panel**, beside today's live sessions —
   not in a new top-level nav area. The dashboard opens as an ordinary Workbench tab.
5. **Cost is computed from a static, versioned price table.** No remote fetch: `CLAUDE.md` states the
   app has no backend, no API and no telemetry.

## 3. Session identity — the foundation

Today `SessionService.spawn` mints `randomUUID()` for `workspace`/`project` anchors
(`session-service.ts:83`) and uses `sessionAnchorKey(anchor)` for `entity` anchors. Neither id is
ever given to the CLI, so the app's session id and the transcript's filename are unrelated.

The CLI accepts `--session-id <uuid>` ("Use a specific session ID for the conversation, must be a
valid UUID") and `-r, --resume [value]` ("Resume a conversation by session ID"). The design adopts
both:

| Mechanism | Decision | Rationale |
|---|---|---|
| `--session-id <uuid>` at spawn | **Adopt** | The transcript is created at `<uuid>.jsonl`, making the join between a live session and its history entry exact rather than heuristic. |
| `--resume <id>` | **Adopt** | Resumes any session by id — live, days old, spawned by the app or started in a plain terminal. |
| `--continue` | **Retire** in the new flow | Already fragile: with several sessions sharing a `cwd` it can attach to a sibling's conversation, as `session-service.ts:139-143` notes. |
| `outputBuffer` replay | **Keep**, reattach only | It is scrollback, not conversation context. |

**Consequence for entity anchors.** `sessionAnchorKey(anchor)` returns `entity:urn:skill:foo`, which
is not a UUID and cannot be passed to `--session-id`. `SessionSnapshot` therefore gains a
`claudeSessionId: string` field (always a UUID, minted at spawn and passed to the CLI) that is
independent of `sessionId` (the app's own key, unchanged). `sessionId` keeps every identity rule it
has today; `claudeSessionId` is the join key to the transcript.

**Not in this change.** `NodePtySessionAdapter`'s `NO_CONVERSATION_MARKER` retry
(`node-pty-session-adapter.ts:130`) becomes dead weight once `--continue` is gone from the spawn
path, but removing it is a refactor and ships as a separate PR (CLAUDE.md: "Keep refactors out of
feature/bug PRs").

## 4. Deliverable 1 — Shift+Enter

`SessionPanel` attaches a custom key handler at terminal creation:

```ts
terminal.attachCustomKeyEventHandler((event) => {
  if (event.type !== 'keydown') return true;
  if (event.key !== 'Enter' || !event.shiftKey) return true;
  if (event.altKey || event.ctrlKey || event.metaKey) return true;
  const id = sessionIdRef.current;
  if (id) void callIpc('session.write', { sessionId: id, data: TERMINAL_NEWLINE_SEQUENCE });
  return false; // xterm must not also emit its own \r
});
```

Two details:

- The handler is installed once, in the terminal-creation effect, but `sessionId` changes over the
  panel's life. It reads from a `sessionIdRef` kept in sync by the existing `sessionId` effect —
  re-attaching the handler on every id change would be the alternative, and is not needed.
- `TERMINAL_NEWLINE_SEQUENCE` is a named constant. The `claude` CLI documents **two** newline
  gestures — `\x1b\r` (Option+Enter) and `\\\r` (backslash + return). Which one a PTY-hosted
  `xterm.js` honors cannot be settled by reading the CLI binary; it is settled by a **five-minute
  spike in the running app** during implementation, and the constant carries a comment recording
  which was chosen and why.

No IPC change, no service change, one file plus its test.

## 5. Deliverable 2 — reading the history

### 5.1 Port

```ts
// src/main/application/ports/session-transcript-port.ts
export interface TranscriptRef {
  claudeSessionId: string;  // the .jsonl basename
  filePath: string;
  cwd: string;              // read from the file's first line, never decoded from the folder name
  modifiedAt: string;       // ISO, from stat().mtime
  sizeBytes: number;
}

export interface TranscriptUsage {
  model: string | null;     // null when no assistant line carried one
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  startedAt: string;
  endedAt: string;
  messageCount: number;
}

export interface SessionTranscriptPort {
  listRefs(): Promise<TranscriptRef[]>;
  readUsage(ref: TranscriptRef): Promise<TranscriptUsage>;
}
```

`listRefs` walks `~/.claude/projects/*/*.jsonl` and returns one ref per file using `stat()` plus a
single first-line read for `cwd`. `readUsage` is the only call that parses a whole file.

**Why `cwd` from inside the file.** The folder name is the `cwd` with separators replaced
(`/Users/…/ai-companion` → `-Users-…-ai-companion`), which is lossy: a real directory containing a
hyphen is indistinguishable from a separator. Every line of the transcript carries the literal `cwd`,
so the folder name is used only as an index and never decoded.

### 5.2 Adapter

`FsClaudeTranscriptAdapter` in `src/main/infrastructure/claude-cli/`, beside
`node-pty-session-adapter.ts`. It owns `node:fs` and `node:os` (for `homedir()`); the service sees
only the port. Transcript lines that fail to parse are skipped, not fatal — a partially written file
during a live session is normal.

### 5.3 Pricing

`src/main/application/pricing/model-pricing.ts` holds a static table (USD per million tokens) and:

```ts
export function estimateCost(model: string | null, usage: TranscriptUsage): number | null;
```

Rates as of 2026-09-17 — input / output, with cache write (5m) at 1.25×, cache write (1h) at 2× and
cache read at 0.1× of the input rate:

| Model | Input | Output |
|---|---|---|
| `claude-opus-5` | $5.00 | $25.00 |
| `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6` | $5.00 | $25.00 |
| `claude-sonnet-5` | $2.00 | $10.00 |
| `claude-sonnet-4-6` | $3.00 | $15.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |
| `claude-fable-5-1`, `claude-fable-5` | $10.00 | $50.00 |

Rules:

- **An unknown model returns `null`, never `0` and never a guess.** The UI renders `—`.
- The table is overridable from Settings; `Settings` gains an optional
  `pricing?: Record<string, ModelRate>` merged over the bundled table.
- The transcript does not distinguish 5-minute from 1-hour cache writes at the top level, but
  `usage.cache_creation` does (`ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`). The
  adapter reads that sub-object when present and falls back to the 5m rate when absent.
- Every surface labels the number **estimado**. It is a reconstruction from tokens, not a bill.

### 5.4 Service

`SessionHistoryService` (`src/main/application/services/`) composes the port, the pricing table and
the aggregation cache:

- `list(query): Promise<SessionHistoryPage>` — filters refs by scope, sorts by `modifiedAt`
  descending, slices the requested page, and calls `readUsage` **only for that page's refs**.
  Pagination is cursor-based, not offset-based: the returned `nextCursor` encodes the last row's
  `modifiedAt` and `claudeSessionId`, and the next call resumes after that pair. Offsets would skip
  or duplicate rows when a live session writes to its transcript mid-scroll and jumps to the top of
  the sort; a cursor anchored to a value cannot. `nextCursor` is `null` at the end of the list.
- `stats(query): Promise<SessionHistoryStats>` — scope total, session count, and per-day totals for
  the chart. Backed by the cache in §6.

### 5.5 Performance shape

Sorting and dating come from `stat()`; only the ten refs on the current page are parsed. With 69
transcripts in this project alone and 20 project folders on disk, this is the difference between
opening the panel instantly and parsing hundreds of megabytes to draw five rows.

## 6. The scope total, and its cache

The paged list is cheap. The footer total (`$31.80` for the project) is not — it needs every
transcript in scope. Aggregates are cached at
`<workspace.rootPath>/.ai-companion/session-cost-cache.json`:

```jsonc
{
  "version": 1,
  "entries": {
    "<filePath>": { "mtimeMs": 1789600000000, "sizeBytes": 481230, "usage": { /* TranscriptUsage */ } }
  }
}
```

A cache entry is valid while `mtimeMs` **and** `sizeBytes` both match the current `stat()`. On first
open the service parses everything once in the background and the footer shows progress; afterwards
only changed files are re-read. The cache holds `TranscriptUsage` (tokens), not dollars, so editing
the price table re-costs instantly without re-parsing anything.

## 7. IPC

New namespace `sessionHistory`, added to `docs/reference/ipc-contract.md`:

| Method | Params | Result |
|---|---|---|
| `sessionHistory.list` | `{ scope: HistoryScope; cursor?: string; limit?: number; filters?: HistoryFilters }` | `SessionHistoryPage` |
| `sessionHistory.stats` | `{ scope: HistoryScope; filters?: HistoryFilters }` | `SessionHistoryStats` |
| `sessionHistory.resume` | `{ claudeSessionId: string }` | `SessionSnapshotWithOutput` |

`HistoryScope` is `{ kind: 'project'; projectId: string } | { kind: 'workspace'; workspaceId: string }
| { kind: 'all' }`. `HistoryFilters` carries `models?: string[]`, `from?: string`, `to?: string`,
`search?: string`. Params are validated with `_validators.ts` helpers in a new
`src/main/ipc/session-history-handlers.ts`; shared types go in `src/shared/session-history.ts`.

`sessionHistory.resume` delegates to `SessionService`, which spawns a PTY with
`--resume <claudeSessionId>` and registers the result as an ordinary session — so a resumed history
entry is indistinguishable from any other live session from that point on.

## 8. Renderer

### 8.1 Control Panel (right aside, 260px)

`SessionsTreeGroup` is revised rather than duplicated. It renders **one list from two sources**:
live sessions from `session.list` (in-memory, `SessionSnapshot`) and past ones from
`sessionHistory.list` (on disk). The two are merged on `claudeSessionId` — a running session has a
transcript on disk *and* an entry in memory, and must appear once, not twice. The in-memory entry
wins on status and label; the transcript contributes model, tokens and cost. A history row with no
in-memory match renders as ended; an in-memory row with no transcript yet (spawned seconds ago,
first response not written) renders with a cost skeleton.

Beyond the merge:

- **Order by time, not name.** Today it sorts with `a.label.localeCompare(b.label)`
  (`SessionsTreeGroup.tsx:50`). Alphabetical order survives three live sessions and collapses at 69.
- **Two-line row.** Line one: session name (left) and cost in `fonts.mono`, right-aligned. Line two:
  model (left), time and duration (right). The two aligned columns replace a `·`-joined metadata
  string and make both scannable down the list.
- **Live sessions keep their 2px `verde` left spine**; ended sessions drop it but keep full text
  contrast, because they are click targets.
- **Secondary text uses `text.secondary` (`#5A6573`) at full opacity, not `#142036` at 55%.** On the
  rail surface `#F2EEE5` the latter measures 3.6:1 and fails WCAG AA; the token measures 5.1:1 and
  passes. At 10px this is legibility, not pedantry.
- **Each row is a real `<button>`** with a visible focus ring; arrows move, Enter resumes.
- **Footer:** scope total with `estimado` beneath it, then `Ver todas as N` opening the tab.

### 8.2 Infinite scroll

`use-session-history.ts` wraps `useInfiniteQuery` with `pageSize: 10`. An empty sentinel element sits
below the last row; an `IntersectionObserver` on it calls `fetchNextPage`. While a page loads, three
skeleton rows occupy exactly the height the real rows will take, so nothing shifts on arrival. The
skeleton does not pulse — this panel is read dozens of times a day and motion there becomes a tic.
The end of the list is a quiet `41 de 41`, not a spinner and not a button.

### 8.3 The `Histórico` tab

An ordinary `WorkbenchTab` (`WorkbenchCanvas.tsx:5`) — `id`, `glyph`, `label`, `render` — so no new
canvas abstraction is needed. A single fixed tab id means `Ver todas` focuses the existing tab rather
than opening a second one.

Because `render: (hidden) => ReactNode` is called for every open tab on every render and visibility
is a `display` toggle rather than mount/unmount (`WorkbenchCanvas.tsx:23`), already-loaded pages and
scroll position survive switching tabs and back.

Contents: the scope total at 40px in `fonts.mono` as the single loud element; a per-day bar chart
where clicking a bar filters the table to that day; filter pills for model, period and
`Só este projeto` (on by default); and the listing built on `EntityDataGrid`, sorted by cost
descending — the question is "what was expensive", so the answer is the first row. Date stays
sortable.

### 8.4 Empty and error states

- **Empty:** "Nenhuma sessão ainda — abra uma com **+** e ela aparece aqui com o custo assim que a
  primeira resposta chegar." An empty panel states the gesture and what follows it.
- **Error:** "Não consegui ler o histórico. A pasta `~/.claude/projects` não respondeu. As sessões
  abertas agora continuam funcionando." plus `Tentar de novo`. It names what failed, where, and what
  still works; a history read failure must not take the live-session list down with it.

## 9. Testing

**node project** (`tests/main/**`):

- `FsClaudeTranscriptAdapter` against a temp `projects/` tree: multi-project listing, `cwd` read from
  the file rather than the folder name (including a directory whose real name contains a hyphen),
  malformed lines skipped, empty file tolerated.
- `model-pricing`: each known model, cache 5m vs 1h rates, unknown model returns `null`, Settings
  override wins over the bundled table.
- `SessionHistoryService`: scope filtering, time ordering, pagination boundaries, `readUsage` called
  only for the current page (asserted against a fake port's call log), cache hit/miss on
  `mtime`/`size` change.
- `session-history-handlers`: validation rejects a malformed scope with `kind: 'validation'`.
- `SessionService`: `--session-id` passed at spawn; `resume` uses `--resume <claudeSessionId>`.

**jsdom project** (`tests/renderer/**`):

- `SessionsTreeGroup`: time ordering replaces alphabetical; two-line row renders model and cost;
  `—` shown for an unpriced model; row is a focusable button and Enter resumes.
- `use-session-history`: sentinel intersection triggers `fetchNextPage`; end-of-list stops fetching.
- `SessionPanel`: `Shift+Enter` writes `TERMINAL_NEWLINE_SEQUENCE` and does **not** write `\r`; plain
  `Enter` is left to xterm untouched.

Coverage thresholds in `vitest.config.ts` (lines/functions/statements 80, branches 70) apply to the
new `application/`, `ipc/`, `infrastructure/` and `renderer/` code.

## 10. Build order

1. Shift+Enter (independent of everything else; ships alone).
2. `claudeSessionId` on `SessionSnapshot`, `--session-id` at spawn, `--resume` in `SessionService`.
3. Port + adapter + pricing, with tests, no UI.
4. `SessionHistoryService` + aggregation cache + IPC.
5. Control Panel revision (ordering, two-line row, infinite scroll, footer).
6. `Histórico` tab (dash + `EntityDataGrid` + filters).

## 11. Out of scope

- **Rendering a past conversation read-only.** The author chose resume over read. The `.jsonl` has
  dozens of line types (`attachment`, `hook_success`, `thinking`, `tool_use`, `queue-operation`,
  `file-history-snapshot`), each needing its own visual treatment — the most expensive part of the
  format, and nothing here blocks adding it later.
- **Exporting a session** to Markdown or JSON, which depends on that parser.
- **Budgets or spend alerts.** The design leaves room (per-day totals already exist) but ships no
  thresholds or notifications.
- **Removing the `NO_CONVERSATION_MARKER` retry** from `NodePtySessionAdapter` — a separate PR.
- **Fetching prices remotely.** Ruled out by `CLAUDE.md`'s no-backend/no-API/no-telemetry rule.

---

## 12. Implementation notes — where the build departed from this design

Added during implementation (2026-09-17). The design above is left as written; this section records what
measuring the actual data changed, and why. Each item is a deliberate decision, not a shortcut.

### 12.1 The CLI already computes the cost — §5.3 and §6 were built on a false premise

Every transcript ends with a `cost-state` line the CLI appends after each turn:

```jsonc
{ "type": "cost-state", "totalCostUSD": 4.4025825, "totalDuration": 1193607, "startTime": 1789520192079,
  "modelUsage": { "claude-opus-5[1m]": { "inputTokens": 192, "outputTokens": 30213,
    "cacheReadInputTokens": 4539109, "cacheCreationInputTokens": 137578, "costUSD": 4.4016195 } },
  "hasUnknownModelCost": false }
```

Present in **143 of 169** transcripts (85%), and — in 47 of 47 files sampled, without exception — it is the
**last line of the file**.

So cost is *read*, not reconstructed. The price table in §5.3 survives as a fallback for the 15% of
transcripts written before the CLI kept this record. `TranscriptUsage` gained `reportedCostUsd`, and every
history row carries a `costSource` of `'reported' | 'estimated' | 'unknown'` so a surface can state which
of the two a number is instead of implying they are the same kind of fact.

One rule added: when `hasUnknownModelCost` is true the CLI's own total is refused, because it is an
undercount by the CLI's own admission — the tokens are kept and the price table gets a try instead.

### 12.2 No `session-cost-cache.json` — §6 is dropped entirely

§6 exists because "the footer total needs every transcript" and parsing was assumed to be expensive.
Measured against the real machine, it is not: **169 conversations summarised in 260 ms**, because the
adapter never reads the middle of a file (§12.3). A versioned on-disk cache with an atomic writer buys a
quarter of a second and brings a whole class of staleness bugs. `SessionHistoryService` keeps an in-memory
map keyed by `mtimeMs` + `sizeBytes` instead, which is enough to stop a `list` and the `stats` beside it
from reading the disk twice.

**This is the largest departure from the design and the one most worth a second opinion.**

### 12.3 Head + tail reads, not "only parse the current page" — §5.5

§5.5's performance strategy was to parse only the ten refs on screen. Unnecessary: the CLI re-appends
`cost-state`, `ai-title` and `last-prompt` every turn, so the last copy of each always trails the file.
Measured across every transcript on a real machine:

| line | max distance from EOF | coverage |
|---|---|---|
| `cost-state` | 915 bytes | 60/60 |
| `ai-title` | 33 KB | 49/49 |
| `last-prompt` | 33 KB | 78/78 |
| `cwd` (from the head) | 5,099 bytes | 169/169 |

A 16 KB head plus a 256 KB tail therefore summarises a 63 MB transcript completely. `readUsage` is cheap
enough to run over the whole scope, which is what made §12.2 possible.

### 12.4 `cwd` is not on the first line — §5.1

§5.1 says `cwd` comes from "the file's first line". It does not: line 1 is often `{"type":"mode",…}`, and
the first `cwd`-bearing line was observed as far in as line 4. The adapter scans the head until it finds
one. The *reasoning* in §5.1 — never decode the folder name, it is lossy — stands and is implemented.

### 12.5 Sessions have titles already — new

The CLI writes `ai-title` (e.g. *"Sessões com dash e filtros"*), `custom-title` and `last-prompt` into the
transcript. 159 of 169 conversations have one. The design assumed a row's name could only come from the
app's own anchor label, which does not exist for a conversation started in a plain terminal. Precedence
implemented: `custom-title` → `ai-title` → first line of `last-prompt` (clipped to 80 chars) → `null`.

### 12.6 Model ids carry suffixes — §5.3

Real ids are `claude-opus-5[1m]` and `claude-haiku-4-5-20251001`, not the bare keys in §5.3's table.
`normalizeModelId` strips the context-window suffix and the release date, neither of which changes a rate.
An id it does not recognize is returned untouched, so an unknown model reads as unknown rather than
near-missing a real rate. A real `<synthetic>` id exists on disk and correctly prices as `null`.

### 12.7 `TERMINAL_NEWLINE_SEQUENCE` is ESC+CR — §4's spike, settled without one

§4 left the choice between ESC+CR and backslash+CR to "a five-minute spike in the running app". It did not
need one: `claude /terminal-setup` writes its own answer into the host terminal's keymap. On this machine,
VS Code's `keybindings.json` carries a `shift+enter` binding whose
`workbench.action.terminal.sendSequence` payload is the two characters ESC and CR.

ESC + CR it is. It also degrades better: an unrecognized ESC+CR does nothing, where an unrecognized
backslash+CR leaves a literal backslash in the message.

The sequence was only half the problem. Claiming the key also requires `event.preventDefault()`:
`attachCustomKeyEventHandler` returning `false` stops xterm's *own* processing but does not cancel the
DOM event, because xterm returns before the `cancel()` its handled path calls. The browser then fires the
legacy `keypress` — which Enter, alone among non-printable keys, still emits — and xterm's `_keyPress`
turns its `charCode` 13 back into a `\r`. The PTY received both `\x1b\r` and `\r`, so the CLI inserted the
newline and submitted in the same breath. Shipped broken and green: the suite mocked `@xterm/xterm` and
called the captured handler directly, which can only ever test the handler's own logic.
`tests/renderer/components/session-panel-key-events.test.tsx` now drives the real terminal and asserts no
`\r` reaches the PTY.

### 12.8 The `--continue` retry was generalized, not left dead — §3 and §11

§3 expected `NodePtySessionAdapter`'s `NO_CONVERSATION_MARKER` retry to become dead weight once
`--continue` was gone, and §11 deferred removing it. It turns out `--resume` has the same failure mode —
the CLI prints `No conversation found with session ID: <id>` and exits 1, sharing the prefix
`No conversation found` with the old message. The retry now covers a real case: a session that exited
before its transcript was written reopens as `--session-id <same uuid>`, keeping the id ↔ transcript join
intact. Nothing was left dead, so nothing needs the follow-up PR §11 anticipated.

### 12.9 Resuming a history entry registers its directory as a project — new

§7 says `sessionHistory.resume` "delegates to `SessionService`… and registers the result as an ordinary
session". An ordinary session needs an anchor, and a conversation from `~/.claude/projects` may have run
anywhere on the machine. `SessionService.adoptConversation` resolves the anchor with
`ProjectService.findOrCreateByPath(cwd)` — so resuming a conversation from an untracked directory
registers that directory as a project. Deliberate: the directory it actually ran in is the only honest
anchor. Worth confirming it is the behaviour wanted.

### 12.10 Nested subagent transcripts are excluded — new

`~/.claude/projects` also contains `<project>/<sessionId>/subagents/agent-*.jsonl` — 231 of 400 files on
this machine. They are not sessions and carry no `cost-state` of their own (their parent's total already
covers them). §5.1's two-level glob excludes them correctly; the adapter reads one directory level only,
and a test pins that.

### 12.11 `Settings.pricing` is optional, not required — §5.3

Making it required broke every existing `Settings` literal for a field nobody sets. It is
`pricing?: Record<string, ModelRateSettings>`, validated strictly when present (finite, non-negative
`input`/`output`, no unknown keys) and absent by default, so `settings.json` stays free of a key nobody
chose. No Settings **UI** for it was built — the spec describes none, and the table is now a fallback path.

### 12.12 The `Histórico` tab loads its rows unpaginated — §8.3

The tab sorts by cost descending and charts spend per day; both are properties of the whole set rather than
of a page, so it uses one capped call (`limit: 500`) rather than `useInfiniteQuery`. The Control Panel list
(§8.2) does page, by cursor, exactly as designed. `EntityDataGrid` has no sorting of its own, so rows are
sorted before being handed to it.

### 12.13 No charting library was added — §8.3

`SpendBarChart` is hand-rolled from `Box`es: one `<button>` per day, clicking one isolates that day in the
table. CLAUDE.md asks that new dependencies be flagged before adding them, and recharts/d3 would be heavier
than the feature they serve.

### 12.14 The adapter does not call `homedir()` — §5.2

§5.2 says `FsClaudeTranscriptAdapter` "owns `node:fs` and `node:os` (for `homedir()`)". Every other adapter
in this codebase receives already-resolved paths from the composition root, and this one follows suit:
`new FsClaudeTranscriptAdapter(join(home, '.claude', 'projects'))` in `src/main/index.ts`. It is also what
makes the adapter testable against a temp tree.
