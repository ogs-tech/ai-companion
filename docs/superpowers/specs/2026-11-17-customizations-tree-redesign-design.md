# Customizations tree redesign — design

Date: 2026-11-17 · Status: awaiting approval

## Intent

The Customizações panel is hard to navigate and says little about sync state. Items take 3–4 levels to
reach (Workspace › Integrações › MCP › server), Global items hide behind a collapsed, dimmed section, and
the only state a row shows is `⚠ <channel>`. Two goals, chosen by the user: **find and navigate** faster,
and **see state and sync** at a glance — modelled on VS Code's Extensions view.

Underneath, the panel's counts flow *up* from leaf components through invisible "census" instances
(`CustomizationsList.tsx:196-311`, `OriginGroups.tsx:63-77`): each type list is mounted 2–3 times, the
parent sets state during render (`:157`), and multi-folder workspaces count a second, separate way
(`originCount`, `:385`). That structure is what makes any filter or regrouping expensive, so the redesign
starts by replacing it.

## Goals

- Group by **type** at the top level; at most 2 levels to any item.
- Global items listed **inline** in the same type groups (⊕, dimmed, `Global` tag), read-only as today.
- **State filters** as chips: Todos · ⚠ Problemas N · Desativados N · Detectados N. They combine with the
  text search (AND).
- Rows show only the **exception**: `⚠ <channels>`, `desativado`, `detectado · importar`. Silence = ok.
- A **Sincronização** section showing, per channel, destination path, status and reason, with
  "Abrir diagnóstico".
- One pure, unit-tested tree model; no census, no counts reported upward.

## Non-goals

- Delete flow: the four `window.confirm` calls stay (`EntityTreeGroup:125`, `HooksTreeGroup:65`,
  `PluginsTreeGroup:96`, `InstructionTreeRow:138`). Undo-toast is a **separate follow-up change**.
- No main-process / IPC change: the health report already carries one check per destination, ok ones
  included, with `channel`, `target` (path) and `entityUrn` (`symlink-collector.ts:64-79`,
  `merge-entry-collector.ts:25`, `generated-file-collector.ts:82`).
- No hook editor (none exists in the renderer); no `EntityDataGrid` reuse (built for the main area).
- No change to editing/creating flows, context-menu actions, or the `+ Novo` menu contents.

## Anti-goals

- Status noise: a long list must not become a grid of dots. Ok is silent.
- A label that lies: counts and chips must equal what the list shows under the same filter.
- Losing what exists today: plugin read-only, inherited items opening read-only with "Editar no Início",
  detected items importable, per-group collapse state remembered.

## Approaches

1. **Pure tree model (chosen).** `useCustomizationTree({ scope, query, filter })` reads every query once
   (skills, agents, instructions, MCP, hooks, plugins, detected, health) and hands them to
   `buildCustomizationTree()` in `lib/`, which returns groups › items with origin, state, counts and
   filter totals. Components only render. Filters become a `filter` over the model; counts are unit tests.
   Cost: larger diff in `CustomizationsList` and the `*TreeGroup` files; tree test ids in e2e/unit tests
   change.
2. **Regroup the existing per-type components.** Smaller diff, but keeps the census root cause; each
   chip adds another upward callback, and inline Global needs each type mounted twice per section.
   Rejected for that reason.
3. `EntityDataGrid` in the panel — rejected: wrong form factor for a 300 px side panel.

## Design (as decided)

### Layout (mockup A, approved in the visual companion)

```
Customizações 14                    ＋
[⌕ Buscar por nome ou descrição      ]
(Todos) (⚠ Problemas 2) (Desativados 1) (Detectados 1)
▾ Instruções                         2
    workspace
    ⊕ pessoal                   Global
▾ Skills                             5
    commit-msg
    review-pr                ⚠ Cursor
    ⊕ tdd                       Global
    legacy-skill   detectado · importar
▸ Agents                             2
▾ MCP                                2
    sentry                  desativado
▸ Hooks                              1
▸ Plugins                         1  ⚠
14 itens, 4 do Global
```

- Group order: Instruções, Skills, Agents, MCP, Hooks, Plugins. "Integrações" is gone (MCP and Hooks are
  their own groups).
- Within a group: the scope's own items first (alphabetical), then Global items (alphabetical), then
  detected items. A group with zero items under the current filter is hidden, except Skills and Agents
  when no filter/search is on (they are the create affordance, as today via `alwaysShown`).
- **Multi-folder workspace:** the folder is a row tag (`commit-msg · api`, via `routing.aliases`), not a
  tree level. The per-folder instruction row stays in Instruções, tagged with its folder.
