import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { FileBrowserEntry, FileBrowserPort, FilePreview } from '../../application/ports/file-browser-port.js';
import type { SpreadsheetCell, SpreadsheetCellStyle, SpreadsheetMerge, SpreadsheetSheet } from '../../../shared/file-browser.js';
import { DomainError } from '../../domain/errors.js';

const MAX_READABLE_BYTES = 5 * 1024 * 1024; // 5MB — above this, never even read the file.
const PREVIEW_CONTENT_CAP = 256 * 1024; // 256KB — previewable content is truncated to this.
const BINARY_SNIFF_BYTES = 8000;
const MAX_PREVIEW_ROWS = 2000; // per sheet — keeps the render-side table light for very long catalogs.
const CURRENCY_SYMBOLS = ['R$', '$', '€', '£', '¥'];

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

/** Right-hand decimal-zero count of a number format (e.g. 2 for `'0.00'` or `'"R$" #,##0.00'`), 0 when the format has no decimal section. */
function decimalsOf(numFmt: string): number {
  return /\.(0+)/.exec(numFmt)?.[1]?.length ?? 0;
}

/** Renders a number the way its own workbook number format displays it — percentage, currency, or thousands-grouped — falling back to the raw value for `'General'`/unset formats. Deliberately doesn't attempt full Excel date-token formatting; see `cellToText`'s Date branch. */
function formatNumber(value: number, numFmt: string | undefined): string {
  if (!numFmt || numFmt === 'General') return String(value);
  const decimals = decimalsOf(numFmt);
  if (numFmt.includes('%')) {
    return `${(value * 100).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
  }
  const currencySymbol = CURRENCY_SYMBOLS.find((symbol) => numFmt.includes(symbol));
  if (currencySymbol) {
    const grouped = value.toLocaleString('pt-BR', { minimumFractionDigits: decimals || 2, maximumFractionDigits: decimals || 2 });
    return `${currencySymbol} ${grouped}`;
  }
  if (numFmt.includes('#,##0')) {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  return String(value);
}

/** Best-effort, view-only stringification of a cell's value — no formula recalculation, just what the workbook last had cached. */
function cellToText(value: ExcelJS.CellValue, numFmt: string | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return formatNumber(value, numFmt);
  if (typeof value === 'object') {
    if ('result' in value) return cellToText((value as ExcelJS.CellFormulaValue).result ?? '', numFmt);
    if ('richText' in value) return (value as ExcelJS.CellRichTextValue).richText.map((run) => run.text).join('');
    if ('text' in value) return String((value as ExcelJS.CellHyperlinkValue).text ?? '');
    return '';
  }
  return String(value);
}

/** `#RRGGBB` from exceljs's `AARRGGBB` argb string, or `undefined` for an unset/theme-only color (theme palette resolution isn't implemented — out of scope). */
function argbToHex(argb: string | undefined): string | undefined {
  if (!argb || argb.length < 6) return undefined;
  return `#${argb.slice(-6)}`;
}

function alignmentOf(horizontal: ExcelJS.Alignment['horizontal'] | undefined): 'left' | 'center' | 'right' | undefined {
  if (horizontal === 'left') return 'left';
  if (horizontal === 'center' || horizontal === 'centerContinuous') return 'center';
  if (horizontal === 'right') return 'right';
  return undefined;
}

/** Reads the subset of the source file's cell style that the preview grid renders — `undefined` when the cell carries none of it, so unstyled cells stay plain strings on the wire. */
function styleOf(cell: ExcelJS.Cell): SpreadsheetCellStyle | undefined {
  const style: SpreadsheetCellStyle = {};
  if (cell.font?.bold) style.bold = true;
  if (cell.font?.italic) style.italic = true;
  const color = argbToHex(cell.font?.color?.argb);
  if (color) style.color = color;
  if (cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid') {
    const backgroundColor = argbToHex(cell.fill.fgColor?.argb);
    if (backgroundColor) style.backgroundColor = backgroundColor;
  }
  const align = alignmentOf(cell.alignment?.horizontal);
  if (align) style.align = align;
  return Object.keys(style).length > 0 ? style : undefined;
}

/** 1-based "A1"-style ref to a 0-based `{row, col}` pair. */
function parseCellRef(ref: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match?.[1] || !match[2]) return { row: 0, col: 0 };
  let col = 0;
  for (const letter of match[1]) col = col * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

function parseMergeRange(range: string): SpreadsheetMerge {
  const [startRef, endRef] = range.split(':');
  const start = parseCellRef(startRef ?? '');
  const end = endRef ? parseCellRef(endRef) : start;
  return { row: start.row, col: start.col, rowSpan: end.row - start.row + 1, colSpan: end.col - start.col + 1 };
}

/**
 * exceljs's `Worksheet.views` is typed `Array<Partial<WorksheetView>>`, and
 * `WorksheetView` is `WorksheetViewCommon & (Normal | Frozen | Split)` — a
 * `Partial` over a union only keeps keys common to every branch, so
 * `xSplit`/`ySplit` (frozen/split-only) never surface on the declared type
 * even though a frozen view carries them at runtime. Re-cast through this
 * narrower shape to reach them.
 */
interface FrozenWorksheetView {
  state?: string;
  xSplit?: number;
  ySplit?: number;
}

async function readSpreadsheet(buffer: Buffer): Promise<FilePreview> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's bundled .d.ts shadows the global `Buffer` with its own
    // module-local (and incompatible) ambient interface, so a plain `as
    // Buffer` still fails structurally — extracting the parameter type
    // directly sidesteps the name clash without an `any` escape hatch.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { previewable: false, reason: 'Could not read this spreadsheet' };
  }

  let truncated = false;
  const sheets: SpreadsheetSheet[] = workbook.worksheets.map((worksheet) => {
    const rows: SpreadsheetCell[][] = [];
    worksheet.eachRow((row) => {
      if (rows.length >= MAX_PREVIEW_ROWS) {
        truncated = true;
        return;
      }
      const rowCells: SpreadsheetCell[] = [];
      // `includeEmpty: true` visits every column up to the row's last
      // touched cell (not just the ones with a value), so a gap like an
      // unset B1 between a set A1 and C1 still lands as its own '' entry
      // instead of shifting C1 left.
      row.eachCell({ includeEmpty: true }, (cell) => {
        const text = cellToText(cell.value, cell.numFmt);
        const style = styleOf(cell);
        rowCells.push(style ? { value: text, style } : text);
      });
      rows.push(rowCells);
    });

    const merges = (worksheet.model.merges ?? [])
      .map(parseMergeRange)
      .filter((merge) => merge.row < rows.length)
      .map((merge) => ({ ...merge, rowSpan: Math.min(merge.rowSpan, rows.length - merge.row) }));

    const columnWidths = (worksheet.columns ?? []).map((column) => column.width);

    // Typed as always an array, but exceljs leaves it `null` at runtime for a worksheet that never had its view configured.
    const view = (worksheet.views ?? [])[0] as unknown as FrozenWorksheetView | undefined;
    const frozenRows = view?.state === 'frozen' ? (view.ySplit ?? 0) : 0;
    const frozenCols = view?.state === 'frozen' ? (view.xSplit ?? 0) : 0;

    return { name: worksheet.name, rows, merges, columnWidths, frozenRows, frozenCols };
  });

  return { previewable: true, kind: 'spreadsheet', sheets, truncated };
}

