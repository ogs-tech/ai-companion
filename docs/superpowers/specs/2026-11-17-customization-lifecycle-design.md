# Customization lifecycle consolidation — design

Date: 2026-11-17 · Status: awaiting approval · Research: `2026-11-17-channel-customizations-research.md`

## Intent

Customization management grew one kind at a time, in both the BE and the UI. Each kind has its own verbs, and the
panel exposes a different subset of them under different names:

| Kind | Edit | Enable/disable | Delete | Import (detected) | Install over / undo |
|---|---|---|---|---|---|
| Skill / Agent | Properties | no `enabled` in the model | `confirm()` "Excluir" | yes | badge only |
| Instruction | Properties | — | `confirm()` "Remover" | "Aplicar…" | yes |
| MCP | dialog | `mcp.setEnabled` | yes | yes | yes |
| Hook | **no editor** (`hook.save`/`hook.get` unused) | only through save, no toggle | `confirm()` | yes | yes |
| Plugin | `plugin.createOwned`/`deleteOwned` unused in UI | `plugin.toggle` | "Remover" | `plugin.import` | "Reconciliar" |

The user wants **both the BE and the UI consolidated** into a single customization lifecycle: every kind follows the
same model, exposes the same verbs with the same names, and the UI is a faithful view of what the BE supports.

Research shows the channels themselves are not uniform either (per-item toggles exist only for MCP and Claude skills;
precedence differs per kind and per channel; plugins are packages; Cursor reads Claude's `.claude/skills`,
`.claude/agents` and hooks natively). The model below is therefore ours, chosen so it can be expressed truthfully on
every channel.

## Goals

- One **kind registry** declaring what each customization kind supports; menus, editors and validators derive from it.
- One verb set, same labels everywhere: **Editar · Ativar/Desativar · Excluir · Importar · Instalar por cima / Desfazer**.
- `enabled` on every entity; disabled = removed from every channel (the only uniform expression).
- **Plugin is an origin, not a kind**: a package with its own verbs; its items appear in their type groups, read-only.
- **The app decides which channel gets what** (user chose option A in the visual companion): no per-item channel
  choice. `AdapterManager` resolves destinations across channels jointly, so nothing a channel already reads natively
  is written twice.
- A **Canais** section in every editor that says truthfully where and how each channel receives the item.

## Non-goals

- Per-item channel targeting (option B, rejected: two controls per item, and "☐ Cursor" would lie while Cursor imports
  `.claude/`).
- Plugin authoring (`plugin.createOwned`/`deleteOwned`/`publish`) — stays as it is; whether to wire or remove the
  unused pair is a follow-up.
- Changing the status model (Instalado / Draft / Com erro, per-channel breakdown) — kept as implemented.
- Exposing channel-native precedence ("which one wins") — not shown; it differs per kind and channel.
- The adapter defects listed under Follow-ups.

## Anti-goals

- A label that lies: "Desativado", "Instalado", and the Canais section must match what the channel actually loads.
- Losing behaviour that exists: inherited Global items read-only with "Editar no Início", plugin items read-only,
  detected items importable, install-over with undo, collapse state.
- A verb shown for a kind that can't do it (a disabled menu item for an unsupported verb is noise — omit it).

## Approaches

1. **Kind registry + uniform entity verbs + joint destination resolution (chosen).** Shared `CUSTOMIZATION_KINDS`
   registry like `src/shared/channel.ts`; `enabled` on the base `Entity`; one `entity.setEnabled`; `AdapterManager`
   asks every enabled adapter for destinations, then drops destinations another channel already covers.
   Cost: touches the Entity schema, every repository's (de)serialization, both adapters, and every tree row.
2. **UI-only unification.** Same menu labels, hide missing verbs per kind. Rejected: leaves skill/agent/instruction
   without `enabled` and the hook without an editor — the inconsistency the user wants gone is in the BE.
3. **Per-item channel targeting.** Rejected in the visual companion (option B).

## Design (as decided)

