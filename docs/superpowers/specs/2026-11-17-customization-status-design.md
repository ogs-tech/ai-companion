# Customization status consolidation — design

Date: 2026-11-17 · Status: approved, implemented

## Intent

A customization's state is assembled in the renderer from four sources that never meet in main: the health
report (per-destination `severity`, polled every 30 s), `detected.list` (scanned 3–4× per refresh: two queries in
`use-customization-tree.ts:36-37`, plus `hook.list`/`mcp.list` calling `detection.list` internally),
`adapter.entitySyncStates` (`synced | pending`, no consumer), and each entity's `enabled`. The tree's chips
(Problemas · Desativados · Detectados) mirror those sources, not what the user needs to know.

Goal: **one status per customization, computed once in main**, with three values and a per-channel breakdown.
The scan runs on app load/reload and on scope switch (Início ↔ workspace, workspace ↔ workspace), not on a timer.

## Status model

| Status | Rule | Row shows |
|---|---|---|
| **Instalado** | every enabled `manage` channel's destinations check `ok` | nothing (silence = ok) |
| **Draft** | sync can't install it silently: a destination blocked by a file/entry the app doesn't own (`foreign`, `real-file`); a detected item not yet imported; or `enabled: false` | `draft · conflito Cursor` / `draft · importar` / `draft · desativado` |
| **Com erro** | any other non-ok check on the item (`missing`, `drift`, `symlink-to-other`, MCP auth/runtime, plugin entity, unresolvable destination) | `⚠ Claude · Cursor` |

- Per item: **error > draft > installed** (an item with an error on Claude and a conflict on Cursor is Com erro;
  its channel breakdown still says Cursor is draft).
- Per channel: the same precedence over that channel's checks. Disabled = draft on no specific channel (it goes to none).
- Plugin children's statuses roll up to the plugin row (today's `rollUpToPlugins`, moved to main).
- Global items in a workspace keep the ⊕ / `Global` tag after the status slot.

## Backend

- `HealthCheck` gains `outcome?: 'installed' | 'draft' | 'error'`, set by every collector that sets `entityUrn`.
  The collector is the only place that knows `foreign` vs `missing`; `severity` stays for Diagnósticos/nav badge.
  Mapping: symlink `symlink-to-source`→installed, `real-file`→draft, else error; generated-file / merge-entry
  `ok`→installed, `foreign`→draft, else error; mcp-auth, mcp-runtime (non-ok), plugin-entity → error.
- `DetectionService` coalesces: concurrent `list()` calls share one in-flight full scan (filtered by `kinds`
  per caller); nothing is kept once it settles. `hook.list`, `mcp.list` and the status report fired by one
  refresh → one scan. (A memo was rejected: it would need invalidating at every write path — save, delete,
  import, adapter toggle, plugin install, sync — and one missed path shows a stale status.)
- New `CustomizationStatusService` (`application/services/customization-status-service.ts`, ports only):
  `getReport()` → `CustomizationStatusReport` built from `HealthService.getReport('personal')`,
  `DetectionService.list()`, the entities' `enabled`, plugin provenance and the adapters toggle. Computed per
  call — cheap now that nothing polls it.
- Shared types (`src/shared/customization-status.ts`):
  ```ts
  type CustomizationStatus = 'installed' | 'draft' | 'error';
  type DraftReason = 'foreign' | 'detected' | 'disabled';
  interface ChannelStatus { status: CustomizationStatus; reason?: DraftReason }
  interface ItemStatus { status: CustomizationStatus; reason?: DraftReason; channels: Partial<Record<ChannelId, ChannelStatus>> }
  interface CustomizationStatusReport { generatedAt: string; items: Record<string /* urn */, ItemStatus>; detected: DetectedEntity[] }
  ```
  Detected items are keyed `urn:detected:<id>` in `items`, with `channels[harness] = draft/detected`.
- IPC: `customization.status {}` → `CustomizationStatusReport`.
  **Removed:** `adapter.entitySyncStates` (+ `AdapterManager.entitySyncStates`, `EntitySyncState`, unused
  `useEntitySyncStates`).

## Renderer

- `useCustomizationStatus()` — react-query, `staleTime: Infinity`, no polling. It fetches on app load/reload
  (fresh query cache), on scope switch (`use-workspaces.ts:41` invalidates every query), and when an entity
  changes (`entity:changed` + the mutations' existing invalidations).
- `useCustomizationTree` reads that one query instead of `useEntityHealth` + two `useDetected`.
  `buildCustomizationTree` takes `status` and drops its own derivation:
  `TreeFilter = 'all' | CustomizationStatus` plus `channel?: ChannelId` in the options;
  `totals = { all, global, installed, draft, error, byChannel: { draft, error } }`; `RowBadge = 'error' | 'draft' | null`.
  Rows the lists already know are off or detected get that draft status before the report arrives.
- Invalidation: the status query key sits under `['health', 'personal']`, so every existing health invalidation
  refreshes it; hook delete, plugin toggle/update/remove/import and the channel toggle now invalidate health too.
- Chips (mockup A, approved): `Todos · Instalado N · Draft N · Com erro N`. With Draft or Com erro active, a
  second row `(Todos) (Claude n) (Cursor n)` filters by channel (only `manage` channels that are on; a 0 chip is
  disabled, not hidden). Channel sub-filter resets when the state chip changes. Counts are on the
  search-filtered set, so a chip's number equals what selecting it shows.
- `ChannelSyncSection` and the nav/Diagnósticos keep reading the health report (they need titles/paths);
  `entity-health.ts`'s `channelProblems`/`rollUpToPlugins` go away once nothing uses them.

## Health polling

`useHealthReport` drops `refetchInterval` (30 s): it refreshes on load, scope switch, entity change (already
wired in `use-entity-change-invalidation.ts`) and Diagnósticos' own refresh. Trade-off: an MCP token that expires
mid-session shows up at the next trigger, not within 30 s.

## Non-goals

- No change to sync/materialization behaviour, import flow, or editors.
- No resolve action for a `foreign` draft beyond today's remediation text + "Abrir diagnóstico".

## Verification

Lint, typecheck, unit tests (collector `outcome` mapping, `CustomizationStatusService` precedence/roll-up,
detection coalescing, `customization-tree` filters + channel sub-filter + totals, chips component),
`npm run build` + `e2e/product/customizations/*.spec.ts` (channel-warnings and browse-and-search updated to the
new chips). Docs: `ipc-contract.md`, `architecture.md`, `create-skills-and-agents.md` § tree.
Not verifiable by tests: dark theme, real `~/.claude`/`~/.cursor` data — reported as such.