export class NodeFileBrowserAdapter implements FileBrowserPort {
  async listDir(absPath: string): Promise<FileBrowserEntry[]> {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(absPath, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Directory not found: ${absPath}`);
      throw err;
    }

    const entries: FileBrowserEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue;
      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, kind: 'dir' });
        continue;
      }
      if (dirent.isFile()) {
        const stat = await fs.stat(join(absPath, dirent.name)).catch(() => null);
        entries.push({ name: dirent.name, kind: 'file', ...(stat ? { size: stat.size } : {}) });
      }
    }

    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(absPath: string): Promise<FilePreview> {
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(absPath);
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `File not found: ${absPath}`);
      throw err;
    }
    if (!stat.isFile()) {
      throw new DomainError('validation', `Not a file: ${absPath}`);
    }
    if (stat.size > MAX_READABLE_BYTES) {
      return { previewable: false, reason: `File is too large to preview (over ${MAX_READABLE_BYTES / (1024 * 1024)}MB)` };
    }

    const buffer = await fs.readFile(absPath);

    if (absPath.toLowerCase().endsWith('.xlsx')) {
      return readSpreadsheet(buffer);
    }

    const sniffLength = Math.min(buffer.length, BINARY_SNIFF_BYTES);
    if (buffer.subarray(0, sniffLength).includes(0)) {
      return { previewable: false, reason: 'File appears to be binary' };
    }

    const truncated = buffer.length > PREVIEW_CONTENT_CAP;
    const content = buffer.subarray(0, PREVIEW_CONTENT_CAP).toString('utf8');
    return { previewable: true, kind: 'text', content, truncated };
  }

  async writeFile(absPath: string, content: string): Promise<void> {
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(absPath);
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `File not found: ${absPath}`);
      throw err;
    }
    if (!stat.isFile()) {
      throw new DomainError('validation', `Not a file: ${absPath}`);
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_READABLE_BYTES) {
      throw new DomainError('validation', `Content exceeds the ${MAX_READABLE_BYTES / (1024 * 1024)}MB write limit`);
    }
    await fs.writeFile(absPath, content, 'utf8');
  }

  async realpath(absPath: string): Promise<string> {
    try {
      return await fs.realpath(absPath);
    } catch (err) {
      if (isEnoent(err)) throw new DomainError('not_found', `Path not found: ${absPath}`);
      throw err;
    }
  }
}
