# Embedded Browser in Sessions — Design

- **Date:** 2026-09-19
- **Status:** Design approved by author in brainstorming; spec pending author review.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** A browser embedded inside a session's `SessionPanel` — usable both for manual
  navigation by the user and, via a per-session MCP server, as a tool the running `claude` CLI
  process can drive directly. Not the app-wide HTML live-preview feature
  (`docs/superpowers/specs/2026-09-05-html-live-preview-design.md`), which stays a separate,
  already-delivered concern.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

"Canal" in the originating request ("preciso de um browser integrado ao app e ao canal") means the
session with a harness — the `SessionPanel` where the user talks to a `claude` CLI process running
in a PTY (`docs/reference/architecture.md#session-bounded-context`). The ask is a browser that
serves two purposes at once, not two separate features:

1. **Manual navigation** — a browser pane next to the terminal so the user can open docs, PRs, etc.
   without leaving the app while a session is live.
2. **Agent-driven automation** — the running `claude` CLI itself gets a tool to navigate, click,
   type, and screenshot inside that same pane, the way `claude-in-chrome` lets a session drive a
   real Chrome tab — except embedded in the app instead of a separate Chrome window/extension.

Both hands are on the same wheel: manual navigation and agent automation act on the *same* page,
not a mirrored copy of it.

Today the app has no navigable browser anywhere. The nearest existing thing,
`companion-file://` + `srcdoc` iframe HTML preview, is a sandboxed read-only render of a local
file's *draft* content — not a real, navigable web page, and out of scope here by the author's
explicit call during brainstorming.

## 2. Decisions made during brainstorming

1. **Scope is per-session, not a new top-level app area.** The browser lives inside `SessionPanel`,
   one `WebContentsView` per session that opts in — not shared across sessions, not a standalone
   "Browser" area in the main navigation. Rejected during Q&A: a browser tied to an external
   communication channel (Slack/Discord-style) — not what "canal" meant here.
2. **Approach: Playwright MCP attached to the embedded view's own CDP session**, over two rejected
   alternatives:
   - *A hand-rolled MCP server driving `webContents.executeJavaScript` directly.* Full control, no
     new heavyweight dependency, but reinvents (worse) what Playwright already does well —
     selector-based clicking without Playwright's actionability checks (auto-wait, scroll-into-view)
     is more brittle, and it's more code to build and maintain for a feature whose whole point is
     reliability. Rejected: disproportionate build cost for a worse result.
   - *Manual browser only, agent automation deferred.* Smaller and faster to ship, but the author
     explicitly asked for both manual and agent-driven use in the same feature — cutting the agent
     half would be scope-cutting an explicit requirement, not a real alternative.
3. **CDP isolation trade-off: accepted as-is, documented, not engineered around.** Validated via
   research (not assumption) that `@playwright/mcp`'s `--cdp-endpoint` attaches to the **whole
   browser instance**, not a single page/target — matching how Electron's own
   `--remote-debugging-port` works (the same mechanism Playwright's own `_electron.launch()` test
   helper uses to enumerate every `BrowserWindow` as a page). Consequence: while a session's browser
   tool is active, the debug port technically exposes every window in the Electron app — including
   the app's own control UI — not just the one embedded view. Two resolutions were on the table:
   - *Fully separate Chromium process*, isolating the agent from the app's UI for real, at the cost
     of hand-rolling window docking/resizing to visually track the session panel across platforms.
   - *Accept it, same-process, documented.* The author chose this: the same trust boundary already
     exists today (a session already runs arbitrary shell commands via the PTY), so this is an
     incremental, not a new, category of exposure. No engineering effort spent narrowing it in this
     delivery.
4. **The agent's MCP config is ephemeral and per-session, not routed through the existing
   `McpService`/`.mcp.json` plumbing.** That plumbing persists the user's own long-lived,
   global/project-scoped servers; writing a browser-tool entry there would leak into the user's own
   `.mcp.json` (polluting a committed file in the `project-shared` case) and can't express a value
   that changes every spawn (the CDP port). Instead the `claude` CLI's existing (currently unused in
   this codebase) `--mcp-config <path>` flag points at a small JSON file generated fresh per session.
5. **New dependency: `@playwright/mcp`, pinned as a real `dependency`** (not invoked via `npx` at
   spawn time). Rejected: always-`npx`-latest, which breaks offline use and reproducibility for a
   feature that runs as a child process of a desktop app.

## 3. Architecture and data flow

