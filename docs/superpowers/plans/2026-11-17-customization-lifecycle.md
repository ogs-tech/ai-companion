# Customization Lifecycle Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every customization kind follows one lifecycle (Editar · Ativar/Desativar · Excluir · Importar · Instalar por cima/Desfazer), driven by a kind registry, with `enabled` on every entity and channel destinations resolved jointly so Cursor never gets a second copy of what it already reads from Claude.

**Architecture:** A shared `CUSTOMIZATION_KINDS` registry (sibling of `src/shared/channel.ts`) feeds row menus, `+ Novo` and validators. `enabled` moves to the base `Entity`; one `entity.setEnabled` IPC replaces `mcp.setEnabled`. `AdapterManager` resolves destinations for all enabled adapters at once and drops (and removes, ownership-safe) the ones a coverage rule declared in the channel registry says another channel already serves; health copies the covering channel's verdict onto the covered one.

**Tech Stack:** Electron + TypeScript (strict, ESM `.js` imports), React + MUI, react-query, Vitest (node + jsdom projects), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-17-customization-lifecycle-design.md` (research: `docs/superpowers/specs/2026-11-17-channel-customizations-research.md`)

## Global Constraints

- **No commits.** The user makes one commit at the end (CLAUDE.local.md overrides the skill's per-task commit). Each task ends with "leave the tree for review", not `git commit`.
- Lint + typecheck + relevant tests green at the end of every task (`npm run lint`, `npm run typecheck`, `npx vitest run <files>`).
- Labels verbatim: **Editar · Desativar / Ativar · Excluir · Importar · Instalar por cima · Desfazer**; plugin row: **Atualizar · Ativar/Desativar · Remover**; read-only rows: **Abrir** (+ **Editar no Início** for Global).
- Copy verbatim: covered line `lê o mesmo arquivo do Claude`; run-only `Só roda sessões`; disabled `Desativado — não vai para nenhum canal`; Cursor switch `O Cursor importa as configurações do Claude`.
- `enabled` is written to disk **only when `false`**; absent = `true`. No migration runs.
- A verb a kind/item can't do is **omitted**, never shown disabled.
- No `window.confirm` in customization rows after Task 8.
- Initial coverage: Cursor reads Claude's `skill`, `agent`, `hook`. `instruction` and `mcp` are never covered.
- `settings.adapters.cursor.readsClaudeConfig`: absent = `true`.
- Services depend on ports only; imports use `.js`; `exactOptionalPropertyTypes` is on.

## Decisions the spec left to the builder (taken here — review them)

1. **Instruction `enabled` storage:** workspace instruction → `enabled: false` key in its `meta.json` (`InstructionSidecar.enabled?: false`). Personal singleton → new sidecar `instructions/default.meta.json` containing `{ "enabled": false }`, deleted when re-enabled. The instruction body stays frontmatter-free.
2. **Reconciliar** (`PluginTreeRow.tsx:159`) is `onClick={closeMenu}` — a no-op. Removed, not mapped.
3. **New Action** opens a session referencing the item (`WorkspaceScreen.tsx:778-790`). It is not a lifecycle verb, and it can't move to `+ Novo` (it needs a target). Dropping it loses existing behaviour (anti-goal), so it **stays**, label unchanged, below a divider after the lifecycle verbs. ⚠ Confirm with the user before Task 9.
4. **`entity.setEnabled` addressing:** `{ urn }` resolved through the current scope's canonical `EntityService`, same precedence `mcp.setEnabled` uses today (inherited Global rows are read-only in a workspace, so they never reach it).
5. **Toggle triggers a full sync:** `adapter.setEnabled` (both directions) and the new `adapter.setReadsClaudeConfig` run `syncAll({})` unfiltered, because coverage makes one channel's state change another's destinations.

## Review Focus

1. **Claude toggled off with Cursor on** — Cursor must get its own `.cursor/skills|agents|hooks.json` copies on the same action, not on some later sync. Test in Task 5.
2. **A user's own file at a covered Cursor path** (`.cursor/skills/tdd` not created by the app) — the coverage cleanup must leave it. Test in Task 5.
3. **Disabled skill opened in a channel's own UI** — `enabled: false` must never reach a channel file; a disabled entity has no destinations at all. Test in Task 2 (serializer omits key when true) and Task 5 (disabled → no destinations, covered or not).
4. **Delete then switch scope / close the panel before the undo window ends** — the pending delete must commit, not vanish. Test in Task 8.
5. **Plugin disabled** — its skills/agents rows must show `draft · desativado`, not disappear and not show Instalado. Test in Task 9.

---

### Task 1: Kind registry

**Files:**
- Create: `src/shared/customization-kind.ts`
- Test: `tests/shared/customization-kind.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CustomizationVerb = 'edit' | 'toggle' | 'delete' | 'import' | 'installOver';
  export interface CustomizationKindSpec { kind: EntityKind; label: string; verbs: readonly CustomizationVerb[]; editor: 'properties' | 'mcp-dialog' | 'hook-dialog' }
  export const CUSTOMIZATION_KINDS: readonly CustomizationKindSpec[];   // order: instruction, skill, agent, mcp, hook
  export function kindSpec(kind: EntityKind): CustomizationKindSpec;     // throws on unknown
  export function itemVerbs(entity: Pick<Entity, 'kind' | 'name' | 'scopes'>): readonly CustomizationVerb[]; // drops 'delete' for the personal instruction singleton
  export const VERB_LABEL: Record<Exclude<CustomizationVerb, 'toggle'>, string>; // edit→'Editar', delete→'Excluir', import→'Importar', installOver→'Instalar por cima'
  export function toggleLabel(enabled: boolean): 'Desativar' | 'Ativar';
  ```
  Labels: `Instruções`, `Skills`, `Agentes`, `MCP`, `Hooks` — copy the current strings from `GROUPS` in `src/renderer/lib/customization-tree.ts:120` so the tree text doesn't change.

- [ ] **Step 1: Failing tests** — `CUSTOMIZATION_KINDS.map(k => k.kind)` equals `['instruction','skill','agent','mcp','hook']`; every spec has all five verbs; `kindSpec('hook').editor === 'hook-dialog'`, `kindSpec('mcp').editor === 'mcp-dialog'`, others `'properties'`; `itemVerbs({ kind: 'instruction', name: 'default', scopes: ['personal'] })` does not contain `'delete'` and a workspace instruction does; `toggleLabel(true) === 'Desativar'`.
- [ ] **Step 2:** `npx vitest run tests/shared/customization-kind.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement the module (use `isPersonalInstruction` semantics: `scopes[0] === 'personal'`).
- [ ] **Step 4:** Same command → PASS. Make `GROUPS` in `customization-tree.ts` derive its non-plugin entries from `CUSTOMIZATION_KINDS` (plugin group stays appended, relabeled in Task 9). Run `npx vitest --project jsdom tests/renderer/lib` → PASS.
- [ ] **Step 5:** Leave the tree for review.

