import type ExcelJS from 'exceljs';
import FormulaParser from 'fast-formula-parser';
import type { FormulaParserContext, FormulaScalar } from 'fast-formula-parser';

const { FormulaError, FormulaHelpers: H, Types, WildCard } = FormulaParser;

/** The literal formula expression (e.g. `A1+A2`), for a cell whose value carries one — a shared-formula dependent cell (`sharedFormula` instead of its own `formula` text) is out of scope for a view-only preview and reports no formula. */
export function formulaOf(value: ExcelJS.CellValue): string | undefined {
  if (value !== null && typeof value === 'object' && 'formula' in value) {
    return (value as ExcelJS.CellFormulaValue).formula;
  }
  return undefined;
}

export type FormulaResolution = { resolved: true; value: ExcelJS.CellValue } | { resolved: false };

/**
 * Thrown from `onCell`/`onRange`/`onVariable` to force the formula
 * currently being evaluated to fail — caught by its own `resolve()` call
 * and turned into `{ resolved: false }`. Without this, an unresolvable
 * dependency (a blocked name, a date-valued operand, a failed nested
 * formula) would otherwise surface as a misleading Excel-semantic error
 * result (e.g. `#NAME?`) instead of the muted "we couldn't compute this"
 * `formulaUnresolved` treatment.
 */
class UnresolvedDependencyError extends Error {}

/**
 * Coerces a plain (non-formula) cell's ExcelJS value into the
 * number/string/boolean shape fast-formula-parser expects — richText and
 * hyperlink cells reduce to their text, a blank cell becomes `null` (the
 * parser applies its own per-function 0-or-"" blank semantics). A `Date`
 * (no Excel-serial-date conversion is implemented for formula operands —
 * out of scope, see the design spec) or a native cell error forces the
 * referencing formula to resolve as unresolved rather than risk silently
 * computing a wrong number.
 */
function operandOf(value: ExcelJS.CellValue): FormulaScalar | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'object') {
    if ('richText' in value)
      return (value as ExcelJS.CellRichTextValue).richText.map((run) => run.text).join('');
    if ('text' in value) return String((value as ExcelJS.CellHyperlinkValue).text ?? '');
  }
  throw new UnresolvedDependencyError('cell value has no formula-safe representation');
}

function hasCachedResult(cell: ExcelJS.Cell): boolean {
  const result = (cell.value as ExcelJS.CellFormulaValue).result;
  return result !== undefined && result !== null;
}

function cellKey(sheet: string, row: number, col: number): string {
  return `${sheet}:${row}:${col}`;
}

/** 1-based `{row, col}` parsed from an A1-style ref with optional `$` anchors (`$D$21`, `B3`). */
function parseA1(ref: string): { row: number; col: number } | undefined {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  if (!match?.[1] || !match[2]) return undefined;
  let col = 0;
  for (const letter of match[1]) col = col * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]), col };
}

/** A single range string from `workbook.definedNames.getRanges(name).ranges` — `'Sheet 1'!$D$21:$D$29` (quoted only when the sheet name needs it) or a single-cell `Sheet1!$B$3` — the exact format exceljs itself writes and reads back. */
function parseDefinedNameRange(
  range: string,
):
  | { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }
  | undefined {
  const match = /^(?:'([^']+)'|([^'!]+))!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?$/.exec(
    range.trim(),
  );
  const sheet = match?.[1] ?? match?.[2];
  const fromRef = match?.[3];
  if (!sheet || !fromRef) return undefined;
  const from = parseA1(fromRef);
  const to = match?.[4] ? parseA1(match[4]) : from;
  if (!from || !to) return undefined;
  return { sheet, from, to };
}

function compareScalars(a: FormulaScalar, b: FormulaScalar): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return NaN;
}

/**
 * `fast-formula-parser` v1.0.19 ships MATCH as an unimplemented stub
 * (`formulas/functions/reference.js`'s `MATCH: () => {}`, verified directly
 * against the installed package) — contradicting this feature's original
 * library-choice research, which assumed MATCH coverage. This is a
 * from-scratch implementation of Excel's MATCH semantics (exact match with
 * wildcard support at match_type 0, nearest ascending/descending
 * otherwise), following the same argument-unwrapping convention the
 * library's own HLOOKUP/VLOOKUP use.
 */
