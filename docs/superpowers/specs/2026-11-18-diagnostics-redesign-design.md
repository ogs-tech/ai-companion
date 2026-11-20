# Diagnóstico redesign

## Intent

The Diagnóstico screen still groups checks by technical category (Symlinks, Generated Files, Config Drift…) and
shows the collectors' English titles; the status-bar entry is a dot plus "atenção" with a tooltip that mixes the
verdict with a list of enabled channels. Both predate the type-grouped Customizações tree. The redesign speaks the
tree's vocabulary, lets the user see what is going on with a problem, and makes Atualizar also re-detect what the
channels hold.

## Decisions (made with the user, mockups in `.superpowers/brainstorm/`)

- **Status bar — popover (option C).** The entry shows the worst state: `N com erro`, `N em alerta` or
  `Conectado`. A click opens a popover listing the customizations with a problem (worst first) with two actions:
  `Atualizar` and `Abrir diagnóstico` (only `Atualizar` when all is connected). The channel-list tooltip is gone.
- **Screen — matrix (option B).** One row per customization, one column per channel that receives customizations
  and is on (plus any channel a check names). Groups follow the tree: Instruções, Skills, Agents, MCP, Hooks,
  Plugins. Every synced customization appears, connected ones included.
- **Three states only:** `Conectado` (ok), `Em alerta` (warning), `Com erro` (error) — the check `severity`.
  A plugin shows the worst of its own checks and its servers' (listed indented under it). A channel that reads
  another's file repeats that file's state (coverage). No check for a cell → `—`.
- **Detail — inline row expansion (option B).** Clicking a cell expands under the row: what happened in plain
  pt-BR, the path (and the expected source when known), `Verificado às HH:MM`, and **one** action for the cause.
- **"Desde quando"** is not tracked (`observedAt` is re-stamped every report): the detail says `Verificado às`.
  First-seen history is a follow-up.
- **Atualizar** = `adapter.syncAll` → `mcp.refreshHealth` (failure tolerated) → invalidate every query (health,
  status, detected, MCP, hooks) → summary line with the sync result and the count of detected items to import.

## Approaches

- **A — structured cause from main (chosen).** `HealthCheck` gains additive `cause` and `expected` fields set by
  each collector, which already knows the cause when it writes the title. The renderer maps `cause` → pt-BR copy
  and action. Root-cause fix for the English titles leaking into the UI.
- B — renderer-only, parsing `category` + English title prefixes. No IPC change, but any title edit silently
  breaks the screen.
- C — main builds the matrix (`health.getMatrix`). Duplicates grouping the renderer already does; larger contract.

## Builder's calls

- Rows come from the checks' `entityUrn` (every synced destination has a check, ok ones included), so no join
  with the tree lists is needed. Checks without a urn (a collector that failed) render as a "Geral" list above
  the matrix.
- Actions per cause: `missing`/`repointed`/`drifted` → `Sincronizar <canal>` (`adapter.syncAll { adapterId }` —
  the whole channel; there is no per-item sync; a covered cell syncs the covering channel); `unmanaged` on a
  symlink/generated file → `Instalar por cima` (`adapter.install`, toast with `Desfazer`); `needs-auth` →
  `Entrar` and `runtime-failed` → `Abrir MCP` (open the MCP page); `collector-failed` → `Atualizar`;
  `not-loaded`/`plugin-drift`/unmanaged merge entry → no button, a pt-BR hint only.
- `found` (where a repointed link actually points) is not read: it would need a readlink port. The detail shows
  the expected source only.
- The tree's Sincronização section reuses the same cause copy instead of English titles.
