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

/** A plain string for an unstyled cell; the object form only appears when the source file actually carries a style for that cell. */
export type SpreadsheetCell = string | { value: string; style: SpreadsheetCellStyle };

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
  /** Frozen leading rows/columns from the workbook's own pane split (0 when the sheet has no freeze). */
  frozenRows: number;
  frozenCols: number;
}

export type FilePreview =
  | { previewable: true; kind: 'text'; content: string; truncated: boolean }
  | { previewable: true; kind: 'spreadsheet'; sheets: SpreadsheetSheet[]; truncated: boolean }
  | { previewable: false; reason: string };
