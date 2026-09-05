/**
 * `fast-formula-parser` ships no `.d.ts` (verified against the published
 * tarball — no `@types/fast-formula-parser` package exists either). This
 * covers only the constructor options, `parse` shape, and the handful of
 * static helpers `spreadsheet-formula-resolver.ts`'s custom `MATCH`/`INDEX`
 * overrides actually call — not a full port of the library's API.
 */
declare module 'fast-formula-parser' {
  export interface CellRefPosition {
    sheet?: string;
    row: number;
    col: number;
  }

  export interface RangeRefPosition {
    sheet?: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  }

  /** The shape a cell/range-reference argument arrives in for a function registered in `funsNeedContextAndNoDataRetrieve` (e.g. `INDEX`) — raw, not yet dereferenced into a value. */
  export interface CellRefArg {
    ref: CellRefPosition;
  }
  export interface RangeRefArg {
    ref: RangeRefPosition;
  }

  export type FormulaScalar = number | string | boolean;

  export class FormulaError extends Error {
    readonly error: string;
    static readonly DIV0: FormulaError;
    static readonly NA: FormulaError;
    static readonly NAME: FormulaError;
    static readonly NULL: FormulaError;
    static readonly NUM: FormulaError;
    static readonly REF: FormulaError;
    static readonly VALUE: FormulaError;
  }

  export interface FormulaTypes {
    readonly NUMBER: 0;
    readonly ARRAY: 1;
    readonly BOOLEAN: 2;
    readonly STRING: 3;
    readonly RANGE_REF: 4;
    readonly CELL_REF: 5;
    readonly COLLECTIONS: 6;
    readonly NUMBER_NO_BOOLEAN: 10;
  }

  export interface WildCardHelper {
    isWildCard(value: unknown): boolean;
    toRegex(text: string, flags?: string): RegExp;
  }

  /** A function arg already unwrapped to `{value, isArray}` by the parser's own dispatcher (for any function not in `funsNeedContextAndNoDataRetrieve`/`funsNeedContext`, e.g. our `MATCH` override) — `accept` narrows it further by `type`. */
  export interface ResolvedFormulaArg {
    value?: unknown;
    isArray?: boolean;
  }

  export interface FormulaHelpersApi {
    /** No `type` — returns the argument's own value as-is (used to preserve a lookup value's native type). */
    accept(param: unknown): FormulaScalar;
    /** `Types.NUMBER` — coerces to a number, `defValue` when the argument was omitted. */
    accept(param: unknown, type: 0, defValue?: number): number;
    /** `Types.ARRAY` with `flat: true` — a deeply-flattened 1D array (what `MATCH`'s lookup array needs). */
    accept(param: unknown, type: 1, defValue: undefined, flat: true): FormulaScalar[];
    isRangeRef(param: unknown): param is RangeRefArg;
    isCellRef(param: unknown): param is CellRefArg;
  }

  export interface FormulaParserContext {
    utils: {
      /** Dereferences a raw cell/range-ref argument (or passes a plain value through) into its actual value. */
      extractRefValue(param: unknown): { val: unknown; isArray: boolean };
    };
  }

  export type CustomFunction = (...args: never[]) => unknown;

  export interface FormulaParserConfig {
    functions?: Record<string, CustomFunction>;
    /** Should only return a range or cell reference — `null`/`undefined` for an unresolvable name. */
    onVariable?: (
      name: string,
      sheetName: string,
    ) => RangeRefPosition | CellRefPosition | null | undefined;
    onCell?: (ref: CellRefPosition) => FormulaScalar | null | undefined;
    onRange?: (ref: RangeRefPosition) => (FormulaScalar | null)[][];
  }

  export interface FormulaPosition {
    row: number;
    col: number;
    sheet: string;
  }

  export default class FormulaParser {
    static readonly FormulaError: typeof FormulaError;
    static readonly FormulaHelpers: FormulaHelpersApi;
    static readonly Types: FormulaTypes;
    static readonly WildCard: WildCardHelper;

    constructor(config?: FormulaParserConfig);
    parse(formula: string, position: FormulaPosition, allowReturnArray?: boolean): unknown;
  }
}
