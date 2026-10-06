---
title: Add a harness adapter
description: Contributor guide — give a new harness the `manage` capability so the app materializes skills, agents and instructions into it.
---

# Add a harness adapter

> **Audience:** contributors. Read [the harness model](../explanation/harness-model.md) first — it defines
> what qualifies as a harness and why `manage` and `run` are separate. This guide covers `manage` only.

Running example: Cursor (`src/main/infrastructure/adapters/cursor-adapter.ts`).

## 1. Pass the boundary test

Confirm the tool is a harness and that it reads customizations from files the app can produce
([The boundary test](../explanation/harness-model.md#the-boundary-test)). Then map, on paper, where it reads
each entity kind from — home level and repo level — for `skill`, `agent` and `instruction`. That table
becomes the adapter, and later a section of [Adapter targets](../reference/adapter-targets.md).

## 2. Register the harness

In `src/shared/harness.ts`, add the id to `HarnessId` and an entry to `HARNESSES`:

```ts
acme: {
  id: 'acme',
  displayName: 'Acme',           // as the vendor spells it
  capabilities: ['manage'],
  defaultEnabled: false,         // enabling a new sync target is the user's decision
},
```

That is all the settings side needs. Defaults, `settings.json` validation and the **Settings → Adapters**
toggle all derive from `HARNESSES`, and `SettingsService` backfills the new key into existing users'
`settings.json` at its `defaultEnabled` value on load.

## 3. Implement the `Adapter` port

Create `src/main/infrastructure/adapters/<id>-adapter.ts` implementing `Adapter`
(`src/main/application/ports/adapter.ts`):

- `adapterId` — must equal the `HarnessId`; `AdapterManager` looks up `settings.adapters[adapterId]`.
- `resolveEntityDestinations({ entity })` — return one `AdapterDestination` per path the harness should see:
  - branch on `entity.kind`, then on `entity.scopes[0]`;
  - `personal` → under the injected `homedir` (never call `os.homedir()` yourself);
  - `project` / `workspace` → `await resolveScopePath(entity, { workspaceService, projectService })`, then
    append the harness's repo-level subpath. Never read a path stored on the entity;
  - return `[]` for kinds the harness has no equivalent for;
  - throw `DomainError` for a malformed entity (e.g. missing scope). `AdapterManager` turns a throw into a
    per-entity error in the sync report instead of aborting the whole sync.

### Choose a strategy per destination

- **`symlink`** (prefer it). The destination becomes a link to the canonical file; `AdapterManager`
  computes the source path itself. Use it whenever the harness reads the file as-is.
- **`write`** only when the harness needs a *different* format (another file type, a wrapper, a manifest).
  Provide the full `content`, regenerated from the entity on every sync, and an ownership marker:
  - the default marker (`GENERATED_FILE_MARKER`, an HTML comment on line 1) works for Markdown;
  - otherwise add a marker to `src/shared/brand.ts` (and its `legacy` twin, if relevant) and pass it as
    `ownershipMarker` with `ownershipCheck: 'includes'` — e.g. a JSON key or YAML frontmatter key, for
    formats that cannot start with a comment.

  Without a recognizable marker, `FileMaterializer` treats the file as foreign and backs it up on every
  sync. See [Why symlinks](../explanation/why-symlinks.md#where-the-app-writes-files-instead).

**Check for path collisions with existing adapters.** Two adapters must not target the same path with
different strategies — today Claude and Cursor both claim `<scope>/AGENTS.md`
([known issue](../reference/adapter-targets.md#known-issues)); don't add a third.

## 4. Wire it in

Instantiate it in `buildWorkspaceScopedServices` (`src/main/application/workspace-scoped-services.ts`) and
add it to the `adapters` map passed to `AdapterManager`:

```ts
const acmeAdapter = new AcmeAdapter({ homedir, workspaceService, projectService });
// ...
adapters: new Map<string, Adapter>([
  [claudeAdapter.adapterId, claudeAdapter],
  [cursorAdapter.adapterId, cursorAdapter],
  [acmeAdapter.adapterId, acmeAdapter],
]),
```

The adapter is rebuilt with the rest of the workspace graph on every workspace switch. Everything built on
`AdapterManager` picks it up with no further changes: sync on save, the file watcher, enable/disable with
cleanup, `adapter.countDestinations`, factory reset, and the Diagnóstico **Symlinks** / **Generated Files**
checks.

## 5. Test it

Mirror the existing suites in `tests/main/infrastructure/adapters/__tests__/`:

| Suite | Asserts |
|---|---|
| `<id>-adapter.contract.test.ts` | `adapterId` and the port shape. |
| `<id>-adapter.entity-destinations.test.ts` | Every kind × scope → exact paths and strategies, `[]` for unsupported kinds, errors for a missing scope. |
| `<id>-adapter.wiring.test.ts` | Through `AdapterManager`: destinations are planned when the harness is enabled, none when disabled. |
| `<id>-adapter.e2e.test.ts` | Through `AdapterManager` on a temp dir: links/files appear, re-sync is idempotent, disable removes only owned targets. |

## 6. Document it

- Add a section to [Adapter targets](../reference/adapter-targets.md), and its markers if any.
- Add a row to "What the app supports today" in [the harness model](../explanation/harness-model.md).

Then run `npm run lint && npm run typecheck && npm test`.
