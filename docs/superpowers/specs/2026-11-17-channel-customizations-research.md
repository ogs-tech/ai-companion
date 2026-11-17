# How channels treat customizations — research

Date: 2026-11-17 · Input for the customization-lifecycle consolidation (BE + UI).
Sources: code.claude.com/docs (memory, skills, sub-agents, mcp, hooks, plugins, output-styles), cursor.com/docs
(context/rules, skills, subagents, mcp, cli/mcp, agent/hooks, reference/third-party-hooks, plugins), lmstudio.ai/docs
(app/mcp, cli chat, presets). "Unverified" = not confirmed from a primary source.

## Claude Code

| Kind | Scopes | Precedence on clash | Native enable/disable | Discovery | Plugin-provided |
|---|---|---|---|---|---|
| Skill (+ legacy commands) | managed, `~/.claude/skills`, project `.claude/skills` (walks up), nested (on demand), plugin | managed > **personal > project**; skill beats same-name command | `skillOverrides` (on / name-only / user-invocable-only / off, via `/skills` → `settings.local.json`); `disable-model-invocation`; `permissions.deny` | `/skills` | `/plugin:skill`; `skillOverrides` does not apply — only the whole plugin toggles |
| Subagent | managed, `--agents`, project `.claude/agents` (walks up), `~/.claude/agents`, plugin | managed > CLI > **project > user** > plugin; identity = frontmatter `name` | none (only `permissions.deny: Agent(name)`) | `/agents` (now a hint; no editor) | `plugin:name`; plugin agents ignore `hooks`/`mcpServers`/`permissionMode` |
| Instructions | managed, `~/.claude/CLAUDE.md`, `~/.claude/rules/**`, project `CLAUDE.md` / `.claude/CLAUDE.md` / `.claude/rules/**` (`paths:`), `CLAUDE.local.md`, `AGENTS.md` | **no override — all concatenate** | `claudeMdExcludes`; instruction-files mode (default: AGENTS.md only if no CLAUDE.md in cwd or above) | `/memory` | no |
| MCP | local (`~/.claude.json` per project — `claude mcp add` default), project `.mcp.json`, user `~/.claude.json`, managed, plugin, connectors | managed > **local > project > user** > plugin > connectors; whole entry wins | `/mcp` per-server toggle (`disabledMcpServers` in `~/.claude.json`); `.mcp.json` needs approval (`enabledMcpjsonServers`…) | `/mcp`, `claude mcp list/get` | `plugin:<p>:<s>`; can be toggled, not removed |
| Hooks | user/project/local settings, managed, plugin, skill/agent frontmatter | **all run**; identical handlers deduped across settings files | none (`disableAllHooks` only) | `/hooks` (read-only, shows source) | yes |
| Plugins | `enabledPlugins` in settings; files under `~/.claude/plugins/` | managed > flag > local > project > user, per id `name@marketplace` | install/uninstall/enable/disable/update, marketplaces | `/plugin` | container of skills, agents, hooks, MCP, LSP, output styles |

## Cursor

| Kind | Scopes | Precedence | Native enable/disable | Discovery | CLI honors |
|---|---|---|---|---|---|
| Rules (`.mdc`) | team, project `.cursor/rules/**`, user rules (UI-only, storage undocumented), `AGENTS.md` root + nested | team > project > user, merged | rule type (always / globs / intelligent / manual); no toggle | Customize → Rules | yes; CLI also reads root `AGENTS.md` **and `CLAUDE.md`** |
| Skills (`SKILL.md`) | `.cursor/skills`, `.agents/skills`, **`.claude/skills`**, `.codex/skills` + `~/` versions | undocumented | `disable-model-invocation` only | Customize → Skills, `/` | yes |
| Commands | legacy → `/migrate-to-skills` | — | — | — | unverified |
| Subagents | `.cursor/agents`, **`.claude/agents`**, `.codex/agents` + `~/` | project > user; `.cursor` > `.claude`/`.codex` | none | task card | yes |
| MCP | `<ws>/.cursor/mcp.json`, `~/.cursor/mcp.json`, plugin, extensions | CLI: project > global; editor undocumented | **per-server toggle** (Customize; `agent mcp enable/disable`; storage undocumented) | Customize, `agent mcp list` | yes |
| Hooks | enterprise > team > project `.cursor/hooks.json` > user > **Claude settings files** > plugins | **all run**; deny > ask > allow | none; project hooks only in trusted workspaces | Customize → Hooks | `workspaceOpen` only confirmed |
| Plugins | `.cursor-plugin/plugin.json`; local dev path **`~/.cursor/plugins/local/<plugin>`** | marketplace beats local of same name | install / refresh; disable/uninstall undocumented | Customize, marketplace | undocumented |

Third-party import ("Include Third-Party Plugins, Skills, and Other Configs", on by default) makes Cursor load Claude's
skills, agents and hooks natively.

## LM Studio

- MCP: `~/.lmstudio/mcp.json` (Cursor notation) since 0.3.17, edited in-app; exposed to the REST API as `mcp/<label>`.
- Presets (system prompt + params): `~/.lmstudio/config-presets` (unverified).
- `lms chat` documents only `-p`, `-s`, `--stats`, `--ttl` — no MCP/presets. Stays run-only for our purposes.

## Cross-cutting findings

1. **Plugin is a package in both channels**: it provides items of every kind, namespaced, toggled only as a whole
   (except Claude plugin MCP via `/mcp`), read-only in practice.
2. **No uniform native toggle.** Only MCP (both), Claude skills (`skillOverrides`) have one; agents, hooks, rules have
   none. Removing the item from the channel is the only uniform "disabled".
3. **Precedence differs per kind and per channel** (Claude skills personal > project, agents project > user, MCP
   local > project > user; instructions/hooks never override — they all apply). "Workspace overrides Global" is not a
   rule we can show truthfully across kinds.
4. **Channels read each other.** Cursor loads `.claude/skills`, `.claude/agents`, Claude hooks and (CLI) `CLAUDE.md`.
   With both adapters on, Cursor likely loads our skills/agents twice and **runs our hooks twice**.

## Defects / risks found in our adapters (to list, not fix in this change)

- Cursor plugin hack lives at `~/.cursor/plugins/air-ide/`, outside the documented `~/.cursor/plugins/local/`;
  whether Cursor loads it is unverified.
- Double loading in Cursor (finding 4); hooks double-run is the harmful case.
- `~/AGENTS.md` sits in the parent chain of every project under `~`; in a project without CLAUDE.md Claude may load it
  on top of `~/.claude/CLAUDE.md` (unverified).
- Detection misses Claude local-scope MCP (`~/.claude.json` → `projects[<path>].mcpServers`).
- MCP merged into `.mcp.json` stays pending until approved in Claude; our status says "Instalado".
- Claude rewrites `~/.claude.json` often; concurrent writes with `MergeMaterializer` may race (unverified).
- A skill folder containing `.claude-plugin/plugin.json` becomes a plugin in Claude.
