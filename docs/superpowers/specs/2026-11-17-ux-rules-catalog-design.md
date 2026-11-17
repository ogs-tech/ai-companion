# UX rules catalog — design

Date: 2026-11-17 · Size: small change

## Intent

UI/UX rules (truthful labels, visible selection, undo over confirm…) live only in private instruction files
(`CLAUDE.local.md`, `~/.claude/CLAUDE.md`). Nothing tells us which ones are actually guarded, so they regress
silently and can't be reviewed as a set. Goal: **guard the rules we have decided** — each rule has an ID, a
home in the repo, and at least one e2e test that fails when it is broken. Improvement happens by adding or
tightening rules in the catalog.

## Goals / non-goals / anti-goals

- **Goals:** one versioned catalog of UX rules; every testable rule covered by ≥1 e2e test; coverage gaps fail CI;
  generic rules checked everywhere they can be, not only in their "owner" test.
- **Non-goals:** visual review (screenshots, walkthrough reports — option B, discarded for now); visual-regression
  snapshots; judging taste (density, hierarchy).
- **Anti-goals:** a parallel e2e suite that duplicates setup and drifts from the real journeys; rules asserted
  against stub-looking data (stubs must stay realistic, per `e2e/fixtures/cli-stubs.ts`).

## Approaches

1. **Catalog + tags on existing tests** — rules get IDs in a doc; existing `e2e/product/*` tests are tagged
   `@ux-NN`; a unit test cross-checks doc ↔ tags. Reuses setup; rule spread across area specs.
2. **Dedicated `e2e/product/ux-rules/` suite** — one spec per rule. Readable, but duplicates setup, slows the
   suite, drifts from real journeys. Rejected.
3. **Global invariants** — helpers like `expectNoUntitledRows(page)` called after relevant steps in every
   journey. Catches violations anywhere; only works for context-free rules.

**Picked: 1 + 3.** Catalog and tags make rules reviewable and gaps visible; invariants cover the generic rules
across journeys.

## Design

### Catalog — `docs/product/about/ux-rules.md`

English (like the rest of `docs/`), linked from `docs/product/about/index.md`. One table, parsed by the coverage
test, so the row format is fixed:

```
| ID    | Rule | Check | Notes |
| UX-01 | ...  | e2e   | ...   |
```

`Check` ∈ `e2e` (needs ≥1 tagged test) · `invariant` (needs ≥1 tagged test **and** a helper in
`e2e/fixtures/ux-invariants.ts`) · `manual` (listed for review, excluded from coverage — e.g. "one clear action per
context"). IDs are never reused; a retired rule stays with `Check: retired`.

Initial rules (my call, from the current instruction files — adjust on review):

| ID | Rule | Check | Already covered by |
|---|---|---|---|
| UX-01 | A label is truthful: no "Iniciando…" once the process is up; no "Untitled" once a title exists | invariant | `sessions/list.spec.ts` |
| UX-02 | The open item is visibly selected in its list (session row ↔ focused tab) | invariant | — |
| UX-03 | Removing something is optimistic + undo toast, not an "are you sure?" dialog. A dialog is fine only when it asks a real choice (e.g. Desabilitar Cursor: keep or remove synced links) | e2e | `sessions/list.spec.ts` (Apagar/Desfazer) |
| UX-04 | The session list reflects the real CLI session (title, model from transcript) across `/clear`, Encerrar, delete and Início ↔ workspace | e2e | `sessions/lifecycle.spec.ts`, `sessions/list.spec.ts` (partial) |
| UX-05 | One clear primary action per context | manual | — |
| UX-06 | Simplify first: fewer states, fewer controls | manual | — |

Then `CLAUDE.local.md`'s UI/UX section points to the catalog instead of restating rules (user edits that file).

### Tags

Playwright `tag` option, as `@smoke` already is: `test('…', { tag: ['@smoke', '@ux-01'] }, …)`. A rule can be
tagged on several tests; a test can carry several rules. `npm run e2e -- --grep @ux` runs only rule tests
(add an `e2e:ux` script).

### Invariants — `e2e/fixtures/ux-invariants.ts`

One exported async function per `invariant` rule, each taking the `Page` and asserting with `expect` (so it
reports like a normal failure), JSDoc'd with its rule ID:

- `expectTruthfulLabels(page)` (UX-01) — no visible session row/tab reads "Iniciando…" after the session reached
  `running`; no row reads "Untitled" when its snapshot has a title (via `session.call` or DOM data).
- `expectOpenItemSelected(page)` (UX-02) — the focused workbench session tab's row in the list has the selected
  state.

Called from existing journeys after steps that change session state (create, first prompt, `/clear`, scope
switch). Those tests get the rule's tag.

### Coverage check — `tests/shared/ux-rules-coverage.test.ts`

Runs in the existing `node` Vitest project (no config change). Reads the catalog and greps `e2e/**/*.spec.ts`:

- every `e2e`/`invariant` rule has ≥1 `@ux-NN` tag → else fail, naming the rule;
- every `@ux-NN` tag in e2e exists in the catalog → else fail (typo/retired rule);
- every `invariant` rule has a helper in `ux-invariants.ts` mentioning its ID.

It checks *presence*, not that the test asserts the right thing — that stays a review concern.

## Left to the builder

- Exact DOM hooks for "selected" (`aria-selected` vs a class) — read the session list component; prefer the
  accessible attribute, add it if missing.
- How `expectTruthfulLabels` learns a row's real title (IPC snapshot vs DOM).
- Which existing steps call the invariants; write new tests only where a rule has no journey yet (UX-02 likely).
- Run `npm run build` before e2e, per repo practice.
