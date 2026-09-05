# Spreadsheet Formula Fallback Evaluation — Design

- **Date:** 2026-08-31
- **Status:** Design approved by author; pending implementation plan.
- **Author:** Odenir Gomes (with Claude)
- **Scope:** When the `.xlsx` preview (`NodeFileBrowserAdapter.readFile` → `EditorPanel.tsx`'s
  `SpreadsheetPreview`) encounters a formula cell whose source file carries no cached result, compute
  a best-effort fallback value instead of rendering the cell as blank. Formula cells that already have
  a cached result are unaffected.

> Written in English to match the existing `docs/reference/*.md` and `docs/superpowers/specs/*.md`
> convention. The brainstorming conversation that produced it was in pt-BR.

---

## 1. Context and goal

Reported via screenshot: selecting cell `C34` in `calculator_catalog.xlsx` shows
`=INDEX(entregavel_horas,MATCH($B34,entregavel_codigo,0))` in the formula bar, but the cell body in
the grid is empty — it should show the computed result.

Investigation traced this to the raw XML: `<c r="C34" s="202"><f>INDEX(...)</f><v /></c>` — the cached
value element (`<v>`) is empty. The file's `docProps/app.xml` identifies the generator as
`Openpyxl 3.1.5`; openpyxl writes formula text but never evaluates it, so the cache is only ever
populated once some other tool (Excel, LibreOffice, Google Sheets) opens, recalculates, and re-saves
the file. A full survey of this workbook found **107 formula cells, all 107 with an empty `<v/>`** —
every calculated column in a script-generated workbook like this one renders blank today.

`node-file-browser-adapter.ts`'s `cellToText` already documents the existing design choice: *"no
formula recalculation, just what the workbook last had cached."* That choice is sound for files
authored in a real spreadsheet application, but leaves script-generated `.xlsx` files — a plausible
and likely common source for an AI-companion tool's users — effectively unreadable in every calculated
column. The goal of this spec is to close that specific gap: compute a fallback value when, and only
when, the source file supplies none.

## 2. Decisions made during brainstorming

1. **Library choice: `fast-formula-parser` (MIT), not `hyperformula` (GPL-3.0-only).** The author
   confirmed the app will or may be distributed beyond personal use, which makes a GPL runtime
   dependency a real licensing obligation, not just a style preference — `package.json` is
   `"private": true` with no `license` field (proprietary), and HyperFormula's GPL terms would require
   either open-sourcing under GPL-compatible terms or a commercial license from its vendor.
   `fast-formula-parser` is MIT-licensed, bundles both parsing and evaluation (not just a bare function
   library), and its function coverage was confirmed to include everything this workbook's formulas
   need: `INDEX`, `MATCH`, `SUMIF`, `ROUND`, `IF`, `AND`, named-range resolution (via an `onVariable`
   callback), and cross-sheet references (`Sheet!A1` syntax).