function matchFunction(
  lookupValueArg: unknown,
  lookupArrayArg: unknown,
  matchTypeArg: unknown,
): number {
  const lookupValue = H.accept(lookupValueArg);
  const lookupArray = H.accept(lookupArrayArg, Types.ARRAY, undefined, true);
  const matchType = H.accept(matchTypeArg, Types.NUMBER, 1);
  const lookupType = typeof lookupValue;

  if (matchType === 0) {
    const index = WildCard.isWildCard(lookupValue)
      ? lookupArray.findIndex((item) =>
          WildCard.toRegex(String(lookupValue), 'i').test(String(item)),
        )
      : lookupArray.findIndex((item) => item === lookupValue);
    if (index === -1) throw FormulaError.NA;
    return index + 1;
  }

  const ascending = matchType > 0;
  let found = -1;
  for (let i = 0; i < lookupArray.length; i += 1) {
    const current = lookupArray[i];
    if (current === undefined || typeof current !== lookupType) continue;
    const cmp = compareScalars(current, lookupValue);
    if (ascending ? cmp <= 0 : cmp >= 0) found = i;
    else break;
  }
  if (found === -1) throw FormulaError.NA;
  return found + 1;
}

/**
 * `fast-formula-parser`'s own INDEX (same source file as the MATCH stub
 * above) drops the source range's sheet when constructing the single-cell
 * reference it returns for a range/cell-ref indexing — confirmed by direct
 * testing: `INDEX(aNamedRangeOnAnotherSheet, n)` then silently resolves
 * against the FORMULA's own sheet instead of the range's, returning a wrong
 * value with no error — exactly the shape of the originally-reported bug's
 * formula. This mirrors the library's own INDEX, fixed to carry `sheet`
 * through; like the library's own version it doesn't support multi-area
 * (union) references — the same best-effort cut this resolver already
 * makes for union defined names in `onVariable` below.
 */
function indexFunction(
  context: FormulaParserContext,
  rangesArg: unknown,
  rowNumArg: unknown,
  colNumArg?: unknown,
  areaNumArg?: unknown,
): unknown {
  const rowNumExtracted = context.utils.extractRefValue(rowNumArg);
  const rowNum = Math.trunc(
    H.accept({ value: rowNumExtracted.val, isArray: rowNumExtracted.isArray }, Types.NUMBER),
  );

  let colNum = 1;
  if (colNumArg !== null && colNumArg !== undefined) {
    const extracted = context.utils.extractRefValue(colNumArg);
    colNum = Math.trunc(
      H.accept({ value: extracted.val, isArray: extracted.isArray }, Types.NUMBER, 1),
    );
  }

  if (areaNumArg !== null && areaNumArg !== undefined) {
    const extracted = context.utils.extractRefValue(areaNumArg);
    const areaNum = Math.trunc(
      H.accept({ value: extracted.val, isArray: extracted.isArray }, Types.NUMBER, 1),
    );
    if (areaNum > 1) throw FormulaError.REF;
  }

  const range = rangesArg;

  if (rowNum === 0 && colNum === 0) return range;

  if (rowNum === 0) {
    if (H.isRangeRef(range)) {
      if (range.ref.to.col - range.ref.from.col < colNum - 1) throw FormulaError.REF;
      range.ref.from.col += colNum - 1;
      range.ref.to.col = range.ref.from.col;
      return range;
    }
    if (Array.isArray(range)) return (range as unknown[][]).map((cells) => [cells[colNum - 1]]);
  }
  if (colNum === 0) {
    if (H.isRangeRef(range)) {
      if (range.ref.to.row - range.ref.from.row < rowNum - 1) throw FormulaError.REF;
      range.ref.from.row += rowNum - 1;
      range.ref.to.row = range.ref.from.row;
      return range;
    }
    if (Array.isArray(range)) return (range as unknown[][])[colNum - 1];
  }
  if (rowNum !== 0 && colNum !== 0) {
    if (H.isRangeRef(range)) {
      const { sheet, from, to } = range.ref;
      if (to.row - from.row < rowNum - 1 || to.col - from.col < colNum - 1) throw FormulaError.REF;
      return { ref: { sheet, row: from.row + rowNum - 1, col: from.col + colNum - 1 } };
    }
    if (H.isCellRef(range)) {
      const { sheet, row, col } = range.ref;
      if (rowNum > 1 || colNum > 1) throw FormulaError.REF;
      return { ref: { sheet, row: row + rowNum - 1, col: col + colNum - 1 } };
    }
    if (Array.isArray(range)) {
      const arrayRange = range as unknown[][];
      const targetRow = arrayRange[rowNum - 1];
      if (!targetRow || targetRow.length < colNum) throw FormulaError.REF;
      return targetRow[colNum - 1];
    }
  }
  throw FormulaError.REF;
}