```
SessionPanel (per session)
 ├─ xterm terminal (existing)
 └─ BrowserPane (new) ── WebContentsView ── URL bar (manual navigation)
                              │
                              ├─ webContents.debugger.attach('1.3')
                              │     (Electron app-wide --remote-debugging-port, localhost only)
                              │
                              └─ @playwright/mcp child process
                                    --cdp-endpoint=ws://127.0.0.1:<port>/...
                                        │
                                    referenced by an ephemeral --mcp-config
                                    passed to the session's `claude` CLI spawn
```

Manual navigation (URL bar → `WebContentsView.loadURL`) and agent tool calls (via the MCP server →
CDP → the same `WebContentsView`) both act on one page. Neither is a proxy or a mirror of the other.

## 4. New pieces — main process

- **`src/main/infrastructure/browser/embedded-browser-adapter.ts`** — owns the `WebContentsView`
  lifecycle per session: create/destroy, debugger attach/detach, and spawning/killing the
  `@playwright/mcp` child process. One instance per session that has the browser enabled; torn down
  whenever the session is (matching how `NodePtySessionAdapter` already ties a PTY's lifetime to its
  `sessionId`).
- **`ClaudeSessionSpawnOptions` (`claude-session-port.ts`) gains `mcpConfigPath?: string`.**
  `NodePtySessionAdapter.spawnWithArgs` appends `--mcp-config <path>` to the CLI args when present —
  additive to whatever MCP servers the user's own project/global config already declares, never a
  replacement for them.
