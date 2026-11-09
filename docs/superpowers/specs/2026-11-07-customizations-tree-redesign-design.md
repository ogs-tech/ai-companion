# Customizations tree redesign

## Intent

The customizations tree (left panel, `CustomizationsList.tsx`) exists to answer one question at a glance: **is everything I manage in sync with my channels (Claude, Cursor)?** Today it answers a different question (what kind of item is this, and where did it come from) with noise: a coloured left spine per row, a hover that swaps text for actions, and plugins listed twice.

## Goals

- A row shows nothing when the item is healthy in every enabled channel. A problem shows `⚠ <Channel>` on that row.
- A folder aggregates its children's problems (`2 ⚠` before the item count), so "all fine" is readable without expanding.
- Plugins appear **once**, as a folder row under *Integrações > Plugins*. The plugin's contents (skills, agents, hooks, MCP) are not listed in the tree.
- **Every row type follows the same rules** (skills, agents, hooks, MCP, plugins; instructions where listed): same status display, same folder aggregation, same no-hover behaviour. No type is left on the old display, and the work is not phased by type. That includes giving hooks and MCP a health check (see "Open for the builder").
- Row type is read from its icon only.
- Hover changes nothing: no text swap, no layout shift, no actions revealed.
- The reason for a problem lives in *Diagnósticos* (`HealthScreen`), not in the tree.

## Reference layout (approved mockup B)

```
▾ Skills                              12
    ✦ brainstorming
    ✦ review-pr
▾ Agents                               4
▾ Integrações                    3 ⚠  36
  ▾ Hooks                        2 ⚠  14
      ⚓ PostToolUse · signals
      ⚓ SessionEnd · signals    ⚠ Cursor
      ⚓ Stop · signals         ⚠ Claude · Cursor
      ⚓ PreCompact · notify              (Cursor can't express it: no ⚠)
  ▾ MCP                                19
  ▾ Plugins                      1 ⚠   3
      ▸ superpowers
      ▸ frontend-design         ⚠ Cursor
      ▸ playground
```

- Top-level groups: Skills, Agents, Integrações (Hooks, MCP, Plugins). No separate origin-based "Plugins" block.
- No left spine on any row; rows are icon + name, with `⚠ <Channel>` right-aligned only on a problem.
- Folders show `N ⚠` (orange, only when N > 0) then the total, right-aligned. A parent sums its children's problem items (Integrações 3 = Hooks 2 + Plugins 1).
- A row failing in both channels reads `⚠ Claude · Cursor` and counts as 1 item.
- Plugin rows are closed folders (chevron `▸`) whose contents are not expanded in the tree; clicking opens the plugin detail.
- The same rules apply to every row in Skills, Agents and MCP.
- Hover has no visual effect beyond the standard row background (no text swap, no revealed controls, no layout shift).
- Mockup sources (local, not committed): `.superpowers/brainstorm/3147-1794039476/content/row-status.html` (status styles) and `final-tree.html` (approved final tree; the hook-without-support case is its option 1).

## Non-goals

- No fix-from-the-tree action (no "re-sync" button on a row).
- No per-channel "ok" indicator, no "off" state. Silence means ok.
- No change to the Início / workspace scope model or to what gets synced.
- No change to Diagnósticos' own layout beyond accepting a deep-link (see below).

## Anti-goals

- Colour as the only carrier of meaning. `⚠` plus the channel name always travel together.
- A tree that needs expanding to learn whether something is wrong.
- Re-introducing a second place where the same plugin is listed.

## Decisions (as made with the user)

- Status style is "silence when ok" (option B of the mockups): only `⚠ Cursor` / `⚠ Claude` on a problem row; folders sum problems.
- The coloured spine (`accentColor` in `TreeRow.tsx`) is removed from tree rows.
- Hover does nothing on rows.
- Reason and detail go to Diagnósticos.
- Plugins are listed only as folders.

## Decisions (my calls — check these)

1. **Remove the top-level "Plugins" origin block** (`originSections` → `plugins` / `OriginSection` in `CustomizationsList.tsx`) and the plugin-contents grouping. The single plugin listing is *Integrações > Plugins* (`PluginsTreeGroup`), one row per plugin.
2. **Opening a plugin row** opens its existing detail view (`PluginRelatedEntities` / drawer) which shows what it provides. Plugin-provided skills/agents are therefore reachable only through the plugin, not through the Skills/Agents groups.
3. **Click on `⚠`** navigates to Diagnósticos, filtered/scrolled to that item's checks. Row click keeps its current meaning (open the item).
4. **Only enabled channels count.** If `adapters.cursor` is off, Cursor never produces a `⚠`. An entity with `enabled: false` is removed from channels by design and is not a problem.
5. **"Unsupported by target"** (a hook Cursor cannot express, today a Sync-report warning with `skipped: 'unsupported-by-target'`) is **not** flagged in the tree; it is expected, not a fault.
6. **Existing row actions** (edit/delete, today under `actions` on hover) move to the context menu (`onContextMenu` already exists on `TreeRow`) and the item's detail view. No hover-revealed controls.
7. Counts: folder shows `N ⚠` (orange, only when N > 0) then the total count, as in the approved mockup.
8. **Failing in both channels:** one `⚠ Claude · Cursor` on the row (channels in a fixed order, Claude first). Folders count *items* with a problem, not channel failures: one hook failing in both = `1 ⚠`.

## Constraints

- Hexagonal rule: no new I/O in services; status data goes through ports.
- Strict TS (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); `.js` import extensions.
- Dark theme is the primary surface; the warning colour must read on the rail background. Use theme tokens, not hex.
- Lint, typecheck and tests green is a release gate.
- Any new IPC method: types in `src/shared/`, handler in `src/main/ipc/registry.ts`, documented in `docs/technical/reference/ipc-contract.md`.

## Open for the builder

- **Data source for per-item, per-channel status.** `HealthCheck` (`src/shared/health.ts`) has `category` (`symlink`, `generated-file`, `config-drift`, …) and `target`, but no entity urn or channel field. The builder must decide whether to extend `HealthCheck` (e.g. `entityUrn`, `channel`) or derive status from sync results; either way the tree and Diagnósticos must read the same source so a `⚠` always has a matching check. This is the main unknown; confirm against `health-service` before planning.
- **Verified in code (2026-11-07):** `SymlinkCollector` and `GeneratedFileCollector` (`src/main/application/services/health/`) emit one check per planned destination with the channel inside the id (`symlink:<adapterId>:<destination>`) and the destination path as `target`, but no entity urn, so a check cannot yet be joined to a tree row without a new field or a destination→entity lookup. Skills, agents and instructions (symlink / generated file) are therefore the easy case. **Hooks and MCP are `merge` destinations (`MergeMaterializer`, entries in shared JSON files) and no collector of those two categories covers them**; `config-drift-collector.ts` was not read. The hook example in the mockups (`⚠ Cursor` on a hook) needs a new or extended check. **This is in scope** (decided: standardize all types, no phasing): the plan must include a merge-destination check for hooks and MCP, and the entity-to-check join for all types.
- Deep-link mechanism into Diagnósticos (the app uses a `View` union, no router).
- Exact `⚠` copy per channel and the accessible label (`aria-label` / tooltip text).
- Tests: tree rendering with and without problems, folder aggregation, no duplicate plugin rows, no hover side effects.

## Not verified

Mockups were rendered in a browser, not in the running app. Real rendering (dark theme, fonts, glyph for the hook anchor, `⚠` contrast) is unverified until implemented.