### 1. Kind registry — `src/shared/customization-kind.ts`

```ts
type CustomizationVerb = 'edit' | 'toggle' | 'delete' | 'import' | 'installOver';
interface CustomizationKindSpec {
  kind: EntityKind;              // 'instruction' | 'skill' | 'agent' | 'mcp' | 'hook'
  label: string;                 // group label: 'Instruções', 'Skills', …
  verbs: readonly CustomizationVerb[];
  editor: 'properties' | 'mcp-dialog' | 'hook-dialog';
}
export const CUSTOMIZATION_KINDS: readonly CustomizationKindSpec[];
```

All five kinds declare all five verbs, except the personal instruction singleton, which cannot be deleted (rule kept
from today, expressed as a per-item check, not a per-kind one). Group order in the tree = registry order. Row menus,
the `+ Novo` menu and the IPC validators read it; no `kind === …` branches for verb availability in components.

Read-only items (origin Global inside a workspace, or plugin) show **Abrir** (and "Editar no Início" for Global) instead
of the verbs — same as today.

### 2. `enabled` on every entity

- `Entity.enabled: boolean` on the base interface; `McpEntity`/`HookEntity` lose their own field.
- Storage: skill/agent frontmatter key `enabled: false` (absent = true, so existing files are unchanged and no
  migration runs); instruction in the sidecar / a Global-side sidecar for the singleton (builder picks the file, absent
  = true); MCP/hook JSON already carry it.
- Must not leak to channels: skill/agent frontmatter written or linked to a channel is the canonical file — since the
  key is only written when false, and disabled entities are never materialized, a channel never sees it.
- IPC: `entity.setEnabled { urn, enabled }` replaces `mcp.setEnabled` (removed). Disabling = `AdapterManager` removes
  every destination (existing `enabled === false` path, now typed); enabling = sync.
- `CustomizationStatusService` already maps disabled → `draft/disabled`; it now applies to every kind.

### 3. Uniform verbs and labels

| Verb | Label | Today's name(s) replaced |
|---|---|---|
| edit | Editar | Properties, Editar, (none for hook) |
| toggle | Desativar / Ativar | (MCP only) |
| delete | Excluir | Excluir, Remover |
| import | Importar | Importar, Aplicar … |
| installOver | Instalar por cima · Desfazer | badge-only |

- **Excluir** becomes optimistic hide + undo toast, replacing the four `window.confirm` (`EntityTreeRow`,
  `HookTreeRow`, `InstructionTreeRow`, `PluginTreeRow`). The delete IPC is called when the toast expires; Desfazer
  restores the row. (User preference: undo toast over confirmation dialogs.)
- "New Action" and "Preview" items in today's menus: Preview stays as **Abrir**; "New Action" is reviewed by the
  builder and dropped if it isn't a lifecycle verb (it then belongs to the `+ Novo` menu).
- **Hook editor**: `HookEditorDialog`, same shape as `McpEditorDialog` (event, matcher, command, timeout, enabled),
  using the existing `hook.get`/`hook.save`. Event list = `hook-translation.ts`'s supported events.

### 4. Plugin as an origin

- The "Plugins" tree group becomes **Plugins (origem)**: one row per plugin (`<name> · N itens`, `ativo`/`desativado`),
  verbs **Atualizar · Ativar/Desativar · Remover** (`plugin.update`/`toggle`/`remove`), no expansion.
- A plugin's items are listed in their kind groups with a plugin tag (`brainstorming  superpowers`), read-only, like
  Global items. Disabling the plugin hides nothing; its items show `draft · desativado`.
- "Reconciliar" is removed from the row; if its function is still needed it becomes Atualizar (builder confirms what
  `Reconciliar` calls today).

### 5. Joint destination resolution

- `AdapterManager` computes destinations per entity across all enabled `manage` adapters, then applies
  **coverage rules**: a destination is dropped when another enabled channel's destination is already read natively by
  this channel. Rules live in the channel registry (`src/shared/channel.ts`), e.g. Cursor declares
  `reads: { skill: ['claude'], agent: ['claude'], hook: ['claude'] }`.
