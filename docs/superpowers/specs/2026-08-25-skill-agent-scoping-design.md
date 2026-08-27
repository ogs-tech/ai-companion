# Skill / Agent Scoping — Design

- **Date:** 2026-08-25
- **Status:** Draft, pending author review.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** Unlock the `personal | project | workspace` generic scoping that `Instruction` already
  has (see `docs/superpowers/specs/2026-08-22-workspace-project-scope-design.md`) for `Skill` and
  `Agent`, and give the author a way to pick that scope from the Skills/Agents list and editor. It
  does **not** touch Instructions, does not add scope filtering/search to the list, and does not fix
  the pre-existing "delete a Project still referenced by a `scopeId`" gap (see §5).

> Written in English to match `docs/reference/*.md` and `docs/superpowers/specs/*.md` convention. The
> brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

`docs/superpowers/specs/2026-08-22-workspace-project-scope-design.md` generalized `Scope` to
`'personal' | 'project' | 'workspace'` and added `Entity.scopeId`, but explicitly deferred wiring it
up for `Skill`/`Agent` (its §7: "Skill/Agent editor UI for choosing a workspace/project scope — the
schema unlocks in this slice, but their editors keep validating `['personal']` only until a later
pass"). `entity-schema.ts`'s `skillAgentScopes` still hard-pins both kinds to `z.tuple([z.literal
('personal')])`, with a `TODO(follow-up)` comment pointing at exactly this work. This spec is that
later pass.

The author's ask, after using the just-shipped Workspace screen: browsing Skills inside a project
workspace (e.g. `alephee`) didn't make clear which entities were global and which were local to that
project — "preciso que fique claro o que é entidade do projeto o que é entidade global." Investigating
that surfaced a fact worth recording here because it reframes the feature: **workspace-authored
Skills/Agents are already stored per-workspace today** (`FsEntityRepository` is constructed against
`<active workspace>/.ai-companion`, rebuilt on every `workspace.switchTo` — confirmed empirically:
`~/.ai-companion/skills` and every other workspace's `.ai-companion/skills` are all empty on the
author's machine; the 47 items the screenshot showed were 100% plugin-provided, merged in from a
separate, `pluginService`-owned cache that stays anchored to whichever workspace was active at app
startup, independent of switching). So `scopes: ['personal']` for a Skill/Agent today does not mean
"global across every workspace" — it means "not scoped to a specific `Project` inside the active
workspace," and its *sync* destination (`~/.claude/skills/<name>`, fixed home path) is what actually
makes it visible to `claude` regardless of which AI Companion workspace happens to be active. The real
gap is a second, narrower tier: scoping an entity down to one `Project` (or explicitly to the whole
active workspace) the same way `Instruction` already can.

## 2. Decisions made during brainstorming

1. **Single scope, not multi.** A Skill/Agent belongs to exactly one of `personal` / `project` /
   `workspace` — never several at once. This mirrors `Instruction`'s existing discriminated-by-
   `scopes[0]` model exactly, rather than the multi-value array the original (pre-restriction) schema
   comment left open (`"scopes accept ['project'] / ['personal', 'project']"`). Considered and
   rejected: letting a single entity sync to multiple destinations at once — real flexibility, but it
   roughly doubles the surface of the editor UI and the adapter fan-out logic for a need nobody has
   asked for yet (YAGNI).
2. **Three tiers, parity with `Instruction`.** `personal | project | workspace`, not just
   `personal | project`. A workspace-tier entity is useful on its own (a skill meant for every project
   inside one client's workspace, without being tied to one repo) and costs nothing extra to add now
   that the schema/adapter plumbing for it already exists from the Instruction work.
3. **Storage location is unaffected by scope.** The canonical `SKILL.md`/`AGENT.md` file always lives
   in the *active AI Companion workspace's* `.ai-companion/skills|agents/<name>/` — exactly as today,
   regardless of the entity's `scopes` value. `scopeId` only changes where the adapter **syncs** the
   entity to (§3). This is a direct consequence of §1: storage was already workspace-scoped before
   this spec; this spec only adds a second axis (sync destination) on top of it.
4. **A `workspace`-scoped entity's `scopeId` is always the active workspace's own id.** Because
   storage already lives inside that workspace, there is no mechanism (and no requested need) for
   authoring an entity in one AI Companion workspace that targets a *different* workspace's sync
   destination. This simplifies the editor (no workspace picker needed — selecting "Workspace" needs
   no further input) and the list badge (no cross-workspace name lookup needed).
5. **List UI: single list, per-item scope badge — not split sections.** Rejected mirroring
   `InstructionsScreen`'s "Personal card + Project Instructions list" split: Skill/Agent lists are
   flat collections of many items (47 today) where a personal/project split would mostly duplicate the
   existing `EntityDataGrid`. Instead, `CustomizationListScreen` gains one more `FieldDef` with
   `badge: true` (the same mechanism `HookList`'s `event` column already uses — plain `Chip`, no new
   component), showing `Personal`, the resolved `Project` name, or `Workspace`.
6. **Editor UI: single-select toggle, not the existing checkbox group.** `CustomizationEditor`'s
   current `scope` field is a `Checkbox`/`FormGroup` multi-select (vestigial today — `scopeOptionsFor`
   returns a single `['personal']` option for skill/agent, so the checkbox can only be toggled off into
   an invalid empty array; Instructions never render this field at all, since both its hidden-field
   sets include `'scope'`). This is replaced, for skill/agent only, with a three-way
   `ToggleButtonGroup exclusive` (Personal / Workspace / Project) — already an available MUI import in
   that file. Instruction's editor is untouched: it keeps deciding scope via its two existing entry
   points (the Personal card vs. "Nova Project Instruction"), which already works and isn't part of
   this ask.
7. **Project picking reuses the existing Instructions flow verbatim.** Selecting "Project" in the new
   toggle reveals a `Select` populated from `useProjects()` (the active workspace's project registry,
   already fetched elsewhere in the app) plus a "+ Novo project" action that calls the same
   `dialog.selectFolder` → `project.findOrCreateByPath` sequence `InstructionsScreen.openProjectCreate`
   already uses. No new IPC method, no new picker component.
8. **Creation flow stays single-entry-point.** Unlike Instructions (two buttons, each pre-deciding
   scope), Skills/Agents keep their one "+ Novo" action; `blankCustomization` keeps defaulting to
   `scopes: ['personal']`, and the author changes scope via the new toggle inside the editor, not by
   picking a different button before opening it. Simpler than adding a second entry point for a screen
   that doesn't have Instructions' natural personal-singleton/project-list split.
9. **Duplicating an entity keeps its `scopeId`.** `duplicateCustomization` today copies every field
   except identity/timestamps; scope-related fields (`scopes`, `scopeId`) are left as-is by that same
   spread, so a duplicated project-scoped skill stays scoped to the same project. No new logic needed
   — noted here so it's an explicit decision, not an accident of what didn't get excluded.

## 3. Architecture

No new bounded context, no new IPC methods — this slice extends code the Instruction work already
built and deliberately left the skill/agent branch of.

- **`entity-schema.ts`:** `skillAgentScopes` changes from `z.tuple([z.literal('personal')])` to
  `z.tuple([z.enum(['personal', 'project', 'workspace'])])`, with a `superRefine` requiring a
  non-empty `scopeId` when `scopes[0] !== 'personal'` and forbidding it otherwise — the same rule
  `instructionEntitySchema` already enforces, minus the "name must be `'default'`" clause (Skill/Agent
  have no personal-singleton naming constraint).
- **`ClaudeAdapter` / `CursorAdapter`:** both already accept `workspaceService`/`projectService` in
  their constructors and already call `resolveScopePath` for the instruction branch of
  `resolveEntityDestinations` (`claude-adapter.ts`, the block right before the skill/agent one). The
  skill/agent branch — currently `if (scopes.includes('personal')) { …fixed home path… }` with the
  `TODO(follow-up)` comment marking exactly this gap — gains the same `project`/`workspace` handling:
  resolve `scopeId` via `resolveScopePath`, then symlink to
  `<resolved path>/.claude/skills/<name>` (or `.claude/agents/<name>.md`) for Claude, and
  `<resolved path>/.cursor/skills/<name>` (or `.cursor/agents/<name>.md`) for Cursor.
- **`SkillService` / `AgentService`:** unchanged. `list(scope)` already ignores its `scope` param and
  returns everything in the active workspace's repository (merged with plugin-provided entities);
  `save`/`delete` already pass the full entity/id through without inspecting `scopes`. Filtering
  and display are a list-screen concern, not a service one.
- **`CustomizationListScreen.tsx`:** one more `FieldDef<Entity>` (`key: 'scope', badge: true`),
  rendered via a small resolver: `personal` → `"Personal"`; `workspace` → `"Workspace"`; `project` →
  the matching entry's `name` from `useProjects()` (added to this screen, same hook Instructions/
  WorkspaceScreen already use), falling back to the raw `scopeId` if the project was deleted out from
  under it (see §5).
- **`CustomizationEditor.tsx`:** `scopeOptionsFor('skill' | 'agent')` returns the 3-tuple instead of a
  1-tuple; the existing `Checkbox`/`FormGroup` block becomes, for skill/agent only, a
  `ToggleButtonGroup exclusive` bound to `entity.scopes[0]`. Choosing "Project" reveals a `Select`
  (options from a newly-added `useProjects()` call in this component) with a trailing "+ Novo
  project…" `MenuItem` wired to `dialog.selectFolder` → `useFindOrCreateProjectByPath()` (both already
  exist, already used by `InstructionsScreen`). Choosing "Workspace" sets `scopeId` to
  `useActiveWorkspace().data.id` directly — no picker. Instruction's own branch of this component
  (`hiddenFields` always including `'scope'`) is untouched.
- **`blank-customization.ts`:** no signature change; `blankCustomization('skill' | 'agent')` keeps
  returning `scopes: ['personal']` with no `scopeId`.
- **Docs:** `docs/reference/customization-schema.md` (drop the "temporarily restricted" language for
  Skill/Agent scopes) and `CLAUDE.md` (its "Skill/agent `scopes: ['project']` is temporarily
  rejected…" line is now stale and gets removed).

## 4. Data flow

1. **Browse the list:** author opens Skills or Agents inside whichever workspace is active →
   `skill.list`/`agent.list` returns that workspace's own entities plus merged plugin ones, same as
   today → each row now additionally shows a `Personal` / project-name / `Workspace` chip.
2. **Create a project-scoped skill:** "+ Novo" → editor opens defaulted to `Personal` → author toggles
   to `Project` → picks an existing `Project` from the dropdown, or "+ Novo project" →
   `dialog.selectFolder` → `project.findOrCreateByPath` → dropdown now includes and selects it → save
   → `skill.save` writes `scopes: ['project'], scopeId: project.id` → `SKILL.md` still lands under the
   active workspace's own `.ai-companion/skills/<name>/` (§2.3) → sync fires →
   `ClaudeAdapter.resolveEntityDestinations` resolves `scopeId` via `resolveScopePath` to the
   project's path → symlinks `<project.path>/.claude/skills/<name>`.
3. **Create a workspace-scoped skill:** same flow, toggle to `Workspace` → no picker (§2.4) →
   `scopeId` set to the active workspace's own id → sync destination
   `<workspace.rootPath>/.claude/skills/<name>`.
4. **Switch the active AI Companion workspace:** unchanged from today — the entity repository swaps,
   the list shows a different set of workspace-authored entities (plus plugin ones, always present).
   No new behavior; scope badges just make the existing per-workspace split visible for the first
   time.
5. **Delete a `Project` still referenced by a scoped Skill/Agent's `scopeId`:** no new guard added
   (§5) — the badge falls back to the raw `scopeId`, and the next sync/spawn against that entity fails
   with `not_found` via `resolveScopePath`, exactly like an orphaned project-scoped Instruction does
   today.

## 5. Error handling

- `resolveScopePath` given a `scopeId` whose `Project`/`Workspace` no longer exists → `DomainError
  ('not_found')` at sync time, surfaced through the existing sync-report path (`SaveSkillResult
  .syncReport` / `SaveAgentResult.syncReport`) — no new error handling code, this path already exists
  for Instructions and Skill/Agent go through the same adapters.
- Zod `superRefine` rejects a save with `scopes[0] !== 'personal'` and no `scopeId`, or `scopes[0]
  === 'personal'` with one present — same shape of error Instructions already surface today via
  `EntityValidator`.
- **Known, pre-existing gap this spec does not fix:** deleting a `Project` or non-default `Workspace`
  has no reference-check against any entity's `scopeId` (`ProjectService.delete`/`WorkspaceService
  .delete` today only guard "not found" / "not the active workspace" — confirmed by reading both
  services). This was already true for project-scoped Instructions before this spec; Skill/Agent
  inherit the identical behavior, not a new or worse one. Fixing it is a cross-cutting change (any
  `Entity`, not Skill/Agent-specific) better tracked as its own follow-up than folded into this slice.
- List screen: a `scope: 'project'` item whose `scopeId` doesn't match any entry in `useProjects()`
  (the orphan case above) renders the raw `scopeId` in the badge rather than crashing or hiding the
  row — same "degrade visibly, don't hide data" precedent `ProjectInstructionRow` already sets today
  (`resolvedPath ?? 'Projeto não encontrado'`).

## 6. Testing

- `node`: `entity-schema.test.ts` gains skill/agent cases mirroring the existing instruction ones —
  accepts `personal` with no `scopeId`, accepts `project`/`workspace` with one, rejects
  `project`/`workspace` with a missing/empty `scopeId`, rejects `personal` carrying one.
- `node`: `claude-adapter.entity-destinations.test.ts` / `cursor-adapter.entity-destinations.test.ts`
  gain skill/agent cases for all three scopes, mirroring the existing instruction cases in the same
  files (including the not-found-project rejection case).
- `node`: `SkillService`/`AgentService` — no new tests needed beyond what already exists, since their
  behavior is unchanged (§3); existing `save`/`delete`/`list` coverage already exercises the pass-
  through paths this spec relies on staying inert.
- `jsdom`: `CustomizationListScreen.test.tsx` — new cases asserting the scope badge renders `Personal`
  / a resolved project name / `Workspace`, and the orphaned-`scopeId` fallback.
- `jsdom`: `customization-editor.test.tsx` — new cases for the `ToggleButtonGroup` (switching tiers
  updates `entity.scopes[0]`), the project `Select` populating from `useProjects()`, the "+ Novo
  project" flow reusing `dialog.selectFolder`/`findOrCreateProject`, and confirming the Instruction
  branch is untouched (its scope field stays hidden as today).

## 7. Explicitly out of scope (for this spec)

- Filtering or searching the Skills/Agents list by scope — the badge is visual only for this slice
  (§2.5); a dedicated filter can follow if it turns out to be needed once real project-scoped entities
  exist.
- Fixing the pre-existing "delete a referenced Project/Workspace" gap (§5) — cross-cutting, tracked as
  a separate follow-up.
- Any change to `Instruction`'s editor or list UI — both are already shipped and working; this spec
  only reuses their existing `Project`-picking plumbing.
- A "workspace" scope value whose `scopeId` points at a workspace other than the active one (§2.4) —
  not requested, and storage being workspace-local makes it structurally awkward to support without a
  much bigger change (cross-workspace entity references).
- Multi-scope entities (one Skill synced to more than one destination at once) — considered and
  rejected in §2.1.
- Re-deriving or caching a resolved path on the entity itself — `resolveScopePath` stays a
  resolve-at-use-time helper, exactly as Instructions already established.
