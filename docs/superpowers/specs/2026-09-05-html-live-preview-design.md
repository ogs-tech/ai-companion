# HTML Live Preview in the Editor — Design

- **Date:** 2026-09-05
- **Status:** Design approved by author in brainstorming; spec pending author review.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Opening an `.html`/`.htm` file in a Workbench tab shows a split view — CodeMirror on
  one side, a live-rendering iframe on the other — where the preview reflects the **unsaved draft**
  as you type and resolves the file's own relative assets (images, CSS, fonts) from disk. Other file
  types keep today's behavior exactly.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

The motivating case is working on a brand/identity page (`brand/index.html` inside a linked project):
edit the HTML, see the typography and logo update immediately. Today `FileSubject`
(`EditorPanel.tsx:299`) renders `.html` as text in CodeMirror and nothing else — `languageForPath`
already maps `html`/`htm` to the CodeMirror HTML mode (`code-language.ts:15-16`), so syntax
highlighting works, but there is no rendered view at all.

Two requirements make this more than "drop the string into an iframe":

1. **The preview must follow the draft, not the disk.** The point is seeing a change while typing.
   `FileSubject` keeps the in-progress text in React state (`draft`, `EditorPanel.tsx:308`); the file
   on disk only changes on Ctrl/Cmd+S. A preview that reads from disk would always be one save behind.
2. **Relative assets must resolve.** A brand page is `logo.png`, `../assets/Archivo.woff2`,
   `styles.css`. Rendering the HTML with an opaque origin (a bare `srcdoc` iframe) leaves every
   relative URL unresolvable, which breaks precisely the things this page exists to show.

Those two pull in opposite directions: (1) wants the document to come from renderer memory, (2) wants
it to come from a real origin backed by the filesystem. The design below satisfies both by splitting
them — the **document** comes from the draft, the **assets** come from a custom protocol.

## 2. Decisions made during brainstorming

1. **Approach A — `srcdoc` for the document, a `companion-file://` protocol for the assets.** The
   renderer injects a `<base href="companion-file://…">` into the draft and hands the result to the
   iframe's `srcdoc`. The document is never written anywhere; only sub-resource requests reach the
   main process. Two alternatives were rejected:
   - *Serve the document over the protocol too.* Gives a real (non-opaque) origin, so relative URLs
     resolve natively without a `<base>`. But to stay live-while-typing, the main process would have
     to hold a registry of renderer drafts — editing state leaking into the main process, inverting
     the app's data flow to buy URL-resolution convenience. Rejected: disproportionate architectural
     price.
   - *No protocol; inline every asset as a `data:` URI before rendering.* Zero new main-process
     surface, containment inherited from the existing IPC. But `readFile` refuses binary content
     (`node-file-browser-adapter.ts:317`), so it would need a new base64 read path anyway; external
     CSS with its own `url(...)` references would require recursion; and a 2MB image becomes ~2.7MB of
     base64 re-serialized into `srcdoc` on every keystroke. Rejected: honest, but degrades with use.
2. **Containment boundary = the root of the scope the file was opened from**, not the file's own
   folder and not the disk. `../assets/x.png` from `brand/index.html` resolves; anything above the
   project root is a 403. This reuses `FileBrowserService.resolveSafe` rather than writing a second
   containment rule — a second rule is exactly where path-traversal bugs are born.
3. **A file opened from the workspace uses the workspace root as its boundary**, mirroring the
   `workspace.*` / `project.*` duality the IPC layer already has (`workspace-handlers.ts` vs
   `project-handlers.ts`).
4. **Scope cut: `.html`/`.htm` only in this delivery.** The split-view shell is built generically
   enough for Markdown to reuse later, but no Markdown preview is built now.

## 3. URL contract

```
companion-file://<scope>/<path relative to that scope's root>

scope = "workspace"    → the active workspace's rootPath
      | "<projectId>"  → that project's path (a UUID from ProjectService.create,
                          so it can never collide with the literal "workspace")
```