- Initial rules (from research): Cursor reads Claude's skills, agents and hooks. Instructions and MCP are not covered —
  Cursor still gets its own `.mdc` and `mcp.json` entries.
- A covered channel reports `installed` with reason "lê o arquivo do Claude" and the Claude path, as long as the
  covering destination is ok; if Claude's destination fails, the covered channel shows the same error.
- **Toggling Claude off** removes the coverage, so Cursor's own destinations are written on the next sync (and vice
  versa) — the toggle triggers a sync already.
- Existing `.cursor/skills`, `.cursor/agents` and `.cursor/hooks.json` entries the app owns are removed by the next
  sync, through the normal ownership checks (never a user's own file).
- **Fallback (my call):** `settings.adapters.cursor.readsClaudeConfig: boolean`, default `true` (mirrors Cursor's
  "Include Third-Party Plugins, Skills, and Other Configs", on by default, whose storage we can't read). Shown in
  Config › Canais › Cursor as one switch "O Cursor importa as configurações do Claude"; off = no coverage, Cursor gets
  its own copies as today.

### 6. Canais section

`ChannelSyncSection` (exists) is placed in **every** editor — Properties (skill, agent, instruction), MCP dialog,
hook dialog — and adds the covered line: `● Cursor — lê o mesmo arquivo do Claude · .claude/skills/tdd`.
Run-only channels: "Só roda sessões". Disabled entity: one line "Desativado — não vai para nenhum canal".

## Phases (one change, implemented in this order; one commit by the user at the end)

1. Kind registry + `enabled` on `Entity` + `entity.setEnabled` (remove `mcp.setEnabled`).
2. Joint destination resolution + `readsClaudeConfig` setting.
3. Hook editor + Canais section everywhere.
4. Tree/menus from the registry, plugin as origin, undo-toast delete.

Each phase leaves lint, typecheck and tests green. If the diff grows beyond review size, phases 1–2 (BE) and 3–4 (UI)
can be split into two changes — the builder says so before starting phase 3.

## Docs to update

`docs/technical/customizations/reference/customization-schema.md` (`enabled`), `ipc-contract.md`
(`entity.setEnabled`, removed `mcp.setEnabled`), `architecture.md` + `channels/reference/adapter-targets.md`
(coverage), `docs/technical/customizations/how-to/add-an-entity-kind.md` (registry), the product page for the
Customizações tree, and CLAUDE.md's Adapters bullet.

## Left to the builder

- Where the instruction's `enabled` is stored (sidecar vs. frontmatter-free file constraint).
- Test ids for new menu items and the hook dialog; updates to affected unit and e2e specs.
- Whether `Reconciliar` and `New Action` map to an existing verb or are removed (check what they call).

## Verification

Lint, typecheck, unit tests: registry, `enabled` round-trip per repository, coverage rules in `AdapterManager`
(Claude on/off, `readsClaudeConfig` on/off, ownership-safe cleanup), status for disabled skill/agent/instruction,
undo-toast delete. `npm run build` + customizations e2e (toggle, delete-undo, hook edit, plugin row). Not verifiable
by tests: whether Cursor actually loads the Claude copies (third-party import), dark theme — reported as such.

## Follow-ups (listed, not in this change)

- Cursor plugin hack at `~/.cursor/plugins/air-ide/` vs the documented `~/.cursor/plugins/local/`.
- Detection of Claude local-scope MCP (`~/.claude.json` → `projects[<path>].mcpServers`).
- `.mcp.json` servers pending approval in Claude while our status says Instalado.
- `~/AGENTS.md` possibly loaded twice by Claude in projects without CLAUDE.md.
- Possible write races with Claude on `~/.claude.json`.
- `plugin.createOwned`/`deleteOwned`: wire into the UI or remove.
- LM Studio `~/.lmstudio/mcp.json` (not reachable by `lms chat` today).