2. **Cached values always win; fallback computation only fires when the cache is empty.** Never
   override a value the source file already computed with our own recalculation — lower risk (a gap in
   our function coverage or formatting can't silently replace a value Excel already got right), and
   files without this problem pay zero extra computation cost. This rule applies recursively: a
   referenced cell that itself carries a cached value is trusted as-is, not recomputed, even mid-chain.
3. **Unresolvable formulas fall back to showing the formula text, not a blank cell.** When neither the
   cache nor our own evaluation can produce a value (unsupported function, circular reference,
   unresolved name), the cell body shows the same formula text the formula bar already displays for a
   selected cell, visually distinguished (muted/italic) so it reads as "we know this cell has a
   formula, but couldn't resolve it" rather than looking like a normal value or a broken empty cell.
4. **Computation runs in the main process, inline with the existing parse in
   `node-file-browser-adapter.ts` — not in the renderer.** The `exceljs` workbook is already parsed
   there, in exactly the shape needed to resolve named ranges and cross-sheet cell references (verified
   directly against the reported file: `workbook.definedNames.getRanges('entregavel_horas')` correctly
   returns `"'Catálogo'!$D$21:$D$29"`). Keeping the new dependency (and its `chevrotain` parser-toolkit
   transitive dependency) out of the renderer bundle avoids adding to window load weight; the renderer
   stays a pure consumer of the already-resolved `FilePreview` payload over IPC.

## 3. Architecture

- **New module: `src/main/infrastructure/filesystem/spreadsheet-formula-resolver.ts`.** Single
  responsibility: given an already-loaded `ExcelJS.Workbook`, resolve the effective value of one
  formula cell that has no cached result. Exposes a factory (e.g. `createFormulaResolver(workbook)`)
  returning a `resolve(sheetName, row, col)` function that `readSpreadsheet`'s existing per-cell loop
  calls into. Constructed once per `readSpreadsheet` call and reused across the whole workbook walk, so
  memoization (see below) is shared across sheets.
  - Backed by one `fast-formula-parser` `FormulaParser` instance, wired to three callbacks that all
    read directly off the `workbook` object rather than any intermediate structure:
    - `onCell({sheet, row, col})` — reads `workbook.getWorksheet(sheet).getCell(row, col)`. A plain
      value is returned as-is (coerced to the number/string/boolean shape the parser expects). A
      formula value with its own cache present returns that cached result (decision #2). A formula
      value with no cache recurses into `resolve` for that cell.
    - `onRange(ref)` — same per-cell logic as `onCell`, applied across the requested rectangular range.
    - `onVariable(name, sheetName)` — resolves via `workbook.definedNames.getRanges(name)`, parsing the
      returned range string(s) into the `{sheet, row, col}` / `{sheet, from, to}` shape the parser
      expects. When a name resolves to more than one disjoint range (a rare union-range case), only the
      first is used — the same "best effort, not a full reimplementation" scope cut this file already
      applies to shared formulas in `formulaOf`.
  - **Recursive and memoized, with cycle detection.** A referenced cell that is itself an uncached
    formula is resolved by recursing into the same `resolve` function, keyed by `sheet:row:col` in a
    memo map so a cell already resolved this pass is never recomputed. An in-flight set tracks cells
    currently being resolved on the current call stack; re-entering one of them means a circular
    reference, resolved immediately as "unresolved" rather than recursing further. This is exercised by
    the reported workbook, not just a hypothetical: `sheet2!F21`'s formula depends on the named range
    `recurso_taxa_h` (`Config!F10:F17`), whose cells are themselves uncached formulas.
  - **No bundled TypeScript types.** Verified directly (unpacked the published tarball — 38 files,
    zero `.d.ts`; no `@types/fast-formula-parser` package exists). Add a minimal local ambient
    declaration, `fast-formula-parser.d.ts`, colocated with the resolver module, covering only the
    constructor options and `parse` method shape this codebase actually calls.
- **`readSpreadsheet`'s per-cell loop (`node-file-browser-adapter.ts`).** Unchanged for the common
  case. When a cell carries a formula (`formulaOf(cell.value) !== undefined`) and `cellToText` produced
  an empty string, the loop asks the resolver for that cell instead of leaving the text empty:
  - A computed value (including a genuine Excel-semantic error result like `#N/A` or `#DIV/0!` — a
    valid formula *outcome*, not a resolution failure) is formatted the same way a cached value would
    be, via the existing `formatNumber`/`cellToText` machinery, and becomes `value`.
  - "Unresolved" (thrown, unsupported, cyclical, or a dependency that was itself unresolved) makes
    `value` the formula text itself, with the new `formulaUnresolved: true` flag set.
- **`src/shared/file-browser.ts`.** Additive change to `SpreadsheetCell`'s object variant:
  ```ts
  export type SpreadsheetCell =
    | string
    | { value: string; style?: SpreadsheetCellStyle; formula?: string; formulaUnresolved?: boolean };
  ```
  `formula` keeps its existing meaning and is unconditionally populated whenever the source cell
  carries one, exactly as today — the formula bar's behavior (`formulaBarText` in `EditorPanel.tsx`) is
  unaffected. `formulaUnresolved` is new, optional, and only consulted by the grid body's cell
  rendering; every existing consumer that ignores it keeps working unchanged.
- **`EditorPanel.tsx`'s cell-rendering block** (`~line 730`, where `text`/`style`/`hasFormula` are
  currently derived per cell) reads the new `formulaUnresolved` flag and, when true, renders the cell
  with a muted/italic treatment instead of its normal numeric/text styling — reusing whatever muted-text
  token this file already uses elsewhere, rather than introducing a new one.

## 4. Data flow

1. `readSpreadsheet(buffer)` loads the workbook exactly as today, including the comments-relationship
   stripping retry from the prior fix.
2. A `spreadsheet-formula-resolver` is constructed once for the loaded `workbook`, before the
   per-worksheet row/column walk begins.
3. For each worksheet, the existing dense walk builds `SpreadsheetCell[][]` as today. For a formula
   cell whose cached text comes back empty, the loop calls `resolve(sheetName, row, col)` instead of
   leaving `text` as `''`.
4. The resolver walks its `onCell`/`onRange`/`onVariable` callback graph against the live `workbook`,
   recursing into other uncached formula cells as needed (memoized within this resolver instance), and
   returns either a value or "unresolved".
5. The built `SpreadsheetCell` reflects the outcome: computed value as `value` (normal styling), or
   formula text as `value` with `formulaUnresolved: true` (muted/italic styling).
6. Renderer: the formula bar (`formulaBarText`) is unchanged — it already shows `=formula` for any
   selected cell that has one, regardless of whether it resolved. The grid cell body now reflects all
   three end states: a genuine cached value, a computed fallback value, or a visually-flagged
   unresolved formula.

## 5. Error handling

- `fast-formula-parser` throwing (unsupported function, parse error) is caught at the resolver's
  boundary and treated as "unresolved" for that cell — and, by the memoization/recursion design, for
  anything depending on it, since a failed dependency can't produce a usable value for its dependents.
- A circular reference (a cell's resolution path re-enters a cell already being resolved on the same
  call stack) is caught by the in-flight set and treated as "unresolved" — no infinite recursion, no
  stack overflow.
- A named range that doesn't resolve to a usable reference makes "unresolved" the outcome for any
  formula depending on it.
- A formula whose own computed result is a genuine Excel-semantic error (a `FormulaError` value, e.g.
  `#N/A`) is **not** "unresolved" — it is a valid result, displayed as its error text like any other
  computed value.
- No failure mode inside the resolver propagates past its boundary into `readSpreadsheet` — everything
  collapses to the same "unresolved" outcome the fallback path already handles.

## 6. Testing

- New `tests/main/infrastructure/filesystem/spreadsheet-formula-resolver.test.ts` — unit coverage of
  the resolver in isolation: a direct reference to a cell with its own cached value, recursive
  resolution through a chain of uncached formula cells, named-range resolution, a cross-sheet
  reference, cycle detection (resolves to "unresolved", does not hang), an unsupported-function
  fallback, and a genuine Excel-error result passed through as a valid value.
- Extend `tests/main/infrastructure/filesystem/node-file-browser-adapter.test.ts` (already has the
  `writeWorkbook`/zip-manipulation pattern from the comments-relationship fix) with end-to-end cases: a
  workbook whose formula cell has its cached value blanked out (same zip-editing technique used for the
  comments-relocation test, applied to a cell's `<v>`) previews with the computed value in place; a
  second case where the formula can't be evaluated confirms `formulaUnresolved: true` with the formula
  text as `value`.
- `tests/renderer/components/workspace/EditorPanel.test.tsx` — a cell with `formulaUnresolved: true`
  renders with the muted/italic treatment instead of normal cell styling.
- Manual sanity check against the real reported file, `calculator_catalog.xlsx` (same throwaway-test
  approach used to verify the comments fix, not committed) — confirms cell `C34` now shows a computed
  number instead of blank.

## 7. Explicitly out of scope (for this spec)

- Date arithmetic inside recomputed formulas — no Excel-serial-date conversion for formula operands. A
  date-dependent formula that can't be evaluated correctly falls back gracefully to
  `formulaUnresolved`, it does not crash or silently produce a wrong number.
- Array/spill formulas — the resolver takes the parser's default scalar result; no special handling for
  CSE (legacy array-formula) or dynamic-array/spill semantics.
- A dedicated performance cap for formula evaluation — the existing 5MB file-size and
  2000-row-per-sheet preview caps already bound the work, and the resolver's memoization prevents
  recomputing the same cell twice within one preview.
- A visual distinction between "the file's own cached value" and "a value we computed" when computation
  *succeeds* — both render identically, with normal cell styling. Only the failure case
  (`formulaUnresolved`) gets the muted/italic treatment.
- External file references, R1C1 notation, and iterative/circular-reference calculation settings —
  unsupported by the underlying parser; any formula relying on them falls back to `formulaUnresolved`.