### Task 2: `enabled` on every entity (model + storage)

**Files:**
- Modify: `src/shared/entity.ts` (base `Entity.enabled: boolean`; remove it from `McpEntity`/`HookEntity`; `InstructionSidecar.enabled?: false`)
- Modify: `src/main/application/schemas/entity-schema.ts` (base schema `enabled: z.boolean()`; drop the two per-kind ones at `:115`, `:127`)
- Modify: `src/main/application/entity/entity-serializer.ts` (skill/agent frontmatter)
- Modify: `src/main/infrastructure/entity/fs-entity-repository.ts` (instruction sidecars), `in-memory-entity-repository.ts` if it constructs entities
- Modify: every place that builds an `Entity` (typecheck lists them — plugin helpers, detection import, seeds, fixtures under `src/main/application/services/__fixtures__` and `tests/`)
- Test: `tests/main/application/entity/entity-serializer.test.ts`, `tests/main/infrastructure/entity/fs-entity-repository.test.ts`

**Interfaces:**
- Produces: `Entity.enabled: boolean` (required). Plugin and detected entities are `enabled: true`.

- [ ] **Step 1: Failing tests**
  - serializer: `renderEntityFile(skill({ enabled: false }))` frontmatter contains `enabled: false`; with `enabled: true` the output has **no** `enabled` key (byte-identical to today's render); `parseEntityFile` of a file without the key → `enabled === true`; with `enabled: false` → `false`. Same pair for agent.
  - repository: save + get round-trip `enabled: false` for skill, agent, workspace instruction (assert `meta.json` has `"enabled": false`, and has no `enabled` key after re-enabling), personal instruction (assert `instructions/default.meta.json` exists with `{"enabled":false}` and is gone after re-enabling; `default.md` body unchanged in both). MCP/hook round-trip still passes.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement. Serializer: add `'enabled'` to the skill/agent key lists, emit only when `false`, parse `frontmatter['enabled'] !== false`. Repository: personal sidecar path = `join(dirname(personalInstructionFile), 'default.meta.json')`; ENOENT → enabled; write with `writeFileAtomic`, remove with `rm({ force: true })`. Workspace: add `...(entity.enabled ? {} : { enabled: false })` to the sidecar; `parseSidecar` keeps `enabled: false` when present.
- [ ] **Step 4:** Run both files → PASS; `npm run typecheck` → fix every construction site (add `enabled: true`) until clean; `npm test` → PASS.
- [ ] **Step 5:** Leave the tree for review.

### Task 3: `entity.setEnabled` + status for every kind

**Files:**
- Modify: `src/main/application/services/entity-service.ts` (add `setEnabled`)
- Create: `src/main/ipc/entity-handlers.ts`; Modify: `src/main/ipc/registry.ts` / `src/main/index.ts` to register it
- Modify: `src/main/ipc/mcp-handlers.ts`, `src/main/application/services/mcp-service.ts` (delete `setEnabled` + `mcp.setEnabled`)
- Modify: `src/main/application/services/customization-status-service.ts` (disabled subjects for skill/agent/instruction)
- Modify: `src/renderer/hooks/use-mcp-mutations.ts` (remove `useSetMcpEnabled`); Create: `src/renderer/hooks/use-set-entity-enabled.ts`
- Modify: `src/renderer/components/workspace/McpTreeRow.tsx:41,71` to use the new hook
- Test: `tests/main/application/services/entity-service.test.ts`, `tests/main/ipc/entity-handlers.test.ts`, `tests/main/application/services/customization-status-service.test.ts`, `tests/renderer/components/workspace/McpTreeRow.test.tsx`

**Interfaces:**
- Consumes: `Entity.enabled` (Task 2).
- Produces:
  - `EntityService.setEnabled(input: { urn: string; enabled: boolean }): Promise<SaveEntityResult>` — `get` → `not_found` if missing; plugin source → `OperationNotAllowedForOriginError({ origin: 'plugin', operation: 'save' })`; otherwise `save({ entity: { ...current, enabled } })` (which already routes disabled → `AdapterManager.removeEntity`).
  - IPC `entity.setEnabled { urn: string; enabled: boolean } → { ok: true; syncReport: SyncResult[] }` (validate with `asObject`/`asString`, boolean check like `adapter.setEnabled`).
  - Status deps gain `entities: () => Promise<Entity[]>` (own canonical entities of the current scope); each `enabled === false` → `DISABLED`.
  - Renderer: `useSetEntityEnabled(): UseMutationResult<{ ok: true }, Error, { urn: string; enabled: boolean }>` invalidating every customization list query key + `HEALTH_QUERY_ROOT` + the status query.

- [ ] **Step 1: Failing tests** — service: setEnabled false on a skill saves `enabled: false` and calls `removeEntity`; on a plugin skill throws `OperationNotAllowedForOriginError`; unknown urn → `DomainError('not_found')`. IPC: missing `enabled` → `kind: 'validation'`; `mcp.setEnabled` → `kind: 'not_found'` (dispatcher unknown method). Status: a disabled skill, agent and workspace instruction each report `draft`/`disabled`. McpTreeRow: clicking `Desativar` calls `callIpc('entity.setEnabled', { urn: 'urn:mcp:github', enabled: false })`.
- [ ] **Step 2:** Run the four files → FAIL.
- [ ] **Step 3:** Implement; wire `entities` dep in `src/main/index.ts` from the canonical entity service's `list`.
- [ ] **Step 4:** Run the four files → PASS; `npm run typecheck && npm run lint` clean.
- [ ] **Step 5:** Update `docs/technical/architecture/reference/ipc-contract.md` (add `entity.setEnabled`, remove `mcp.setEnabled`) and `docs/technical/customizations/reference/customization-schema.md` (`enabled` on every kind, storage per kind incl. `default.meta.json`). Leave the tree for review.

### Task 4: Coverage rules + `readsClaudeConfig` setting

**Files:**
- Modify: `src/shared/channel.ts` (descriptor field + pure resolver)
- Modify: `src/shared/settings.ts` (`AdapterSettings.readsClaudeConfig?: boolean`)
- Test: `tests/shared/channel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // ChannelDescriptor
  readonly reads?: Partial<Record<EntityKind, readonly ChannelId[]>>;  // cursor: { skill: ['claude'], agent: ['claude'], hook: ['claude'] }
  /** The channel whose destinations `covered` reads natively for `kind`, or undefined. `served` = channels that produced a non-skip destination for this entity. */
  export function coveringChannel(args: { covered: ChannelId; kind: EntityKind; settings: Pick<Settings, 'adapters'>; served: ReadonlySet<ChannelId> }): ChannelId | undefined;
  ```
  Rule: returns the first `p` in `CHANNELS[covered].reads?.[kind]` with `settings.adapters[p].enabled && served.has(p)`, and only if `settings.adapters[covered].readsClaudeConfig !== false`.

- [ ] **Step 1: Failing tests** — cursor/skill with claude enabled+served → `'claude'`; claude disabled → `undefined`; claude enabled but not in `served` → `undefined`; `readsClaudeConfig: false` → `undefined`; absent → `'claude'`; cursor/mcp and cursor/instruction → `undefined`; claude/skill → `undefined`.
- [ ] **Step 2:** `npx vitest run tests/shared/channel.test.ts` → FAIL.
- [ ] **Step 3:** Implement (`channel.ts` imports `type EntityKind` from `./entity.js`; `settings.ts` already imports from `channel.ts` — import `Settings` as a type only to avoid a value cycle).
- [ ] **Step 4:** Same → PASS; typecheck clean.
- [ ] **Step 5:** Leave the tree for review.

### Task 5: Joint destination resolution in `AdapterManager`

**Files:**
- Modify: `src/main/application/services/adapter-manager.ts`
- Modify: `src/main/ipc/registry.ts` (`adapter.setEnabled` → unfiltered `syncAll({})` after the settings merge, in both branches; new `adapter.setReadsClaudeConfig`)
- Test: `tests/main/application/services/adapter-manager.test.ts` (new `describe('coverage')`), `tests/main/ipc/registry.test.ts` or the existing adapter handler test

**Interfaces:**
- Consumes: `coveringChannel` (Task 4).
- Produces:
  - `private async resolveJoint(entity: Entity, adapters: Adapter[], settings): Promise<{ active: Array<{ adapterId: string; dest: AdapterDestination }>; covered: Array<{ adapterId: string; coveredBy: ChannelId; dest: AdapterDestination; coveringDestination: string }> }>` — resolves every adapter, computes `served`, splits by `coveringChannel`. `coveringDestination` = first non-skip destination of the covering adapter.
  - `syncAll`, `syncEntity`, `planDestinations`, `planGeneratedFiles`, `planMergeDestinations`, `countDestinations` use `active` only. `syncAll`/`syncEntity` call `removeDestination` for each `covered` entry (ownership-safe cleanup of the app's old copies). `removeEntity`, `removeAll`, `removeAdapter*` keep resolving every adapter unfiltered.
  - `async planCoverage(): Promise<CoveragePlanEntry[]>`, `export interface CoveragePlanEntry { adapterId: string; entityUrn: string; coveredBy: ChannelId; destination: string }` (destination = the covering one).
  - `syncAll`'s `adapterId` filter limits writes to that adapter but `covered` removal still runs for every enabled adapter.
  - IPC `adapter.setReadsClaudeConfig { enabled: boolean } → { syncReport: SyncResult[] }` = `settingsService.merge({ adapters: { cursor: { readsClaudeConfig: enabled } } })` then `syncAll({})`.

- [ ] **Step 1: Failing tests** (fake adapters + in-memory symlink/materializer fakes already used in this file):
  - claude+cursor on, skill → claude symlink written, no cursor destination written; `planDestinations()` has no cursor entry; `planCoverage()` has `{ adapterId: 'cursor', coveredBy: 'claude', destination: <claude path> }`.
  - same with an MCP and an instruction → both channels written.
  - `readsClaudeConfig: false` → cursor skill destination written.
  - claude off → cursor skill written; a previously app-owned cursor symlink is kept/written.
  - **Review Focus 1:** handler `adapter.setEnabled { adapterId: 'claude', enabled: false }` with cursor on → the cursor skill destination exists after the call returns.
  - **Review Focus 2:** an app-owned cursor skill symlink and a user's own file at another cursor skill path; after `syncAll` with coverage on → the owned link is removed, the user's file is untouched.
  - **Review Focus 3:** a disabled skill → no destinations, nothing in `planCoverage()`.
- [ ] **Step 2:** `npx vitest run tests/main/application/services/adapter-manager.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Keep the per-entity resolve-error degradation from `syncAll` (`symlinkError`) inside `resolveJoint`'s callers.
- [ ] **Step 4:** Same + handler test → PASS; `npm test` → PASS (existing health/collector tests must still pass: they consume the plan methods).
- [ ] **Step 5:** Update `docs/technical/architecture/reference/architecture.md` and `docs/technical/channels/reference/adapter-targets.md` (coverage rules, who reads what, the setting) and CLAUDE.md's Adapters bullet. Leave the tree for review.

### Task 6: Covered status in health + Cursor switch

**Files:**
- Create: `src/main/application/services/health/coverage.ts`
- Modify: `src/main/application/services/health/health-service.ts` (apply after collectors), `src/main/index.ts` (pass `planCoverage`)
- Modify: `src/shared/health.ts` (`HealthCheck.coveredBy?: ChannelId`)
- Modify: `src/renderer/screens/config/ChannelPage.tsx` (switch on the Cursor page)
- Test: `tests/main/application/services/health/coverage.test.ts`, `tests/renderer/screens/config/ChannelPage.test.tsx`

**Interfaces:**
- Consumes: `CoveragePlanEntry`, `planCoverage()` (Task 5).
- Produces: `export function applyCoverage(checks: readonly HealthCheck[], coverage: readonly CoveragePlanEntry[]): HealthCheck[]` — for each entry, copy every check with `entityUrn === entry.entityUrn && channel === entry.coveredBy`, giving it `id: \`${check.id}:covered:${entry.adapterId}\``, `channel: entry.adapterId`, `coveredBy: entry.coveredBy`, `target: entry.destination`; when the covering channel has no check for that urn, add none (status falls back to the covering channel's absence, same as today's "installed").

- [ ] **Step 1: Failing tests** — ok claude check → a cursor copy with `coveredBy: 'claude'` and same `severity`/status verdict; error claude check → the cursor copy is an error too (spec: "the covered channel shows the same error"); no coverage → checks unchanged. ChannelPage (Cursor): switch labelled `O Cursor importa as configurações do Claude`, checked by default, toggling calls `callIpc('adapter.setReadsClaudeConfig', { enabled: false })`; the switch is absent on the Claude page.
- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both → PASS; `npx vitest run tests/main/application/services/customization-status-service.test.ts` → PASS (a covered skill reports `installed` on cursor).
- [ ] **Step 5:** End of the BE half. Report the diff size to the user and ask whether to split BE (Tasks 1–6) from UI (Tasks 7–10) into two changes, as the spec requires before phase 3. Leave the tree for review.

### Task 7: Hook editor + Canais section in every editor

**Files:**
- Create: `src/renderer/screens/hooks/HookEditorDialog.tsx`
- Modify: `src/main/application/services/hook-service.ts:70-103` + `src/main/ipc/hook-handlers.ts` (`hook.save` accepts optional `enabled`, default `existing?.enabled ?? true`)
- Modify: `src/main/application/entity/hook-translation.ts` (export `SUPPORTED_HOOK_EVENTS: readonly string[]` if not already exported)
- Modify: `src/renderer/components/ds/ChannelSyncSection.tsx` (covered line, run-only line, single disabled line)
- Modify: `src/renderer/components/workspace/PropertiesForm.tsx:129` (pass `entityEnabled`), `src/renderer/screens/mcps/McpEditorDialog.tsx:112`
- Modify: `src/renderer/components/workspace/HookTreeRow.tsx` (Editar opens the dialog)
- Test: `tests/renderer/screens/hooks/HookEditorDialog.test.tsx`, `tests/renderer/components/ds/ChannelSyncSection.test.tsx`, `tests/main/application/services/hook-service.test.ts`

**Interfaces:**
- Produces: `HookEditorDialog(props: { open: boolean; mode: 'create' | 'edit'; initial?: Hook; scope: Scope; onClose(): void; onSaved(hook: Hook): void })` — fields event (select from `SUPPORTED_HOOK_EVENTS`), matcher, command (`handler.command`), timeout (`handler.timeout`, seconds, optional), enabled switch; saves via `hook.save`; edit mode loads with `hook.get` and renders `<ChannelSyncSection urn={entityUrn('hook', id)} entityEnabled={…} />`. Mirror `McpEditorDialog`'s layout, validation and error display. Test ids: `hook-editor-dialog`, `hook-editor-event`, `hook-editor-matcher`, `hook-editor-command`, `hook-editor-timeout`, `hook-editor-enabled`, `hook-editor-save`.
- `ChannelSyncSection` rows: covered check → `● Cursor — lê o mesmo arquivo do Claude · <relative path>`; a `run`-only channel → `Só roda sessões`; `entityEnabled === false` → the single line `Desativado — não vai para nenhum canal` and nothing else.

- [ ] **Step 1: Failing tests** — dialog create: fill event `PreToolUse`, matcher `Bash`, command `./check.sh`, save → `callIpc('hook.save', …)` with those values and `enabled: true`; empty command blocks save; edit mode shows the Canais section. Section: covered check renders the covered copy; disabled renders only the disabled line; LM Studio renders `Só roda sessões`. hook-service: `save({ …, enabled: false })` persists `false`.
- [ ] **Step 2:** Run the three files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; `npx vitest run tests/renderer/components/workspace/HookTreeRow.test.tsx tests/renderer/components/workspace/PropertiesForm*` → PASS.
- [ ] **Step 5:** Leave the tree for review.

### Task 8: Undo-toast delete

**Files:**
- Create: `src/renderer/hooks/use-undoable-delete.ts`
- Modify: `src/renderer/components/workspace/CustomizationsList.tsx` (own the hook + one `Toast`, pass `requestDelete` to rows, filter `pendingKeys` out of rendered items)
- Modify: `EntityTreeRow.tsx:66`, `HookTreeRow.tsx:28`, `InstructionTreeRow.tsx:141`, `PluginTreeRow.tsx:60` (replace `window.confirm` with `requestDelete`)
- Test: `tests/renderer/hooks/use-undoable-delete.test.ts`, the four row tests

**Interfaces:**
- Produces:
  ```ts
  export const UNDO_DELETE_WINDOW_MS = 6000;   // same as SessionsTreeGroup's UNDO_WINDOW_MS
  export function useUndoableDelete(): {
    pendingKeys: ReadonlySet<string>;
    requestDelete(args: { key: string; message: string; commit: () => Promise<unknown> }): void;
    toast: ToastMessage | null; dismissToast(): void;
  };
  ```
  Messages: `"<name>" excluído` (entities, hooks, instructions), `Plugin "<id>" removido`. Commit error → row reappears + error toast. Unmount flushes (commits) every pending delete — same rule as `SessionsTreeGroup.tsx:303`.

- [ ] **Step 1: Failing tests** (fake timers) — `requestDelete` adds the key to `pendingKeys` and doesn't call `commit`; after 6000 ms `commit` called once and key cleared; `Desfazer` before 6000 ms → `commit` never called, key cleared; commit rejects → key cleared, error toast. **Review Focus 4:** unmount before 6000 ms → `commit` called. Rows: clicking `Excluir` calls `requestDelete`, and `window.confirm` is never called (spy).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Keep `SessionsTreeGroup` as is (moving it onto this hook is a refactor — list it, don't do it).
- [ ] **Step 4:** Run hook + four row tests → PASS.
- [ ] **Step 5:** Leave the tree for review.

### Task 9: Row menus from the registry; plugin as origin

**Files:**
- Create: `src/renderer/components/workspace/customization-menu.ts`
- Modify: `EntityTreeRow.tsx`, `InstructionTreeRow.tsx`, `McpTreeRow.tsx`, `HookTreeRow.tsx`, `DetectedTreeRow.tsx` (menus built by the helper), `PluginTreeRow.tsx` (origin row), `CustomizationsList.tsx` (`+ Novo` menu from the registry; plugin group label)
- Modify: `src/renderer/lib/customization-tree.ts` (plugin group label `Plugins (origem)`, plugin items not expandable, plugin-sourced skill/agent/mcp/hook items carry `pluginTag: string` and `disabled: true` when their plugin is disabled)
- Test: `tests/renderer/components/workspace/customization-menu.test.ts`, `tests/renderer/lib/customization-tree.test.ts`, `PluginTreeRow.test.tsx`, `CustomizationsList.test.tsx`

**Interfaces:**
- Consumes: `CUSTOMIZATION_KINDS`, `itemVerbs`, `VERB_LABEL`, `toggleLabel` (Task 1); `useSetEntityEnabled` (Task 3); `requestDelete` (Task 8); `HookEditorDialog` (Task 7).
- Produces:
  ```ts
  export interface MenuContext { item: TreeItem; enabled: boolean; readOnly: false | 'global' | 'plugin'; detected: boolean; canInstallOver: boolean; hasUndo: boolean }
  export interface MenuAction { key: CustomizationVerb | 'undo' | 'open' | 'edit-home' | 'new-action'; label: string }
  export function customizationMenu(ctx: MenuContext): MenuAction[];
  ```
  Rules: `readOnly` → `[open]` plus `edit-home` (`Editar no Início`) when `'global'`; `detected` → `[open, import]`; otherwise `itemVerbs` mapped in order edit, toggle, delete, installOver (only when `canInstallOver`; `undo` → `Desfazer` only when `hasUndo`); `new-action` last when the row supports it (Decision 3). Rows render with `RowContextMenu`; no `kind === …` branch decides which verbs appear.
  Plugin row: `<id> · N itens` + `ativo`/`desativado`; menu `Atualizar` (`plugin.update`), `Ativar`/`Desativar` (`plugin.toggle`), `Remover` (via `requestDelete` → `plugin.remove`). No `Reconciliar` (Decision 2).

- [ ] **Step 1: Failing tests** — menu: skill own → labels `['Editar','Desativar','Excluir','New Action']`; personal instruction → no `Excluir`; global in workspace → `['Abrir','Editar no Início']`; plugin item → `['Abrir']`; detected → `['Abrir','Importar']`; installable → contains `Instalar por cima`. Tree: plugin group label `Plugins (origem)`; plugin `superpowers` disabled → its skill `brainstorming` item has `pluginTag: 'superpowers'` and `isDisabled(item) === true` (**Review Focus 5**). PluginTreeRow: menu has no `Reconciliar`; shows `· 3 itens`. CustomizationsList: `+ Novo` lists the five registry labels in registry order.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. "Aplicar…" on detected instructions becomes `Importar`; `Properties` becomes `Editar`; `Remover` on entities becomes `Excluir`.
- [ ] **Step 4:** `npx vitest --project jsdom` → PASS; `npm run lint && npm run typecheck` clean.
- [ ] **Step 5:** Leave the tree for review.

### Task 10: e2e + product docs

**Files:**
- Modify/Create: `e2e/product/customizations/lifecycle.spec.ts` (new), update `create-and-edit.spec.ts`, `plugin-import.spec.ts`, `integrations.spec.ts` for renamed labels / removed `confirm` handlers
- Modify: `docs/product/…` page for the Customizações tree (find via `grep -rl "Customizações" docs/product`), `docs/technical/customizations/how-to/add-an-entity-kind.md` (registry step)

- [ ] **Step 1:** Write `lifecycle.spec.ts`: (a) skill → Desativar → row shows `desativado`, `~/.claude/skills/<name>` gone → Ativar → back; (b) Excluir → row hidden → Desfazer → row back and file still there; Excluir again and wait → file gone; (c) hook: `+ Novo › Hook`, fill the dialog, save, row appears, Editar changes matcher; (d) plugin row shows `Plugins (origem)`, `Desativar` → its items show `desativado`. Use the existing fixtures; no stub-looking data.
- [ ] **Step 2:** `npm run build && npx playwright test e2e/product/customizations` (if Electron won't launch: `pkill -f ai-companion-e2e-userdata`) → PASS.
- [ ] **Step 3:** Update the docs listed above.
- [ ] **Step 4:** Full gate: `npm run lint && npm run typecheck && npm test` → all green.
- [ ] **Step 5:** Report to the user: what passed, and what was **not** verified — whether Cursor actually loads the Claude copies (third-party import), dark theme, visual look of the hook dialog and covered line. Leave the tree for the user's single commit.
