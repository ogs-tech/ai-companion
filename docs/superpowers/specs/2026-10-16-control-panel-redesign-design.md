# Control Panel redesign — Sessions first, unified Customizations

Date: 2026-10-16 · Status: draft for review
Area: `src/renderer/components/workspace/ControlPanelContent.tsx` (right panel of `WorkspaceScreen`)

## Intent

The Control Panel mixes two kinds of content with opposite usage patterns: **Sessions** (live, used constantly) and **Customizations** (edited rarely). Today Sessions sit *below* four always-visible tree groups, inside their own accordion capped at 300px with its own scroll, in a panel that is only 200–420px wide. The panel therefore has three independent scroll/collapse behaviours, and Skills/Agents are listed twice (own group plus "Herdado do Global").

Goal: make Sessions the primary content and make Customizations a single, searchable, filterable list that shows each item once, with its scope.

## Decisions (made with the user)

1. **Sessions come first** and take the main space of the panel. (Option A of the layout mockups: same panel, inverted order.)
2. **Customizations are one unified list** (option H2):
   - Search field + "＋" (new) button + type chips.
   - Two sections: **"Neste workspace"** and **"Do Global"** (collapsed by default). The type of each row is shown as an icon/badge, not as a group header.
   - Chips: **Tudo · Skills · Agents · Integrações**. Integrações contains hooks, MCP servers and plugins, each keeping its own scope.
3. The standalone "Herdado do Global" block disappears; Global items are the "Do Global" section and stay **read-only** inside a workspace (open via `onOpenInherited`, same as today).

## Goals

- Sessions visible and scannable without scrolling past configuration.
- One scroll area per section, no nested accordions with fixed pixel caps.
- Every customization appears exactly once.
- No behaviour change to what rows do (open, preview, properties, new-action, session open/remove/see-all/new).

## Non-goals

- No change to IPC, services, schema or `Entity` model.
- No change to the Explorer panel, the Workbench canvas or `SessionPanel` (the terminal tab).
- No new filter dimensions (status, recency) and no sorting options.
- Hooks/MCP/Plugins data hooks are reused as they are.

## Anti-goals

- Don't make Customizations harder to reach than today's one click.
- Don't re-introduce a second place that lists Global skills/agents.
- Don't let the Global section become editable inside a workspace.

## Behaviour

- **Scope header** (`Kicker`: "Global" / "Workspace · name") stays at the top.
- **Sessions block:** header "Sessões" with "＋ Nova sessão" (disabled when `canStartSession` is false), rows from `SessionsTreeGroup`, footer "Ver todas →". It keeps the collapse toggle, but with no 300px cap: Sessions and Customizations share the panel height, each scrolling on its own. Split ratio and minimum heights are left to the builder.
- **Customizations block:**
  - At **Início** (`isHome`) there is a single section, "Global", editable.
  - In a **workspace**: "Neste workspace" (editable) then "Do Global" (collapsed, read-only).
  - Chips filter by type; "Tudo" is the default. Chips may show counts (builder's call).
  - **Search** matches name and description across both sections and expands "Do Global" when it has hits. Empty result shows an empty state.
  - **"＋"** creates a new item. For a type filter selected, it creates that type; on "Tudo" it opens a small menu (Skill, Agent, Instruction). Instruction only offers workspace creation where it is allowed today (`seedWorkspaceInstruction`); the personal singleton is not creatable twice.
  - Row interactions are the existing ones: edit/open, preview, properties, new-action (`onEditEntity`, `onPreviewEntity`, `onEntityProperties`, `onNewActionForEntity`, instruction equivalents, `onOpenInherited`).
- **Integrações chip:** lists hooks, MCP and plugins as rows with a type badge. Reuses the data hooks behind `HooksTreeGroup`, `McpTreeGroup` and `PluginsTreeGroup` (including `mcpMatchPath` and `isProjectContext`). Whether those components are refactored into row-only components or wrapped is the builder's call.

## Constraints

- Strict TS flags, `.js` import extensions, MUI + Emotion tokens from `src/renderer/theme.ts`, existing design-system pieces in `components/ds/` (`Kicker`, `TreeRow`, `Icon`).
- Keep `ControlPanelContent`'s props contract unless a prop becomes unused; the call site in `WorkspaceScreen.tsx` should change minimally.
- Preserve existing `data-testid`s where the element survives (`workspace-customizations`, `control-panel-kicker`, `workspace-sessions-panel`, `workspace-sessions-new`, `workspace-sessions-collapse`, `workspace-instruction-row-*`); add testids for the new search, chips and sections.
- Green lint, typecheck and tests are a release gate. Update `tests/renderer` for the affected components; add tests for filtering by chip, search across scopes, read-only Global section, and Início (single section).
- Update docs that describe this panel (`docs/reference/architecture.md` if it mentions it).
- One commit, no co-author trailer (user's global rule).

## Left to the builder

- Exact height split between Sessions and Customizations, minimum heights, and whether Sessions collapse hands its space to Customizations.
- Chip counts, empty-state copy, and the "＋" menu look.
- Whether `EntityTreeGroup`/`TreeGroup` are reused, generalized or replaced by a flat-row component.
- Persistence of the chosen chip and the Global section's expanded state (per session of the app is enough).

## My calls (not discussed — please check)

- Search covers name + description only, across both scopes.
- Chip selection and search text are local UI state, reset on workspace switch.
- Integrações rows show a type badge and open the same destinations as today.
- Mockups used for validation live in `.superpowers/brainstorm/` (git-ignored).
