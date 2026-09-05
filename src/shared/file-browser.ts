export interface FileBrowserEntry {
  name: string;
  kind: 'file' | 'dir';
  size?: number;
}

export interface SpreadsheetCellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  align?: 'left' | 'center' | 'right';
}

/**
 * A plain string for an unstyled, non-formula cell; the object form appears
 * once the source file carries a style and/or a formula for that cell —
 * `value` is the cached result when the source file has one, otherwise a
 * best-effort computed fallback; `formula` (when present) is the literal
 * expression text. `formulaUnresolved` is set when neither the source file
 * nor the fallback computation could produce a value — `value` is then the
 * formula text itself, for the renderer to show muted instead of as a
 * normal result.
 */
export type SpreadsheetCell =
  | string
  | { value: string; style?: SpreadsheetCellStyle; formula?: string; formulaUnresolved?: boolean };

/** A merged range, 0-indexed and anchored at its top-left cell — the renderer applies this as that cell's colSpan/rowSpan and skips the cells it covers. */
export interface SpreadsheetMerge {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface SpreadsheetSheet {
  name: string;
  rows: SpreadsheetCell[][];
  merges: SpreadsheetMerge[];
  /** Column widths in the workbook's own character-width unit, index-aligned to columns; `undefined` where the file never set one. */
  columnWidths: (number | undefined)[];
  /** Row heights in points, index-aligned to `rows`; `undefined` where the file never set an explicit height for that row. */
  rowHeights: (number | undefined)[];
  /** Frozen leading rows/columns from the workbook's own pane split (0 when the sheet has no freeze). */
  frozenRows: number;
  frozenCols: number;
}

export type FilePreview =
  | { previewable: true; kind: 'text'; content: string; truncated: boolean }
  | { previewable: true; kind: 'spreadsheet'; sheets: SpreadsheetSheet[]; truncated: boolean }
  | { previewable: false; reason: string };