The scope segment is the URL **host**, which is what makes the boundary structural rather than
enforced by string checks. For `brand/index.html` in project `P`, the injected base is
`companion-file://P/brand/`:

| in the HTML | resolves to | inside the boundary? |
|---|---|---|
| `logo.png` | `companion-file://P/brand/logo.png` | yes |
| `../assets/Archivo.woff2` | `companion-file://P/assets/Archivo.woff2` | yes |
| `/favicon.ico` | `companion-file://P/favicon.ico` | yes — project root |
| `../../outside/x.png` | the URL parser **collapses** it to `companion-file://P/outside/x.png` | yes, but still inside `P` |

The `..` never reaches the handler: `new URL()` normalizes the path and cannot climb above the host.
`resolveSafe` re-checks regardless — two layers, because the first is URL-parser behavior rather than
a guarantee this codebase owns.

**The scheme must be registered as privileged** via `protocol.registerSchemesAsPrivileged`, called
at module top level, **before** `app.whenReady()`:

```ts
{ scheme: 'companion-file',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
```

Each flag earns its place: `standard` gives the scheme host/path semantics, without which relative
resolution against `<base>` does not work at all and nothing in the table above resolves; `secure`
keeps a page on an opaque origin from treating the responses as insecure content; `corsEnabled` plus
`supportFetchAPI` are what make the `Access-Control-Allow-Origin` header of §7 mean anything — set
neither, and the font case fails exactly as silently as it would with no header; `stream` allows
range requests, so a `<video>` in a previewed page can seek.

## 4. New pieces

### Main process

- **`src/main/infrastructure/protocols/preview-protocol.ts`** — exports `registerPreviewScheme()`
  (privileged-scheme registration, called before `whenReady`) and `handlePreviewProtocol(getDeps)`,
  installed with `protocol.handle('companion-file', …)` inside `whenReady`.

  `getDeps` is a **function** — `() => ({ fileBrowserService, projectService, fileBrowserPort })` —
  evaluated on **every request**, never captured at registration time. This is not defensive style;
  it is required by how the composition root works. `buildDeps()` (`index.ts:336`) closes over
  mutable bindings, and `switchActiveWorkspace` (`index.ts:373`) rebuilds the whole graph: it
  reassigns `fileBrowserService` (line 381) and then `dispatch` (line 384). `ipcMain.handle`
  (line 389) survives that because it reads `dispatch` at call time rather than capturing it. A
  protocol handler cannot be re-registered the same way — `protocol.handle` runs once and lives for
  the life of the app. A handler that captured `fileBrowserService` at registration would keep
  serving assets from the **previous** workspace root after a `workspace.switchTo`. That is not
  cosmetic staleness; it is a containment hole in the exact feature that promises containment.

  Note the asymmetry: only the `workspace` scope is exposed to this. Project scope already resolves
  per request — `browserForProject` (`project-handlers.ts:8-11`) constructs a fresh
  `FileBrowserService` from `project.path` on every call — so the protocol handler should do the same
  for `<projectId>` scopes and use the getter only to reach the current workspace-bound service.

  One detail worth a code comment: the reassignments at `index.ts:380-384` run with no intervening
  `await`, so a request can never observe a half-swapped graph. That guarantee comes from the event
  loop, not from a lock — inserting an `await` in that block later would silently break it.

- **`src/main/infrastructure/protocols/asset-mime.ts`** — an extension→MIME map, ~20 lines, covering
  what a static page actually loads (html, css, js, json, svg, png, jpg, gif, webp, avif, ico, woff,
  woff2, ttf, otf, mp4, webm, txt) with `application/octet-stream` as the fallback. **No `mime-types`
  dependency** is added for a preview feature; if the author prefers the dependency over the map,
  that is a one-line conversation, not a redesign.

