# Cursor sync: MCP and hook entities, `.mdc` rules — Design

- **Date:** 2026-11-02
- **Status:** Implemented (2026-11-02). Deviations: detection was generalized to skills/agents/MCP/hooks in both Claude and Cursor folders (`detection-service`, absorbing project 2's read side); a disabled MCP is removed from Claude's files in every location instead of using the `disabledMcpjsonServers` list; `McpConfigPort`/`FsMcpConfigStore`/`McpDisabledStash` were deleted (replaced by `DetectionService` + `MergeMaterializer`). Open items in §9 remain unverified on a real Cursor install.
- **Scope:** Project 1 of 4 in "complete the Cursor adaptation". Later, separate designs: (2) detecting `<folder>/.cursor/` customizations on workspace open, (3) `cursor-agent` sessions inside the app (`run` capability), (4) Cursor session history/cost.

## 1. Intent

Cursor is currently synced for skills, agents and instructions only. MCP servers and hooks are not
`Entity` kinds: `mcp-service` and `hook-service` read and write Claude's live config files directly, so
nothing reaches Cursor. The goal is that the user's MCP servers and hooks are managed once, in the app,
and materialized into every enabled harness — Claude Code and Cursor — the same way skills and agents
already are.

## 2. Goals

- `mcp` and `hook` become canonical `Entity` kinds (`urn:mcp:<name>`, `urn:hook:<name>`), scopes `personal` and `workspace`, stored as app-owned files in the data dir (`<data>/mcps/`, `<data>/hooks/`).
- Both are materialized into **Claude** (existing live files) and **Cursor** (`~/.cursor/mcp.json`, `~/.cursor/hooks.json`, and `<folder>/.cursor/mcp.json`, `<folder>/.cursor/hooks.json`).
- Instructions additionally generate Cursor rules `.cursor/rules/*.mdc` (`alwaysApply: true`).
- The `<folder>/AGENTS.md` conflict between the Claude and Cursor adapters ends.
- Saving or importing an entity propagates it to **all enabled harnesses**, regardless of which harness it came from.

## 3. Non-goals and anti-goals

- No `run` capability for Cursor here (project 3). No Cursor history/cost (project 4).
- No reading of `<folder>/.cursor/` for skills/agents/rules (project 2). Only MCP/hook *detection from Claude's files* is in this design, because the existing MCP screen already does it.
- **Anti-goal:** never rewrite or reformat the user's hand-written content in `~/.claude.json`, `settings.json`, `.mcp.json`, `~/.cursor/mcp.json`, `~/.cursor/hooks.json`. A sync that changes bytes outside the app's own entries is a failure even if the result is semantically equal.
- **Anti-goal:** no silent data loss. Anything overwritten is backed up, as today.
- Not a goal: perfect hook translation. Only events that exist in both harnesses are translated.

## 4. Decisions made with the user

1. **Approach B:** `mcp` and `hook` are real `Entity` kinds with a canonical copy (not a one-way mirror from Claude's files).
2. **Existing configs are detected, not adopted automatically.** Servers/hooks already present in Claude's (or Cursor's) files keep showing as **detected**, read-only. Only items created in the app, or imported via the row menu "⋯" → *Import*, become canonical. Nothing is rewritten on its own.
3. **Detected items are read-only; editing requires importing first.**
4. **Import propagates everywhere:** importing an item (even one that exists only in Cursor) makes it canonical and it is then written to every enabled harness, like any entity.
5. Instructions generate `.mdc` rules.

6. **Hooks the target cannot express are skipped, not degraded.** A canonical hook whose matcher (or hook type) has no Cursor equivalent is not written to Cursor at all; it stays active in Claude and the Sync report lists it as a warning. A hook is never written to Cursor with its matcher dropped, since that would make it fire on every tool. (Builder-check question, answered by the user.)

## 5. Decisions made by the designer (not yet confirmed with the user)

- **A third destination strategy, `merge`**, alongside `symlink` and `write`. These files are shared with other keys and with hand edits, so neither symlinking nor whole-file writing is safe. A `merge` destination names a file, a JSON path (`mcpServers.<name>`, `hooks.<event>`) and the entry value; the materializer reads, replaces only that entry, and writes atomically with a backup.
- **Ownership of a merged entry** is recorded by the app (an index of entries it manages, per file), not by a marker key inside the entry, because Cursor/Claude may reject unknown keys. Verify during implementation whether an in-entry marker is tolerated; if so it may be added as a second signal.
- **Workspace instruction → `.cursor/rules/<instruction-name>.mdc`** with `alwaysApply: true`, marker-owned (`x-ai-companion-managed: true` in frontmatter, as the personal rule already does). The Cursor adapter stops writing `<folder>/AGENTS.md`; the Claude adapter keeps its symlink. Known-issue entry about the conflict is removed from `docs/reference/adapter-targets.md`.
- **Hook translation:** translate events with a Cursor equivalent; skip the rest (and any hook with a matcher/type Cursor cannot express, per decision 6) and report each skipped entry in the Sync report as a warning (not a failure). The event mapping table lives in one isolated module so it is easy to extend. The canonical hook keeps Claude's full shape (event, matcher, command, timeout, type); Cursor receives the translatable subset.
- **MCP enable/disable** keeps the existing per-location semantics for Claude (disabled list for `.mcp.json`, stash for inline). For Cursor, a disabled canonical MCP is simply not written.
- **The existing MCP screen** (dedicated list, health badges, enable toggle) stays and is re-pointed at the canonical layer plus detected items; hooks get an equivalent list if one does not exist.
- Existing `McpProvenance`/`McpScope` `detected` stays; `McpConfigPort.read` becomes the *detection* source, and `upsert`/`remove` become the Claude *materialization* path.

### 5.1 Further calls by the designer (from the builder check)

- **Migration:** none. Items created by the old flow live in Claude's files and therefore show as *detected*, exactly like any pre-existing item (decision 2). The old `mcp-service`/`hook-service` write paths are replaced by the canonical-first flow; `McpConfigPort.read` stays as the detection source.
- **Detection scope:** this project covers detection in Claude's files **and** in `~/.cursor/mcp.json` / `~/.cursor/hooks.json` (needed so a Cursor-only item can be imported, decision 4). `<folder>/.cursor/` is project 2. Once an item is canonical, the detected row with the same name and kind is hidden (deduplicated by name); if the detected definition differs, the canonical one wins and the difference is not surfaced in v1.
- **Claude workspace targets:** workspace MCP → `<folder>/.mcp.json`; workspace hooks → `<folder>/.claude/settings.json`. Existing disable semantics (disabled list for `.mcp.json`, stash for inline) apply unchanged.
- **Cursor workspace hooks:** written to `<folder>/.cursor/hooks.json`; if verification (§9) shows Cursor ignores it, skip with a sync-report warning instead.
- **Drift in a `merge` file:** an entry the app manages that was hand-edited or deleted is overwritten on the next sync, with the previous content backed up (same `conflict` result as other overwritten targets). An unmanaged entry with the same name as a canonical one is treated as foreign: backed up, then replaced, with a `conflict`. If the managed-entry index is lost, existing entries are treated as foreign (backup + replace) rather than guessed at.
- **Hook identity inside a shared array:** a hook entry is identified by `(event, matcher, command)`; the app removes/replaces only entries it recorded under that identity.
- **Secrets:** MCP `env` values are stored in plain text in the canonical file, in the harness files and in `_backups/`, as Claude's own file already does. No new secrets handling in v1.
- **Disabling a harness:** removes the app-managed entries from that harness's files (same prompt and `removeSymlinks`-style choice as today); unmanaged entries are never touched.

## 6. Constraints

- Hexagonal rule from `CLAUDE.md`: services depend on ports; file I/O in `infrastructure/`.
- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `.js` import extensions.
- Plugin-provided servers/hooks stay read-only (`source.kind === 'plugin'`).
- Production bar: lint, typecheck and tests green. Update `docs/reference/{architecture,adapter-targets,customization-schema,ipc-contract,on-disk-layout}.md` and the how-to for enabling Cursor.
- IPC: any new/renamed method follows `docs/how-to/add-an-ipc-method.md`; the `mcp.*` namespace keeps working for the renderer.

## 7. Cursor file formats (as observed on the user's machine)

- `~/.cursor/mcp.json`: `{ "mcpServers": { "<name>": { "command", "args", "env" } | { "url" } } }`.
- `~/.cursor/hooks.json`: `{ "version": 1, "hooks": { "<event>": [ { "command": "…" } ] } }` (example: event `stop`).
- Rules: `.cursor/rules/*.mdc` with YAML frontmatter (`alwaysApply`, optional `globs`, `description`).

## 8. Left to the builder

- Exact on-disk shape of `mcps/` and `hooks/` canonical files and their schema (follow `docs/reference/customization-schema.md`).
- The Claude↔Cursor hook event mapping table (research Cursor's current event list; the file above only proves `stop` exists).
- Where the managed-entry index lives and how it is cleaned up when an adapter is disabled.
- Import UX details in the row menu, and conflict handling when an imported name already exists canonically.
- Test plan; at minimum: `merge` strategy round-trips preserving unrelated keys and formatting-sensitive content, ordering/backup behavior, translation table, and propagation of an imported item to all enabled harnesses.

## 9. Open items to verify

- Does Cursor tolerate unknown keys inside `mcpServers` entries and hook entries? (decides whether an in-entry marker is possible)
- Full list of Cursor hook events and payload differences from Claude's.
- Whether Cursor reads `<folder>/.cursor/hooks.json`, or only the user-level file.
