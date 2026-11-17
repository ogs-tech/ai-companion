# Customizations tree redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the census-driven Customizações tree with a type-grouped tree (Global inline, state chips, exception-only rows) built from one pure model, and add a per-channel Sincronização section.

**Architecture:** `buildCustomizationTree()` (pure, `src/renderer/lib/`) turns every list the panel shows into groups › items with origin, state and totals; `useCustomizationTree()` feeds it from the existing react-query hooks once each. `CustomizationsList` only renders the model; each `*TreeGroup` file shrinks to a per-kind row component that keeps its own context menu and mutations. `channelSyncRows()` (pure) + `ChannelSyncSection` read the existing health report.

**Tech Stack:** Electron renderer, React 18, MUI/Emotion, @tanstack/react-query, Vitest (jsdom project) + Testing Library, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-17-customizations-tree-redesign-design.md`

## Global Constraints

- UI copy in pt-BR, code/identifiers/test names in English.
- Imports use `.js` extensions; strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Group order: Instruções, Skills, Agents, MCP, Hooks, Plugins. "Integrações" no longer exists.
- Chips: `Todos` · `⚠ Problemas N` · `Desativados N` · `Detectados N`; single-select; counts on the search-filtered set; 0-count chip visible but disabled; not persisted.
- Row trailing slot precedence: Problem > Disabled > Detected > Global tag. Tags: `desativado`, `detectado · importar`, `Global`.
- Footer: `N itens` / `N itens, G do Global`; filtered: `n de N itens` + `Limpar filtros`.
- Collapse keys: `tree-group:<scopeId|home>:<groupId>`.
- Test ids: keep `control-panel-*`; new `tree-group-<id>`, `tree-row-<key>`, `chip-<filter>`.
- `window.confirm` delete flows stay unchanged (undo-toast is a separate follow-up).
- **No commits** — the user reviews the working tree and makes one commit. Each task ends with its tests green instead.
- After any `src/` change, before e2e: `npm run build`; `pkill -f ai-companion-e2e-userdata` if a stale Electron blocks launch.

## Deviations from the spec (decided while planning — confirm on review)

1. **One additive IPC field:** the renderer `Hook` has no `enabled`, because `toHook()` (`src/main/application/services/hook-service.ts:177`) drops it. The spec's disabled-hook fix needs `enabled: boolean` on the `hook.list` result. Additive, no migration.
2. **Row identity is `key`, not `urn`:** the same name can exist locally and in Global (`urn:skill:tdd` twice), so `TreeItem.key = \`${origin}:${folderAlias ?? ''}:${urn}\`` and the test id is `tree-row-<key>`.
3. **`origin` has no `'plugin'` value:** plugin-provided skills/agents/MCP/hooks are excluded from type groups (listed inside their plugin), so the union is `'local' | 'global' | 'detected'`.
4. **The model also returns `shown` and `grandTotal`** (footer/header), which removes today's `setBaseline` during render (`CustomizationsList.tsx:157`).
5. **Sync copy for merge entries** is `Entrada em <basename(target)>` (e.g. `mcp.json`, `.claude.json`) rather than a fixed `mcp.json`, so it is true for Claude too.
6. **Unchecked channel:** a `manage` channel that is enabled but has no check for the urn yet shows `Ainda não sincronizado` (no silent gap). The section is not rendered while creating.

## Review Focus

1. Chip selected, then a search drops its count to 0 → the chip stays selected and disabled-looking, the list shows the empty state with `Limpar filtros`; never a blank panel. (Task 1 + Task 3 tests)
2. Same name in the workspace and in Global → two rows with distinct keys, both clickable, the Global one read-only. (Task 1 test)
3. Workspace still loading (`isHome` false, `localScope` undefined) → no crash, nothing tagged Global twice, no flicker of counts. (Task 1 test)
4. Health report loading or failed → no ⚠ anywhere, `Problemas 0` chip disabled, Sincronização renders nothing. (Task 1 + Task 4 tests)
5. Scope switch (Início ↔ workspace) with a chip active → chip and search reset to `Todos`. (Task 5 e2e)