/**
 * Given an already-loaded workbook, resolves the effective value of a
 * formula cell that has no cached result — recursively (a referenced cell
 * that is itself an uncached formula recurses into the same `resolve`),
 * memoized (a cell already resolved this pass is never recomputed), and
 * cycle-safe (re-entering a cell already being resolved on the current call
 * stack resolves immediately as `{ resolved: false }`). One `FormulaParser`
 * instance backs the whole resolver, so the memo — and its `MATCH`/`INDEX`
 * gap-fixes above — apply uniformly across every sheet.
 */
export function createFormulaResolver(workbook: ExcelJS.Workbook): {
  resolve(sheetName: string, row: number, col: number): FormulaResolution;
} {
  const memo = new Map<string, FormulaResolution>();
  const inFlight = new Set<string>();

  function resolve(sheetName: string, row: number, col: number): FormulaResolution {
    const key = cellKey(sheetName, row, col);
    const cached = memo.get(key);
    if (cached) return cached;
    if (inFlight.has(key)) return { resolved: false };

    inFlight.add(key);
    let result: FormulaResolution;
    try {
      result = computeCell(sheetName, row, col);
    } finally {
      inFlight.delete(key);
    }
    memo.set(key, result);
    return result;
  }

  function computeCell(sheetName: string, row: number, col: number): FormulaResolution {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) return { resolved: false };
    const cell = worksheet.getCell(row, col);
    const formula = formulaOf(cell.value);
    if (formula === undefined) return { resolved: true, value: cell.value };
    if (hasCachedResult(cell))
      return {
        resolved: true,
        value: (cell.value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue,
      };

    try {
      const raw = parser.parse(formula, { sheet: sheetName, row, col });
      if (raw instanceof FormulaParser.FormulaError)
        return { resolved: true, value: raw.toString() };
      return { resolved: true, value: raw as ExcelJS.CellValue };
    } catch {
      return { resolved: false };
    }
  }

  function requireResolved(sheetName: string, row: number, col: number): ExcelJS.CellValue {
    const result = resolve(sheetName, row, col);
    if (!result.resolved)
      throw new UnresolvedDependencyError(
        `unresolved dependency at ${cellKey(sheetName, row, col)}`,
      );
    return result.value;
  }

  const parser = new FormulaParser({
    functions: {
      MATCH: matchFunction as (...args: never[]) => unknown,
      INDEX: indexFunction as unknown as (...args: never[]) => unknown,
    },
    onCell: (ref) => operandOf(requireResolved(ref.sheet ?? '', ref.row, ref.col)),
    onRange: (ref) => {
      const sheet = ref.sheet ?? '';
      const rows: (FormulaScalar | null)[][] = [];
      for (let r = ref.from.row; r <= ref.to.row; r += 1) {
        const cols: (FormulaScalar | null)[] = [];
        for (let c = ref.from.col; c <= ref.to.col; c += 1)
          cols.push(operandOf(requireResolved(sheet, r, c)));
        rows.push(cols);
      }
      return rows;
    },
    onVariable: (name) => {
      const defined = workbook.definedNames.getRanges(name);
      const rangeRef = defined.ranges[0];
      if (!rangeRef) throw new UnresolvedDependencyError(`undefined name ${name}`);
      const parsed = parseDefinedNameRange(rangeRef);
      if (!parsed)
        throw new UnresolvedDependencyError(`unparseable defined name range ${rangeRef}`);
      if (parsed.from.row === parsed.to.row && parsed.from.col === parsed.to.col) {
        return { sheet: parsed.sheet, row: parsed.from.row, col: parsed.from.col };
      }
      return { sheet: parsed.sheet, from: parsed.from, to: parsed.to };
    },
  });

  return { resolve };
}
