# Route links opened by a session's CLI to the embedded browser — design

## Intent

Clicking a URL in a session's terminal opens it in the embedded browser (`src/renderer/lib/terminal-links.ts`). But when the `claude` CLI itself decides to show a link — `/login`, an MCP OAuth flow, a tool that opens a page — it runs the OS opener (`open <url>` on macOS) as a subprocess. That never touches xterm, so the URL lands in the user's default browser (Chrome) instead of the app's embedded one.

The PTY inherits the app's `process.env` untouched (`node-pty-session-adapter.ts:102`), so nothing in the process tree points at the app.

## Goals

- A URL the CLI opens on its own appears as a tab in the embedded browser, with the same `http(s)`-only rule the terminal links already enforce.
- No new runtime dependency.
- If the routing channel is unavailable, the link still opens (in the default browser) — never swallowed.

## Non-goals

- Links opened by processes outside an app-spawned PTY (the user's own terminal, other apps).
- Launch-config processes (`LaunchProcessPanel`) in v1 — they inherit nothing from the session spawn path; revisit if a dev server's "open browser" step shows the same behavior.
- Replacing `shell.openExternal` in `mcp-service.ts:81` (opens claude.ai connectors on purpose, in the real browser).
- Any change to the Playwright MCP / CDP browser tool (agent *driving* a page is a separate path).

## Open question that gates the design — spike first

How the CLI opens a URL decides which hook works. **Not yet verified:**

- **A. It honors `$BROWSER`.** Then exporting `BROWSER=<shim>` in the PTY env is enough.
- **B. It calls `/usr/bin/open` (or the `open` npm package, which does not read `$BROWSER`).** Then the hook has to be a `PATH` shim named `open`, prepended to the PTY's `PATH`.

**Spike (≤ 30 min, throwaway):** spawn a PTY with `BROWSER=/tmp/spy` *and* a `PATH` whose first entry holds an executable `open` that both append `argv` to a log, then trigger `/login` and an MCP auth. Whichever log fills decides A, B, or both. Record the result in this file before implementing.

## Design

### 1. Shim

An app-owned executable script, written at startup to `~/.ai-companion/bin/` (new subdir; document in `reference/on-disk-layout.md`), mode `0755`:

```sh
#!/bin/sh
# Forward the first http(s) URL to the app; fall back to the real opener.
url="$1"
case "$url" in http://*|https://*) ;; *) exec /usr/bin/open "$@" ;; esac
printf '%s\n' "$url" | /usr/bin/nc -U "$AI_COMPANION_LINK_SOCKET" 2>/dev/null \
  || exec /usr/bin/open "$@"
```

- Non-`http(s)` arguments (files, `x-apple.*`, app launches) go straight to the real `open` — the shim must not break `open -a`, `open file.pdf` etc. when installed as a `PATH` shim (variant B). In variant B, the shim also passes through any invocation with flags (`-a`, `-b`, `-R`, …).
- The `|| exec /usr/bin/open` fallback covers a dead socket, so a link is never lost.
- Rewritten on every start (idempotent; content is static).

### 2. Channel: Unix domain socket

- Main process listens on `~/.ai-companion/run/link.sock` (`node:net`, file mode `0600`, stale socket unlinked on start). The directory is user-private, so no token is needed (same trust boundary as the PTY itself).
- Chosen over a localhost HTTP server (port management, token, reachable by any local process/browser) and over a custom `ai-companion://` URL scheme (`setAsDefaultProtocolClient` is unreliable in dev builds).
- Each line received is a URL. Main validates `^https?://i`, length cap (8 KB), and ignores the rest. A burst limit (e.g. 5 URLs/s) guards against a runaway loop.

### 3. Env wiring

In `node-pty-session-adapter.ts` spawn, replace `env: process.env` with `process.env` plus:

- `AI_COMPANION_LINK_SOCKET=<sock path>`
- variant A: `BROWSER=<shim path>`
- variant B: `PATH=<bin dir>:<existing PATH>`

The env is built by an injected `buildSessionEnv()` (port-side: the adapter receives it as a constructor option) so the infrastructure class stays free of path knowledge, matching the hexagonal rule.

### 4. Main → renderer delivery

`openManualTab` is renderer state (`browser-tabs-store.ts`), so main cannot call it. Add one push channel following the existing pattern (`SESSION_OUTPUT_CHANNEL` etc.):

- `src/shared/` : `EXTERNAL_LINK_CHANNEL = 'external-link:open'`, payload `{ url: string }`.
- `src/preload/index.ts`: `onExternalLink(listener)` with the same `wrapped` + unsubscribe shape as its neighbors.
- Renderer: one subscription at the shell level (not per `SessionPanel`) calling `openManualTab(url)`.
- If no window is open, main falls back to `shell.openExternal(url)` through `ShellPort` — never drop the link.

### 5. Session-scoped or global?

The socket is app-global in v1: the URL opens as a manual tab regardless of which session produced it. Per-session attribution (focus the originating session's workbench) would need one socket path per session; deferred, no current requirement.

## Components

| Layer | Change |
|---|---|
| `shared/` | `EXTERNAL_LINK_CHANNEL`, payload type |
| `main/application/ports/` | `LinkRoutingPort` (`start()`, `onUrl(listener)`, `shimEnv()`) |
| `main/infrastructure/link-routing/` | `UnixSocketLinkRouter` (server, shim writer); unit-testable with a temp dir |
| `main/infrastructure/claude-cli/node-pty-session-adapter.ts` | accept `buildSessionEnv`, use it at the `ptySpawn` call |
| `main/index.ts` | wire router → `webContents.send` / `ShellPort` fallback |
| `preload/index.ts` | `onExternalLink` |
| `renderer/` | shell-level subscription → `openManualTab` |
| `docs/` | `reference/on-disk-layout.md` (`bin/`, `run/`), `reference/architecture.md` (new port), `how-to/run-and-review-sessions.md` (behavior note) |

## Errors and edge cases

- Socket cannot be created (permissions, path > 104 chars on macOS): log once, spawn the PTY without the env hook; links keep going to the default browser. Path length is a real risk — `~/.ai-companion/run/link.sock` is short, but a long `$HOME` is possible; fall back to `os.tmpdir()` with a per-user subdir.
- Non-`http(s)` or oversize payload: dropped silently in main (the shim already filtered the common case).
- App not running / socket stale: `nc` fails, shim falls back to `/usr/bin/open`.
- `nc` missing: macOS ships `/usr/bin/nc` with `-U`; if absent the `||` fallback triggers. macOS only in v1 (the app already assumes macOS in places — Numbers conversion).
- Variant B only: shim shadows `open` for *every* process in the PTY, including user commands typed in the session. Pass-through for anything that is not a bare `http(s)` URL is therefore mandatory, and is the main regression risk.

## Testing

- `UnixSocketLinkRouter`: real socket in a temp dir — accepts `https://…`, rejects `file:///…`, `javascript:`, oversize, and rate-bursts; removes a stale socket; recreates the shim idempotently with mode `0755`.
- Shim script: spawn it with a fake socket server and with no server; assert forward vs. fallback (inject the fallback binary path through an env var so the test never opens a real browser). Variant B: assert `open -a Foo`, `open file.txt` and `open --help` are passed through untouched.
- `node-pty-session-adapter`: the spawn env contains `AI_COMPANION_LINK_SOCKET` (+ `BROWSER`/`PATH` per variant) and still contains the inherited env.
- Renderer: the shell subscription calls `openManualTab` with the URL and unsubscribes on unmount.
- Manual: `/login` and an MCP auth in a real session open a tab, not Chrome; with the app's socket removed, they open in Chrome.

## Risks

- **Undocumented CLI behavior:** which opener the CLI uses may change between releases (the same class of risk as the Cursor plugin-shaped hack). Keep the shim and env builder isolated in one module so swapping A↔B is a one-file change, and keep the `|| /usr/bin/open` fallback so a miss degrades to today's behavior, never to a lost link.
- Variant B's `PATH` shadowing (above).

## Out of scope / follow-ups

- Launch-config processes (see Non-goals).
- Per-session attribution of the opened tab.
- Linux/Windows shims.