---

### Task 1: Pure tree model

**Files:**
- Create: `src/renderer/lib/customization-tree.ts`
- Test: `tests/renderer/lib/customization-tree.test.ts`

**Interfaces:**
- Consumes: `ChannelProblems` (`lib/entity-health.ts`, already rolled up to plugins), `matchesQuery` (`lib/control-panel-filter.ts`), `entityUrn` (`shared/entity.ts`), `Skill/Agent/Instruction`, `McpServer` (`shared/mcp.ts`), `Hook` (`hooks/use-hooks.ts`, with `enabled` from Task 2), `PluginListItemIpc`, `DetectedEntity`.
- Produces:

```ts
export type TreeFilter = 'all' | 'problems' | 'disabled' | 'detected';
export type TreeGroupId = 'instruction' | 'skill' | 'agent' | 'mcp' | 'hook' | 'plugin';
export type TreeOrigin = 'local' | 'global' | 'detected';
export type RowBadge = 'problem' | 'disabled' | 'detected' | 'global' | null;

export type TreeEntity =
  | { kind: 'instruction'; value: Instruction | undefined } // undefined = Início's unconfigured singleton (create row)
  | { kind: 'skill'; value: Skill } | { kind: 'agent'; value: Agent }
  | { kind: 'mcp'; value: McpServer } | { kind: 'hook'; value: Hook }
  | { kind: 'plugin'; value: PluginListItemIpc }
  | { kind: 'detected'; value: DetectedEntity }; // detected skill/agent; detected MCP/hook stay kind 'mcp'/'hook'

export interface TreeItem {
  key: string; urn: string; name: string; origin: TreeOrigin; folderAlias?: string;
  state: { problems: readonly ChannelId[]; disabled: boolean };
  entity: TreeEntity;
}
export interface TreeGroup { id: TreeGroupId; label: string; items: TreeItem[]; count: number; problems: number }
export interface TreeTotals { all: number; global: number; problems: number; disabled: number; detected: number }
export interface CustomizationTree { groups: TreeGroup[]; totals: TreeTotals; shown: number; grandTotal: number }

export interface TreeInput {
  skills: readonly Skill[]; agents: readonly Agent[];
  instructions: readonly Instruction[]; personalInstruction: Instruction | null | undefined;
  mcps: readonly McpServer[]; hooks: readonly Hook[]; plugins: readonly PluginListItemIpc[];
  detected: readonly DetectedEntity[]; problems: ChannelProblems;
}
export interface TreeOptions {
  isHome: boolean; localScope?: { scope: 'workspace'; scopeId: string };
  mcpMatchPath?: string; aliases: Readonly<Record<string, string>>; multi: boolean;
  query: string; filter: TreeFilter;
}
export function buildCustomizationTree(input: TreeInput, options: TreeOptions): CustomizationTree;
export function rowBadge(item: TreeItem): RowBadge;
```