- **Início:** same type tree, no Global inline (everything there is Global/personal).
- **Plugins:** one closed folder row per plugin, as today; what a plugin provides is listed only inside
  it. A plugin child's problem rolls up to the plugin row (`rollUpToPlugins`, unchanged).
- Footer: `N itens` / `N itens, G do Global`; while filtered, `n de N itens` + "Limpar filtros"
  (clears search and chip).

### Row states

| State | Source | Row shows |
|---|---|---|
| Problem | non-ok health check with `entityUrn` + `channel` | `⚠ Claude · Cursor` (existing `ChannelWarning`) |
| Disabled | `McpEntity.enabled === false`, `HookEntity.enabled === false`, plugin `enabled === false` | dimmed + `desativado` tag |
| Detected | `detected.*` item not yet imported | `detectado · importar` tag (blue), existing import action |
| Global (in a workspace) | entity not of the local scope | ⊕ glyph, dimmed, `Global` tag; read-only |

Precedence on the single trailing slot: Problem > Disabled > Detected > Global tag. Fixes today's bug where
a disabled hook looks active (`HooksTreeGroup` ignores `enabled`).

### Filter chips

- Single-select: Todos (default) · ⚠ Problemas · Desativados · Detectados. Chip counts are computed on the
  search-filtered set, so a chip's number equals what selecting it shows. A chip with count 0 stays
  visible but disabled (place doesn't move). Not persisted; reset on scope switch like the search.
- While a chip or search is active, groups are force-open (as `forceOpen={searching}` today).

### Sincronização section (mockup A, approved)

`ChannelSyncSection({ urn })` lists, for each channel in registry order with the `manage` capability:

- `● Claude` + destination path + "Ligado por link simbólico" / "Arquivo gerado" / "Entrada em mcp.json"
  for ok checks (from `category`);
- `▲ Cursor` + path + the check's `title`/`detail` + `remediation`, and "Abrir diagnóstico"
  (`openDiagnosticsFor(urn)`) for non-ok checks;
- `— <channel>` "Desativado" when the channel's adapter toggle is off; run-only channels (LM Studio)
  are listed as "Só roda sessões, não recebe customizações";
- an entity with `enabled: false`: one line "Desativado — não vai para nenhum canal";
- while the health report loads: nothing (same silence rule as `useEntityHealth`).

Placed in: `PropertiesForm` (skill, agent, instruction) and `McpEditorDialog` in edit mode. Hooks: none
(no editor); their row ⚠ still opens Diagnósticos.

### Model (implementation shape)

- `src/renderer/lib/customization-tree.ts` — pure:
  `buildCustomizationTree(input, { isHome, localScope, routing, query, filter }) → { groups, totals }`,
  `groups: Array<{ id, label, items: TreeItem[], count, problems }>`,
  `TreeItem = { urn, kind, name, origin: 'local'|'global'|'detected'|'plugin', folderAlias?, state:
  { problems: ChannelId[], disabled: boolean }, entity }`,
  `totals: { all, global, problems, disabled, detected }`.
- `src/renderer/hooks/use-customization-tree.ts` — calls the existing query hooks once each and memoizes
  the build.
- `CustomizationsList` renders groups via `PersistedGroup`/`TreeSubGroup` and delegates each row to a
  per-kind row component that keeps its own context menu and mutations (entity, instruction, MCP, hook,
  plugin, detected). Census, `OriginView`, `useReportBuckets`, `useReportCount`/`useReportList` in the
  tree, and `OriginGroups`' bucket mode are removed; anything left unused is deleted.
- Collapse keys: `tree-group:<scopeId|home>:<groupId>`. Old keys are simply ignored.

## Left to the builder

- Exact test ids (keep `control-panel-*` ones; new: `tree-group-<id>`, `tree-row-<urn>`, `chip-<filter>`),
  then update the affected unit tests (`tests/renderer/components/workspace/{CustomizationsList*,
  EntityTreeGroup,McpTreeGroup,HooksTreeGroup}.test.tsx`, `WorkspaceScreen.test.tsx`) and e2e specs
  (`e2e/product/customizations/*.spec.ts`).
- Whether per-kind row components stay in today's files or move; no behaviour change either way.
- Update `docs/product/customizations/create-skills-and-agents.md` § "Read the Customizações tree" and its
  screenshots' captions to the new shape.

## Verification

Lint, typecheck, unit tests (new `customization-tree.test.ts` covering grouping, precedence, filters,
multi-folder tags, Início), `npm run build` + the customizations e2e specs. Not verifiable by tests: dark
theme rendering, real health data from a live `~/.claude`/`~/.cursor` — to be reported as such.

## Follow-ups

- Undo-toast delete replacing the four `window.confirm` (separate change).