- **`FileBrowserPort` + `NodeFileBrowserAdapter` gain `readBytes(absPath): Promise<Uint8Array>`.**
  Required because `readFile` returns a `FilePreview` and explicitly refuses binary content
  (`node-file-browser-adapter.ts:317`) — images and fonts would die there. `readBytes` is a raw byte
  read with the same `MAX_READABLE_BYTES` ceiling and the same `not_found` mapping, and no preview
  semantics. Containment is unchanged: the absolute path still comes from
  `FileBrowserService.resolveAbsolutePath`, which is already public and delegates to `resolveSafe`.

### Renderer

- **`src/renderer/lib/html-preview-document.ts`** — a pure function
  `buildPreviewDocument({ html, baseHref, scrollY }): string`. No React, no DOM ownership beyond a
  throwaway parse; unit-testable in isolation.
- **`src/renderer/components/workspace/HtmlPreviewPane.tsx`** — owns the iframe, the debounce, and
  the scroll bridge.
- **`src/renderer/components/workspace/EditorSplit.tsx`** — the two-pane layout and the three view
  modes (code only / split / preview only). Built on `react-resizable-panels`, which is **already a
  dependency** and already used with a shared `ResizeHandle` in `WorkspaceScreen.tsx:82` — the split
  follows that existing pattern rather than hand-rolling a divider.
- **`EditorPanel.tsx` gains one branch** in `FileSubject`. `SpreadsheetPreview` is *not* extracted
  from that (1016-line) file as part of this work: CLAUDE.md says refactors stay out of feature PRs,
  and that rule is right here.

## 5. Document transformation

`DOMParser`, not string manipulation, for a concrete reason: the `<base>` element must land inside
`<head>`, and a document with no explicit `<head>` — or a malformed one mid-keystroke — defeats any
regex. The HTML parser never throws; it synthesizes the missing `<head>` and closes unbalanced tags,
which is what the browser would do anyway. `parseFromString` is inert: it executes no script and
fetches no resource.

```
draft → DOMParser → strip any existing <base> → prepend <base href={scopeBase}>
                  → append the scroll-restore <script>
                  → serialize (doctype + documentElement.outerHTML)
```

Existing `<base>` elements are stripped rather than left in place, because a page carrying its own
`<base href="/">` would otherwise silently re-point every relative URL away from the file's folder.

**Doctype:** `documentElement.outerHTML` loses the doctype, so it is re-emitted from the parsed
document when the source file has one. When the source has none, see §10 — this is the one open
decision in the spec.

The iframe is sandboxed as `sandbox="allow-scripts"` — deliberately **without** `allow-same-origin`.
Scripts are needed for the scroll bridge; withholding `allow-same-origin` keeps the origin opaque, so
the previewed page cannot reach the app's storage or DOM. It also means the injected script's
`postMessage` will report `origin: "null"`, which §6 accounts for.

## 6. Scroll bridge

One direction only, which is simpler than the two-way sync first sketched: the parent **bakes the
last known `scrollY` into the document** at injection time, and the injected script restores it
itself.

```
iframe  ──postMessage{scrollY}──▶  parent   (stored in a useRef, never in state)
parent  ──scrollY baked into doc──▶ iframe  (restored on DOMContentLoaded and on load)
```

Storing it in a `useRef` is what prevents a loop: scrolling the preview does not re-render React, so
the `srcdoc` is not regenerated, so the iframe does not reload. Restoration fires twice on purpose —
at `DOMContentLoaded` the document height does not yet account for images and fonts, so the `load`
handler corrects it.

The parent's guard on incoming messages is `event.source === iframeRef.current.contentWindow` —
**not** `event.origin`. An opaque origin reports the string `"null"`, and comparing against `"null"`
would accept a message from any other sandboxed iframe on the page.

Regeneration is debounced (~250ms after the last keystroke). Each regeneration reloads the iframe;
without the debounce, every character would tear down and rebuild the document.