Rules the implementation must follow (from the spec and today's code):
- **Origin.** Skill/agent/instruction: `local` when `scopes[0] === 'workspace' && scopeId === localScope.scopeId`, else `global`. If there is no `localScope`, everything is `local`, and so is everything at Início. MCP: `local` when `isLocal(server, mcpMatchPath)` (move it from `McpTreeGroup.tsx:30`). Hooks: `global` in a workspace and `local` at Início, matching today's `isProjectContext && !showGlobal` gate. Plugins: `scope === 'project'` → `local`, `personal` → `global`. Detected skills/agents come from `input.detected`, filtered by `d.scope === (isHome ? 'personal' : 'workspace')` and `kind ∈ {skill, agent}`. MCP/hooks with `source.kind === 'detected'` → `detected`. Items with `source.kind === 'plugin'` are dropped.
- **Personal instruction.** At Início it is always one row (`value` may be undefined), matched against `'instructions'` plus its name and description, as today. In a workspace it shows only when saved, as `global`.
- **folderAlias.** Set only when `multi` and the entity (or detected item) has `folder`, as `aliases[folder]`.
- **urn.** `entityUrn(kind, name)`. MCP uses `server.name`, hook uses `hook.id`, plugin uses `entityUrn('plugin', id)`, and detected uses its own kind + name.
- **State.**
  - `problems` = `input.problems.get(urn) ?? []`, but always `[]` for detected items.
  - `disabled` = `enabled === false` for MCP, hook and plugin.
- **Pipeline.**
  1. The search filter gives `searched`.
  2. `totals` are computed from `searched`. `global` counts only `origin === 'global'`, and `problems` counts items with `problems.length > 0`.
  3. The chip filter gives the visible set.
  4. Group, then sort: local, then global, then detected, alphabetical by name inside each block.
  5. Drop empty groups, except `skill` and `agent` when `query.trim() === '' && filter === 'all'`.
- **Counts.**
  - `count` = number of visible items.
  - `problems` = number of visible items that have problems.
  - `shown` = sum of `count`.
  - `grandTotal` = item count with no query and no filter.
- **Labels.** Instruções, Skills, Agents, MCP, Hooks, Plugins.
- **`rowBadge`.** Returns `problem` if there are problems, then `disabled`, then `detected` when `origin === 'detected'`, then `global` when `origin === 'global'`, else `null`.

- [ ] **Step 1: Write the failing tests** with small fixtures built by local `skill(name, scope?)`, `mcp(name, opts)` etc. helpers:
  - `groups by type in fixed order` asserts that `groups.map(g => g.id)` equals `['instruction','skill','agent','mcp','hook','plugin']` when each has an item.
  - `lists Global items inline after local ones` uses workspace `ws1` with local `commit-msg`, `review-pr` and personal `tdd`. It asserts the skill group names are `['commit-msg','review-pr','tdd']` and that `tdd` has origin `global`.
  - `keeps local and Global items with the same name apart` uses two `tdd`, with distinct `key`s and origins `local` and `global` (Review Focus 2).
  - `treats everything as local while the workspace loads` uses `isHome: false` and no `localScope`, and asserts `totals.global === 0` (Review Focus 3).
  - `Início shows no Global and always lists the singleton instruction` uses `isHome: true` and `personalInstruction: null`. It asserts the instruction group has 1 item with `value` undefined and `totals.global === 0`.
  - `drops plugin-provided items and keeps one row per plugin` has a skill with `source.kind 'plugin'` that does not appear, and plugin `p1` in the plugin group.
  - `computes chip totals on the searched set`: the query `rev` matches 1 item with a problem, so `totals` equals `{ all: 1, global: 0, problems: 1, disabled: 0, detected: 0 }`.
  - `problems filter keeps only failing items and counts per group` checks that `group.problems` matches the visible failing rows.
  - `an active chip with zero matches yields no groups and shown 0` covers the `skill`/`agent` exception being off while filtered (Review Focus 1).
  - `hides empty groups except Skills and Agents when unfiltered`.
  - `flags disabled MCP, hook and plugin` checks `state.disabled` and `totals.disabled === 3`.
  - `ignores problems on detected items and while health is empty` passes an empty `problems` map and asserts `totals.problems === 0` (Review Focus 4).
  - `tags rows with their folder in a multi-folder workspace` uses `aliases {'/r/api':'api'}` and asserts `folderAlias === 'api'`.
  - `rowBadge precedence` covers 4 cases: problem plus disabled gives `problem`; disabled plus global gives `disabled`; detected gives `detected`; plain global gives `global`.
  - `grandTotal ignores query and filter`.
- [ ] **Step 2: Run** `npx vitest run tests/renderer/lib/customization-tree.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `buildCustomizationTree` and `rowBadge` in `src/renderer/lib/customization-tree.ts` per the rules above, with no React.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `npm run typecheck`. Expected: no errors.

### Task 2: `hook.list` carries `enabled`; tree hook

**Files:**
- Modify: `src/main/application/services/hook-service.ts:177-186` (`toHook` adds `enabled: e.enabled`), the main-side `Hook` type it returns, and `src/renderer/hooks/use-hooks.ts:5` (`enabled?: boolean`, absent on plugin/detected = enabled)
- Modify: `docs/technical/reference/ipc-contract.md` (`hook.list` row: mention `enabled`)
- Create: `src/renderer/hooks/use-customization-tree.ts`
- Test: `tests/main/application/services/hook-service.test.ts` (existing; add a case)

**Interfaces:**
- Consumes: Task 1 `buildCustomizationTree`, `TreeFilter`, `CustomizationTree`. The hook also reads these existing hooks:
  - `useCustomizationList('skill','skill.list')` and `useCustomizationList('agent','agent.list')`
  - `useInstructionsList()` and `usePersonalInstruction()`
  - `useMcpList()` and `useHooks()`
  - `usePluginList('personal')` and `usePluginList('project', !isHome)`
  - `useDetected(['skill','agent'])`, `useEntityHealth()` and `useFolderRouting()`
- Produces: `useCustomizationTree(opts: { isHome: boolean; localScope?: { scope: 'workspace'; scopeId: string }; mcpMatchPath?: string; query: string; filter: TreeFilter }): CustomizationTree`, memoized on its inputs.

- [ ] **Step 1: Write the failing test** `list returns enabled false for a disabled hook`. Save a hook entity with `enabled: false` through the service's fake repo and expect `(await service.list()).find(...)!.enabled === false`.
- [ ] **Step 2: Run** `npx vitest run tests/main/application/services/hook-service.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the `toHook` field and the type changes, then `useCustomizationTree` (plain composition plus one `useMemo`; no test of its own, since Task 3's component tests exercise it).
- [ ] **Step 4: Run** the same test file. Expected: PASS. Then run `npm run typecheck`. Expected: no errors.

### Task 3: Render the tree — `CustomizationsList` and per-kind rows

**Files:**
- Modify: `src/renderer/components/workspace/CustomizationsList.tsx`. Keep the props, the header, the `+ Novo` menu, the dialogs and the handlers. Replace everything from the census on (`:191-` to the end of the body) with: model, chips, groups, footer. Delete `TYPE_GROUPS`/`TYPES`/`RowType`/`Section`, the dead aliases and the stale docstring.
- Modify, to become row components with no list fetching, filtering or census:
  - `EntityTreeGroup.tsx` becomes `EntityTreeRow({ item, inherited, localScope, handlers })`.
  - `McpTreeGroup.tsx` becomes `McpTreeRow({ item })`.
  - `HooksTreeGroup.tsx` becomes `HookTreeRow({ item })`.
  - `PluginsTreeGroup.tsx` becomes `PluginTreeRow({ item })`, a folder row with its existing children.
  - `DetectedTreeGroup.tsx` becomes `DetectedTreeRow({ item })`.
  - `InstructionTreeRow.tsx` takes `item`.

  Each keeps its own context menu state, mutations and `window.confirm`. `seedNewEntity` stays exported.
- Modify: `src/renderer/components/workspace/OriginGroups.tsx`. Keep `PersistedGroup` and delete the rest (`MINE_KEY`, `originKey`, `OriginView`, `bucketByOrigin`, `OriginSection`, `OriginGroups`, `useReportBuckets`). If only `PersistedGroup` remains, move it to `TreeGroup.tsx` and delete the file.
- Modify: `src/renderer/lib/control-panel-filter.ts`. Delete `useReportCount`, `useReportList`, `OriginSegment` and `matchesOrigin` once there are no references left (`grep -rn` to confirm).
- Create: `src/renderer/components/workspace/TreeFilterChips.tsx`, `TreeFilterChips({ value, totals, onChange }: { value: TreeFilter; totals: TreeTotals; onChange: (f: TreeFilter) => void })`.
- Create: `src/renderer/components/workspace/RowBadgeSlot.tsx`, `RowBadgeSlot({ item })`. It renders `ChannelWarning` / `desativado` / `detectado · importar` / `Global` from `rowBadge(item)`.
- Tests: rewrite `tests/renderer/components/workspace/{CustomizationsList,CustomizationsList.detected,EntityTreeGroup,McpTreeGroup,HooksTreeGroup}.test.tsx` against the new ids, and update `tests/renderer/screens/workspace/WorkspaceScreen.test.tsx` where it queries tree ids.

**Interfaces:**
- Consumes: Task 1 types and `rowBadge`; Task 2 `useCustomizationTree`; existing `PersistedGroup` (`storageKey` → `tree-group:${localScope?.scopeId ?? 'home'}:${group.id}`, `forceOpen` while `query.trim() !== '' || filter !== 'all'`, `problems={group.problems}`, `muted` never).
- Produces:
  - DOM ids for e2e: `tree-group-<id>`, `tree-row-<key>`, `chip-<filter>` (`aria-pressed` on the selected one, `disabled` when 0 except `all`), and the existing footer id with `Limpar filtros`.
  - Global rows: ⊕ glyph, dimmed, read-only; their click calls `onOpenInherited` as today.

- [ ] **Step 1: Write the failing component tests** in `CustomizationsList.test.tsx`, reusing the file's existing IPC mocks:
  - `renders type groups with Global items inline` expects `tree-group-skill`, which contains the local row and then the Global row with the `Global` tag.
  - `selecting a chip filters rows and shows "n de N itens"`.
  - `a chip with zero matches is disabled`.
  - `chip stays selected when search empties it and Limpar filtros resets both` (Review Focus 1).
  - `disabled hook row shows desativado`. This was the bug.
  - `disabled MCP row shows desativado`.
  - `problem beats desativado on the same row`.
  - `multi-folder rows show the folder tag`.
  - `Início lists no Global tag`.
  - `opening a Global skill calls onOpenInherited`.

  Port each existing per-group test's menu/mutation assertions to the matching row test file, rendering one row with a `TreeItem` fixture.
- [ ] **Step 2: Run** `npx vitest run tests/renderer/components/workspace tests/renderer/screens/workspace`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the files above. Rows render inside `PersistedGroup` at `depth` 1. Plugin children stay at depth 2, so no item is deeper than 2.
- [ ] **Step 4: Run** the same command, then `npm run lint && npm run typecheck`. Expected: all PASS, no lint errors.

### Task 4: Sincronização section

**Files:**
- Create: `src/renderer/lib/channel-sync.ts`
- Create: `src/renderer/components/ds/ChannelSyncSection.tsx`
- Modify: `src/renderer/components/workspace/PropertiesForm.tsx` (new optional prop `syncUrn?: string`; renders `<ChannelSyncSection urn={syncUrn} />` last when set)
- Modify: `src/renderer/components/workspace/EditorPanel.tsx` (pass `syncUrn={entityUrn(kind, entity.name)}` only when not creating)
- Modify: `src/renderer/screens/mcps/McpEditorDialog.tsx` (render the section when `mode === 'edit'`, urn `entityUrn('mcp', initial.name)`)
- Test: `tests/renderer/lib/channel-sync.test.ts`, `tests/renderer/components/ds/ChannelSyncSection.test.tsx`

**Interfaces:**
- Consumes: `HealthCheck` (`shared/health.ts`), `CHANNEL_IDS`, `CHANNELS`, `channelSupports` (`shared/channel.ts`), `settings.adapters` via `useSettings()`, `useHealthReport('personal')`, `openDiagnosticsFor` (`lib/diagnostics-focus.ts`).
- Produces:

```ts
export type SyncRow =
  | { channel: ChannelId; status: 'ok' | 'problem'; lines: Array<{ path?: string; text: string; remediation?: string }> }
  | { channel: ChannelId; status: 'off' | 'run-only' | 'unchecked' };
export type SyncView = { kind: 'entity-disabled' } | { kind: 'channels'; rows: SyncRow[] };
export function channelSyncRows(input: { urn: string; checks: readonly HealthCheck[]; adapters: Readonly<Record<ChannelId, { enabled: boolean }>>; entityEnabled: boolean }): SyncView;
export function ChannelSyncSection({ urn, entityEnabled = true }: { urn: string; entityEnabled?: boolean }): React.ReactElement | null;
```

Rules:
- Channels in `CHANNEL_IDS` order.
- `!channelSupports(id,'manage')` gives `run-only` ("Só roda sessões, não recebe customizações").
- An adapter that is off gives `off` ("Desativado").
- An enabled channel with no check for the urn gives `unchecked` ("Ainda não sincronizado").
- Otherwise the row status is `problem` if any check has `severity !== 'ok'`.
- Each check becomes one line:
  - ok `symlink` → "Ligado por link simbólico"
  - ok `generated-file` → "Arquivo gerado"
  - ok `merge-entry` → `Entrada em ${basename(target)}`
  - non-ok → `title` (+ `detail`) and `remediation`
- `path` is `target` with the home directory shown as `~`. Use the renderer's existing home-path helper if there is one; otherwise show it raw.
- `entityEnabled: false` → `entity-disabled` ("Desativado — não vai para nenhum canal").
- The component returns `null` while the report is loading or errored (Review Focus 4). Its heading is "Sincronização". Glyphs: `●` ok (verde), `▲` problem (ambar), `—` off/run-only/unchecked (slate). A problem row has an "Abrir diagnóstico" button that calls `openDiagnosticsFor(urn)`.

- [ ] **Step 1: Write the failing tests.**
  - `channel-sync.test.ts`:
    - `ok symlink check reads as link simbólico with its path`
    - `non-ok check becomes a problem row with remediation`
    - `merge entry names its file`
    - `adapter off reads Desativado`
    - `LM Studio is run-only`
    - `enabled channel without a check is unchecked`
    - `disabled entity yields entity-disabled`
    - `checks for other urns are ignored`
  - `ChannelSyncSection.test.tsx`:
    - `renders nothing while the report loads`
    - `Abrir diagnóstico calls openDiagnosticsFor with the urn`
- [ ] **Step 2: Run** `npx vitest run tests/renderer/lib/channel-sync.test.ts tests/renderer/components/ds/ChannelSyncSection.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the files and the three placements. In `McpEditorDialog`, pass `entityEnabled={initial.enabled}`.
- [ ] **Step 4: Run** the same tests plus `tests/renderer/components/workspace` and `tests/renderer/screens/mcps`, then `npm run lint && npm run typecheck`. Expected: PASS.

### Task 5: E2E, product doc, full gate

**Files:**
- Modify: `e2e/product/customizations/{create-and-edit,panel-chrome,home-scope,browse-and-search,channel-warnings,integrations}.spec.ts` (new ids, "Integrações" gone, MCP/Hooks top-level)
- Modify: `docs/product/customizations/create-skills-and-agents.md` § "Read the Customizações tree" + screenshot captions

- [ ] **Step 1: Add e2e cases**:
  - In `browse-and-search.spec.ts`: `Problemas chip narrows the tree and Limpar filtros restores it`.
  - In `home-scope.spec.ts`: `switching scope resets the active chip to Todos` (Review Focus 5). Drive it with a session-free flow: select the `chip-disabled` chip in a workspace, go to Início, return, and expect `chip-all` to be `aria-pressed`.
  - In `integrations.spec.ts`: `disabled MCP shows desativado` and `MCP and Hooks are top-level groups`.
  - Update the remaining specs' selectors.
- [ ] **Step 2: Run** `npm run build && npx playwright test e2e/product/customizations`. Expected: all PASS (run `pkill -f ai-companion-e2e-userdata` first if launch hangs).
- [ ] **Step 3: Update the product doc** to the new shape: type groups, Global inline, chips, row tags, Sincronização.
- [ ] **Step 4: Full gate:** `npm run lint && npm run typecheck && npm test`. Expected: all green. Report what was not verified: dark theme rendering, fonts/glyphs (`⊕ ● ▲`), real health data from a live `~/.claude` / `~/.cursor`.
