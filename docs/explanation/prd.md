---
title: PRD — AI Companion
internal_name: ai-companion
codename: forge
public_name: AI Companion
status: Ready
created_at: 2026-04-19
updated_at: 2026-06-04
---

# PRD — AI Companion

> [!NOTE]
> Stack, processes and technical decisions in [reference/architecture.md](../reference/architecture.md).

## 1. Problem

Devs who use AI (Claude Code) accumulate skills, agent profiles, global instructions and commands scattered across notes, loose folders and ad-hoc repos. They know they exist, but can't find them when needed.

## 2. Hypothesis

Centralizing these **customizations** in a local GUI, versioned in git, with symlink-based sync to the tools, is worth the effort.

**Validation:** the author uses the app daily for 2+ consecutive weeks without going back to the old method.

## 3. User

Single persona: the author themselves. Dogfooding. No external users.

## 4. Scope

A **customization** is a Markdown file with YAML frontmatter typed as one of:
`skill` · `agent` · `global-instruction` · `command`.
Each customization has a **scope**: `personal` or `project`.

### Must-have

- CRUD of customizations (all four types) in Markdown + YAML frontmatter.
- "New" opens the editor pre-filled with sensible defaults; "Duplicate" copies an existing item (don't face a blank page).
- Markdown preview on save.
- Sync via symlink to Claude Code, personal and project scopes.
- Settings: enable/disable adapter, default scope, management of linked repos.

### Should-have (if there's time left)

- Full schema validation of frontmatter.
- Text search.

> Should-haves only start **after** must-haves have been in real use for ≥ 1 week. If a should-have takes > 3 days of implementation, it's cut and becomes post-spike debt.

### Nice-to-have

- Token consumption per customization (Claude via JSONL). Split from should-have because the JSONL parser carries significantly more risk (format breakage) than schema validation or text search.

## 5. Out of scope

- Collaboration, multi-user, team sync.
- Tools other than Claude Code.
- Token cost in dollars (raw count only).
- Git history in the UI.
- Visual polish, accessibility, i18n.
- Marketable product.

## 6. Success metrics

- ≥ 10 working days in which ≥ 1 synced customization was effectively consumed by Claude Code in a real work session (verifiable via Claude JSONL).
- ≥ 2 consecutive weeks without creating/editing customizations outside the app (loose notes, ad-hoc prompts, direct edits in `~/.claude/`).
- ≥ 5 customizations created and used in real projects.
- Zero occurrences of broken symlink, unresolved conflict or desynced customization persisting > 1 working day after detection.
- Final report with transferable decisions for the next step (Specfy).

**Checkpoints:** 30min retro every **2 weeks** with 3 fixed questions:

1. Am I using it? (yes/no/partial — with evidence)
2. Is anything blocking daily use? (friction, bug, missing feature)
3. Should I cut scope, continue or stop?

Decision logged in this PRD (changelog) or a dedicated file. The 8-week soft cap below remains as the outer limit.

**Stop rule (continue / cut scope / stop):** the spike runs without a hard deadline, but ends when any signal below triggers a 30min retro:

- 8 calendar weeks without hitting validation (≥2 consecutive weeks of use + ≥5 customizations in a real project) — soft cap.
- Validation reached → close spike, decide on hardening / move to Specfy.

**Failure:** abandonment before 2 continuous weeks, or going back to the old method without apparent pain.

## 7. Assumptions

- Author has ≥ 4h/day available throughout the spike.
- File format read by Claude Code remains stable.
- Author's local git repos are sufficient to test sync in a real project.

## Changelog

- **2026-05-04** — Reinstated under `docs/explanation/`. Updated terminology: *artifacts* → *customizations*; added `global-instruction` as a fourth customization type. Pointer to architecture moved to `reference/architecture.md`.
- **2026-04-29** — Last revision before docs were removed.
