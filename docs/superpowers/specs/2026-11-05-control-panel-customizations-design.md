# Control Panel — Customizations tree, Instructions at every level, session status

Date: 2026-11-05 · Status: draft for approval · Language of UI copy: pt-BR

Approved mockup (option A): `2026-11-05-control-panel-customizations-mock/customizations-tree.html` (open in a browser; it also shows the rejected option B and today's tree).

## Why

In a multi-folder workspace (e.g. `vendors-bees-adapter`, `ui-core`, `core-services`, `vendors-integration` under one workspace) the user needs rules that apply to the whole group and rules that apply to one repository. Today:

1. Instructions exist only at Global and workspace level; a folder of a multi-folder workspace cannot have its own, although Skills and Agents already can (`Entity.folder`, `src/shared/entity.ts:44`).
2. The Customizations tree (`CustomizationsList.tsx`) is inconsistent: folders and scopes share one icon, Global has a lock, `instructions` is a lone leaf while other kinds are counted groups, and an unexplained amber spine marks one row.
3. Global is labelled "Do Início".
4. Running sessions (Claude and Cursor) show "Iniciando" forever and never reflect that the agent is working or idle.

## Goals

- One tree with identical structure at every level; a single status indicator; icons that carry meaning.
- Instructions at three levels — Global, Workspace, Folder (project) — each adapted for Claude and for Cursor.
- Global is called "Global" in the tree.
- A session's pill reflects what it is doing (starting → running states: working / idle / needs input) for both harnesses.

## Non-goals

- No new scope. `Scope` stays `'personal' | 'workspace'`; "project" is a *folder* of a workspace, as for Skills/Agents. Single-folder workspaces get no per-folder level.
- No change to Skills/Agents/MCP/Hooks behaviour, plugins, or the Início *screen* name.
- No precedence engine in the app: layering is delegated to how Claude and Cursor already read files from parent directories (see Materialization).
- Anti-goal: overwriting a file the user owns.

## Tree design (approved: option A "Por camada")

Order top to bottom: **Workspace**, then one group per folder (multi-folder only), then a separator, then **Global**.

Every level (Workspace, each folder, Global) has the same rows, always present, in this order:

| Row | Icon (lucide) | Right side |
|---|---|---|
| Instructions | `scroll-text` | Claude / Cursor chips + status dot |
| Skills | `sparkles` | count |
| Agents | `bot` | count |
| Integrações (MCP + hooks) | `plug` | count |
| Plugins — Global only | `package` | count |

Level headers: Workspace = `layers`, folder = `git-branch`, Global = `globe`. No folder icons, no lock.

- **Status dot** is the only indicator; the per-kind amber spine on these rows is removed. Green = synced to all enabled harnesses; amber = pending/out of date for at least one; hollow ring = not created; blue ring with a dot = detected (file found, not yet applied), and the row's right side offers "Aplicar". A chip is green when that harness's file is in sync, neutral when not (or when the harness adapter is disabled in settings, then the chip is hidden).
- Rows with zero items stay, dimmed, so the place to create stays fixed. Folders with nothing are collapsed and dimmed.
- Global rows are read-only inside a workspace (as today); the tooltip "Somente leitura aqui — edite no Início" moves to the Global header. Wording "Do Início" becomes "Global" everywhere in this tree and its tooltips. The *screen* "Início" keeps its name.
- Instructions row: a leaf that opens the level's instruction (or the create flow when hollow). Extra workspace instructions that already exist keep working and appear as children; the row then gets a chevron. (Builder note: this is a deliberate compromise to avoid migrating existing data.)
- **Where the status comes from (decided by the user):** *synced* is verified on disk, never inferred from a cached Sync report, so a file changed outside the app flips the dot. Main exposes a read-only `adapter.entitySyncStates` → `Record<urn, 'synced' | 'pending'>`: an entity is `synced` only when every destination of every enabled harness is in place (symlink points to our source, generated/merged entry matches); `skip` destinations are ignored; an entity with nothing to materialize has no dot. *Detected* comes from the existing `detected.list`. Document the method in `ipc-contract.md`.
- Search keeps forcing sections open and hiding empty ones, as today.

## Instructions at three levels

Data: add optional `folder` to workspace `Instruction`s with the same meaning as `Entity.folder` (absolute path of a workspace folder). No `folder` = workspace-wide. Sidecar `meta.json` carries it; a folder instruction lives at `instructions/project/<slug>/` like any workspace instruction (legacy dir name stays). `instruction-service` / `EntityService` routing is unchanged (`scopes === ['workspace']` + `scopeId`).

Materialization (extends the existing `resolveEntityDestinations` pattern, `claude-adapter.ts:33-50`; Cursor mirrors the existing workspace `.mdc`):

| Level | Claude (symlink) | Cursor (write, marker-owned) |
|---|---|---|
| Global | `~/.claude/CLAUDE.md`, `~/AGENTS.md` (unchanged) | `~/.cursor/plugins/ai-companion/` (unchanged) |
| Workspace | `<primary root>/.claude/CLAUDE.md`, `<primary root>/AGENTS.md` (unchanged) | `<root>/.cursor/rules/<name>.mdc` (unchanged) |
| Folder | `<folder>/.claude/CLAUDE.md`, `<folder>/AGENTS.md` | `<folder>/.cursor/rules/<name>.mdc` (`alwaysApply: true`) |

Layering is native: inside `<folder>`, both harnesses read the folder file and the ancestors' files.

**Existing files → "detected" mode (decided by the user).** If a destination already holds a file the app does not own (not our symlink, not our marker), the app never overwrites it. The level's Instructions row enters the same *detected* state Skills/Agents/MCP/Hooks already have (`detection-service`, `detected.*` IPC; read-only until imported), and the user chooses:

- **Aplicar** (import): the detected file's content becomes the level's Instruction, opens for editing, and from then on the app owns the destination (original backed up under `_backups/` before it is replaced by the symlink/marked file — my call, reusing the existing backup dir).
- **Criar do zero:** starts an empty Instruction. While the foreign file still occupies the destination, materialization for that destination stays `skip` with a Sync-report warning naming the file, so nothing is lost silently; the user resolves it by importing or by explicitly replacing (with backup) — my call on how this last step is offered.

Detection must therefore learn Instructions, which it does not cover today: per level, look at `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md` and `.cursor/rules/*.mdc` that are not app-owned (Global: `~/.claude/CLAUDE.md`, `~/AGENTS.md`). Extend `detection-service` / `detected.*` rather than adding a parallel mechanism; document it in `ipc-contract.md`.

Deleting or disabling a folder instruction removes its destinations (existing `enabled: false` rule). A folder removed from the workspace: its instruction stays on disk, is shown under "Workspace" with a "pasta removida" note, and is not materialized.

## Session status (bug)

Symptom: with Claude and Cursor, the session sits on "Iniciando" and does not change while the agent is idle, stopped, or spending tokens.

What I found (hypothesis, not yet reproduced in the running app):
- `SessionPanel.tsx:183` starts `status` as `'starting'` whenever a `sessionId` prop is given and only moves to `'running'` after a one-shot `session.status` lookup (`:210`); if that lookup returns nothing or races the spawn, the pill never leaves "Iniciando".
- The panel's pill (`STATUS_PILL`, `:53`) only knows lifecycle (`idle|starting|running|exited|error`) and ignores `SessionSnapshot.activity` (`working|idle|needs-input`), which `SessionService` already maintains (`session-service.ts:150-175`) from hook signals (Claude) and `hooks.json` + PTY tail (Cursor). The sidebar rows and StatusBar already read `activity`.
- Separately the signal path itself may fail per harness (hooks not installed, `AI_COMPANION_SIGNAL_FILE` unset, hooks.json merged but Cursor not reloaded). That must be checked with a real session of each harness before concluding.

Required behaviour:
- Pill labels: Iniciando (until first PTY output or the `session.status` snapshot says running) → Trabalhando / Ocioso / Aguardando você, following `activity`; Encerrada, Erro as today.
- The panel subscribes to snapshot/activity changes instead of a single lookup.
- Fix root cause per harness; if a harness gives no signal, the pill must say "Em execução" (never stay on "Iniciando") — a degraded but truthful state.
- Out of scope here: cost/health.

Process: write a failing test first for the panel state (renderer jsdom) and for any service-side gap; then reproduce with `claude` and `cursor-agent` in the running app before and after.

## Constraints

- Hexagonal rule: services depend on ports; adapters do the I/O. Imports use `.js`; strict TS flags on.
- Production bar: lint, typecheck, tests green. Update `docs/reference/ipc-contract.md`, `architecture.md`, `customization-schema.md` for the new `folder` field on instructions and the new destinations.
- No new dependencies. Icons come from `lucide-react` (already used). Fonts and colors from the existing tokens (`src/renderer/tokens.ts`).
- Separate PRs: (1) tree redesign + Global rename + Instructions folder level, (2) session status fix. The user wants the bugs fixed after this spec is approved.

## Left to the builder

Component structure of the new tree, copy for tooltips, keyboard and a11y of rows (dot needs a text alternative), animation (none required).

## Not verified

Everything visual was checked only in the HTML mockup, not in the running app: dark theme rendering, Space Grotesk/JetBrains Mono glyphs, density at the real panel width, light theme. The session-status root cause is a reading of the code, not a reproduction.