## 7. Protocol handler and errors

| situation | response |
|---|---|
| method other than `GET`/`HEAD` | `405` |
| unknown scope, or `projectService.get` raises `not_found` | `404` |
| `resolveSafe` rejects (traversal or symlink escape) | `403` |
| file does not exist | `404` |
| larger than `MAX_READABLE_BYTES` (5MB, `node-file-browser-adapter.ts:19`) | `413` |
| ok | `200` + `Content-Type` + `Access-Control-Allow-Origin: *` + `Cache-Control: no-store` |

The 403 requires an explicit translation rather than falling out of the error: `resolveSafe` raises
`DomainError('validation', …)` for both traversal and symlink escape
(`file-browser-service.ts:33,49`), the same kind used for ordinary bad input. The handler must map
`validation` → 403 and anything unrecognized → 500; without that mapping a traversal attempt would
surface as a generic server error and read like a bug rather than a refusal.

`Access-Control-Allow-Origin: *` is not decoration. Fonts are CORS-gated and the iframe's origin is
opaque, so without that header a local `@font-face` fails **silently** — in a tool whose motivating
use case is choosing typography, that is the worst possible place for a silent failure.
`Cache-Control: no-store` is what makes a replaced `logo.png` visible without restarting the app.

Renderer-side failure: when the file is not editable (truncated above `PREVIEW_CONTENT_CAP`, 256KB —
`node-file-browser-adapter.ts:20`, surfaced as `editable` at `EditorPanel.tsx:342`), the split still
renders with the preview in read-only mode rather than hiding the preview. A large HTML file is
exactly one you would want to look at even when you cannot safely write it back.

## 8. Renderer behavior

`FileSubject` picks the split view when `languageForPath(path) === 'html'`; every other file type
takes the current code path untouched. The scope passed to the preview is derived from the props
`FileSubject` already receives: `projectId` when present, the literal `workspace` when absent
(`EditorPanel.tsx:299-305`) — the same switch `useFilePreview` already makes
(`use-file-browser.ts:19-31`).

Three view modes (code / split / preview) are toggled from a small control in the panel header. The
default is split. Mode is per-tab component state; it is not persisted across app restarts in this
delivery.

## 9. Testing

**node project** (`tests/main/**`) — the protocol handler against a fake port and fake services: one
case per row of the §7 table, plus the regression the getter exists for — swap the active workspace
and assert the next request serves the **new** root. Also `readBytes`: binary content round-trips
unchanged, oversize is refused, missing path raises `not_found`.

**jsdom project** (`tests/renderer/**`) —
- `buildPreviewDocument` as a pure function: base injected into a document with no `<head>`;
  pre-existing `<base>` removed; doctype preserved when present; scroll value baked in.
- `HtmlPreviewPane`: `srcdoc` changes only after the debounce elapses; a `message` event whose
  `source` is not the iframe is ignored.
- `EditorPanel`: an `.html` path opens in split view; an `.md` path renders exactly as today.

## 10. Open decision

**Doctype when the source file has none.** Two defensible options, and the author decides:

- **Emit `<!doctype html>` anyway.** The preview always renders in standards mode — predictable, but
  it lies about what a browser would actually do with that file.
- **Emit nothing.** Faithful to the file, but quirks mode can make you chase a CSS bug that only
  exists because the doctype is missing.

Recommendation: **emit nothing**, and surface a small inline notice in the preview header when the
source has no doctype. That keeps the preview honest while making the cause visible instead of
leaving it to be discovered.

## 11. Out of scope

- Markdown live preview (the split shell is reusable, but no Markdown wiring is built here).
- Persisting the view mode across restarts.
- Editing or hot-reloading linked CSS/JS files from within the preview — only the HTML file in the
  active tab is live; its assets are read from disk on each request.
- Extracting `SpreadsheetPreview` out of `EditorPanel.tsx`.
- Any change to how non-HTML files are previewed or saved.