- **`SessionService` gains a per-session `browserEnabled` toggle** (in-memory only, like the rest of
  live session state — not persisted to disk). Enabling it before spawn generates the ephemeral
  one-server MCP config JSON — `command` resolved to the pinned `@playwright/mcp` binary in this
  app's own `node_modules/.bin` (never `npx`, per §2.5), `args: ["--cdp-endpoint",
  "ws://127.0.0.1:<port>/..."]` — in a per-session temp file, deleted on
  `session.kill`/`session.remove`.
- **New `browser.*` IPC namespace** (`enable`, `disable`, `navigate`, `status`), following the
  existing `ipc:call` envelope and `_validators.ts` convention.

## 5. New pieces — renderer

- **`src/renderer/components/BrowserPane.tsx`** — URL bar (back/forward/reload/address) plus the
  region a `WebContentsView`'s bounds are synced to, resize-tracked the same way `SessionPanel`
  already keeps the xterm `FitAddon` in sync with its container.
- **`SessionPanel.tsx`** gains a split layout (terminal | browser) when `browserEnabled`, and a
  toggle in `SessionHeader` next to the existing status pill/actions.

## 6. Lifecycle and error handling

| situation | behavior |
|---|---|
| `@playwright/mcp` fails to spawn (binary missing, port in use) | session still starts normally; browser tool absent, with a visible warning — never blocks the session itself |
| user enables "Browser" on an **already-running** session | no hot-swap: the CLI only reads `--mcp-config` at its own startup. Shown as "takes effect on next restart," not applied live |
| `session.kill` / `session.remove` | tears down `WebContentsView`, detaches the debugger, and kills the `@playwright/mcp` child, in that order — no orphaned child process |
| debug port exposure | documented limitation (see §2.4), not mitigated in this delivery |

## 7. Testing

**node project** (`tests/main/**`) — `embedded-browser-adapter` lifecycle (create/destroy,
attach/detach, child process spawn/kill) against fakes; `NodePtySessionAdapter` gains a case
asserting `--mcp-config <path>` is appended only when `mcpConfigPath` is supplied; `SessionService`
generates/cleans up the ephemeral config file correctly and never mutates the user's own
`McpConfigPort`-backed files.

**jsdom project** (`tests/renderer/**`) — `BrowserPane` URL bar wiring; `SessionPanel`'s toggle calls
`browser.enable`/`browser.disable` and is disabled while the call (and the restart it triggers) is in
flight, with its own enabled/disabled state now derived from `browser-tabs-store.ts` rather than local
state (see the addendum below for why). Superseded by the addendum for anything about *where* the browser
renders — see `browser-tabs-store.test.ts` and `WorkspaceScreen.test.tsx`'s `browser` tab-kind cases for
that.

## 8. Out of scope

- A standalone "Browser" area in the app's top-level navigation, independent of any session. **Reversed
  the same day — see the addendum below.**
- Hot-swapping MCP config into an already-running `claude` CLI process. **Reversed the same day** —
  `setBrowserEnabled` now restarts the session in place instead (see `SessionService.setBrowserEnabled`'s
  own doc comment).
- Any change to `claude-in-chrome` or the user's real Chrome — that flow is untouched and unrelated.
- Narrowing the CDP debug-port exposure (separate-process isolation) — noted as a possible future
  delivery if the accepted trade-off in §2.4 turns out to matter in practice.
- The HTML live-preview feature — pre-existing, unrelated, not touched here.

## 9. Addendum — browser tabs in the Workbench (2026-09-19, later the same day)

The per-session-only scope call in §2.1 and the "no standalone Browser area" line in §8 held for about a
day: testing the toggle in the running app, it was unclear it had done anything at all — the pane it
opened was blank until a URL was typed in, easy to miss inside one session's own split panel. The
follow-up ask was for the browser to be reachable globally, not scoped to one session, with "any
integration with browser" (external links the app already opens — `shell.openExternal`, `target="_blank"`
anchors) landing in it automatically instead of the OS's own browser.

Two shapes were tried for "global" before landing on the one described below:

1. A **side panel in `AppShell`**, wrapping every screen, with its own tab strip (`GlobalBrowser.tsx`) —
   built, tested, working, but wrong: the app already has a tab system in its central panel (the Workbench,
   `WorkspaceScreen`'s `OpenTab` union rendered by `WorkbenchCanvas`), and a second, parallel tab strip for
   just one kind of content didn't belong next to it.
2. **Browser tabs as ordinary Workbench tabs** — the shape that shipped. `GlobalBrowser.tsx` and its
   `AppShell` wiring were removed entirely in favor of this.

Kept from the original design: a session's browser is still opt-in per session, still wired to its own
`@playwright/mcp` process over the same app-wide CDP port, still restarts the session in place to apply
(see the "Reversed the same day" note on hot-swapping, above). What changed:

- **`EmbeddedBrowserPort`/`EmbeddedBrowserAdapter` generalized from "one view per session" to a tab
  pool** — `create`/`destroy` unchanged for a session's own tab (`tabId` is its `sessionId`), plus
  `openTab`/`closeTab` for a manual tab (no session, no MCP config). No "active tab" concept on the
  main-process side at all, in the end: positioning is purely a function of each tab's own `setBounds`
  calls, and exactly one tab is ever actually shown because of how the Workbench already renders tab
  content (see the next point) — an earlier `setActiveTab` method, explicitly zeroing whichever tab
  used to be active, turned out to be unnecessary and was removed again.
- **Presentation: Workbench tabs, not a separate panel.** `WorkspaceScreen`'s `OpenTab` union gained a
  `{ kind: 'browser'; tabId: string }` case, rendering `<BrowserPane tabId={tab.tabId} />` with a live
  label (the tab's current url, tracked in `browser-tabs-store.ts`). `WorkbenchCanvas` already keeps
  every open tab mounted and toggles visibility with CSS (`display: none` for every tab but the active
  one) rather than mounting/unmounting — a `BrowserPane`'s `ResizeObserver` reports zero bounds the
  moment its own tab goes `display: none` (a `WebContentsView` at zero size *is* the correct hidden
  state, unlike `SessionPanel`'s xterm case, which needs an explicit `visible` prop because a zero-size
  terminal is destructive, not just hidden). `SessionPanel`'s own toggle still calls
  `browser.enable`/`browser.disable`, but now opens (or forgets) this session's own Workbench tab through
  a registered-opener callback (`registerBrowserWorkbenchOpener`, the same pattern `workspace-area-store.ts`
  already uses for `TopNav`'s Diagnóstico pill) instead of rendering `BrowserPane` inline — which is what
  actually fixed the "did that do anything?" problem: the click now visibly opens (and focuses) a real
  tab, not an empty pane sharing screen space with the terminal.
- **A session's browser can now also be turned off from its own tab's close button**, not just
  `SessionPanel`'s toggle — every Workbench tab is closable the same way, and a browser tab is no
  exception. `browser-tabs-store.ts`'s `closeBrowserTab` routes a session tab's close through
  `browser.disable` (clearing `SessionService`'s own `browserMcpConfigPaths` entry, not just the view) and
  a manual tab's through `browser.closeTab`. Consequence: `SessionPanel`'s `browserEnabled` is no longer
  local state set once by its own toggle — it's derived from the shared store on every render
  (`browserTabs.some((tab) => tab.tabId === sessionId)`), so the toggle's color/tooltip stay correct even
  when the tab was closed out from under it.
- **External links redirected.** Every `target="_blank"` anchor in the app (`MarketplaceList`,
  `MarketplaceDetail`, `AppFooter`'s brand link) now opens a manual tab in the integrated browser instead
  of the OS browser. The app's one `shell.openExternal` call site — the MCP re-auth trampoline
  (`McpService.authenticate` → the `claude.ai` connectors OAuth page) — was deliberately left alone: the
  embedded view has none of the user's existing OS-browser session/cookies and would likely force a fresh
  login.
- **Still out of scope:** narrowing the CDP debug-port exposure (§2.4, unchanged) and any change to
  `claude-in-chrome` or the user's real Chrome.
