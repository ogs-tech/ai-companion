import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type {
  FileBrowserEntry,
  FileBrowserPort,
  FilePreview,
} from '../../application/ports/file-browser-port.js';
import type {
  SpreadsheetCell,
  SpreadsheetCellStyle,
  SpreadsheetMerge,
  SpreadsheetSheet,
} from '../../../shared/file-browser.js';
import { DomainError } from '../../domain/errors.js';
import { createFormulaResolver, formulaOf } from './spreadsheet-formula-resolver.js';

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
    const grouped = value.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals || 2,
      maximumFractionDigits: decimals || 2,
    });
    return `${currencySymbol} ${grouped}`;
  }
  if (numFmt.includes('#,##0')) {
    return value.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return String(value);
}

/** Best-effort, view-only stringification of a cell's value — no formula recalculation, just what the workbook last had cached. */
function cellToText(value: ExcelJS.CellValue, numFmt: string | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return formatNumber(value, numFmt);
  if (typeof value === 'object') {
    if ('result' in value)
      return cellToText((value as ExcelJS.CellFormulaValue).result ?? '', numFmt);
    if ('richText' in value)
      return (value as ExcelJS.CellRichTextValue).richText.map((run) => run.text).join('');
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

function alignmentOf(
  horizontal: ExcelJS.Alignment['horizontal'] | undefined,
): 'left' | 'center' | 'right' | undefined {
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
  return {
    row: start.row,
    col: start.col,
    rowSpan: end.row - start.row + 1,
    colSpan: end.col - start.col + 1,
  };
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

/**
 * exceljs always writes (and expects to read back) a worksheet's comments
 * part at the flat `xl/commentsN.xml` path. Some other generators — notably
 * openpyxl — place it at a nested path like `xl/comments/commentN.xml`
 * instead, which is valid per the OOXML relationship model but isn't
 * recognized by exceljs's regex-based part scan. The unrecognized part is
 * silently skipped, but the worksheet's own `_rels` file still carries a
 * relationship pointing at it, and reconciling that relationship crashes
 * with a raw `TypeError` (exceljs issue, unpatched as of 4.4.0). The preview
 * never renders cell comments, so the fix is to drop the dangling
 * comments/vmlDrawing relationships before handing the buffer to exceljs,
 * rather than reproduce its parser.
 */
async function stripCommentRelationships(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const relsEntries = Object.keys(zip.files).filter((name) =>
    /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name),
  );
  for (const relsPath of relsEntries) {
    const xml = await zip.file(relsPath)?.async('string');
    if (!xml) continue;
    const cleaned = xml.replace(/<Relationship\b[^>]*\/>/g, (tag) =>
      /Type="[^"]*\/relationships\/(comments|vmlDrawing)"/.test(tag) ? '' : tag,
    );
    if (cleaned !== xml) zip.file(relsPath, cleaned);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled .d.ts shadows the global `Buffer` with its own
  // module-local (and incompatible) ambient interface, so a plain `as
  // Buffer` still fails structurally — extracting the parameter type
  // directly sidesteps the name clash without an `any` escape hatch.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

async function readSpreadsheet(buffer: Buffer): Promise<FilePreview> {
  let workbook: ExcelJS.Workbook;
  try {
    workbook = await loadWorkbook(buffer);
  } catch {
    try {
      workbook = await loadWorkbook(await stripCommentRelationships(buffer));
    } catch {
      return { previewable: false, reason: 'Could not read this spreadsheet' };
    }
  }

  let truncated = false;
  const formulaResolver = createFormulaResolver(workbook);
  const sheets: SpreadsheetSheet[] = workbook.worksheets.map((worksheet) => {
    // A dense, rectangular walk by real 1-based row/column number — not
    // `worksheet.eachRow`, which silently skips a row with zero cells (so a
    // fully blank row would shift every row after it up by one) and whose
    // per-row `eachCell` only reaches that row's own last touched column (so
    // a short row wouldn't line up under the sheet's widest one). Row/column
    // identification (the whole point of adding headers) depends on every
    // row array's index and length matching the file's real coordinates.
    const totalRows = worksheet.lastRow?.number ?? 0;
    const totalCols = worksheet.columnCount;
    const rowLimit = Math.min(totalRows, MAX_PREVIEW_ROWS);
    if (totalRows > MAX_PREVIEW_ROWS) truncated = true;

    const rows: SpreadsheetCell[][] = [];
    const rowHeights: (number | undefined)[] = [];
    for (let r = 1; r <= rowLimit; r += 1) {
      const row = worksheet.getRow(r);
      rowHeights.push(row.height);
      const rowCells: SpreadsheetCell[] = [];
      for (let c = 1; c <= totalCols; c += 1) {
        const cell = row.getCell(c);
        let text = cellToText(cell.value, cell.numFmt);
        const style = styleOf(cell);
        const formula = formulaOf(cell.value);
        if (formula !== undefined) {
          let formulaUnresolved = false;
          // No cached <v> to display — script-generated workbooks (openpyxl and
          // similar) write formula text but never evaluate it. Fall back to a
          // best-effort computed value rather than leaving the cell blank.
          if (text === '') {
            const resolution = formulaResolver.resolve(worksheet.name, r, c);
            if (resolution.resolved) {
              text = cellToText(resolution.value, cell.numFmt);
            } else {
              text = formula;
              formulaUnresolved = true;
            }
          }
          rowCells.push({
            value: text,
            formula,
            ...(style ? { style } : {}),
            ...(formulaUnresolved ? { formulaUnresolved: true } : {}),
          });
        } else {
          rowCells.push(style ? { value: text, style } : text);
        }
      }
      rows.push(rowCells);
    }

    const merges = (worksheet.model.merges ?? [])
      .map(parseMergeRange)
      .filter((merge) => merge.row < rows.length)
      .map((merge) => ({ ...merge, rowSpan: Math.min(merge.rowSpan, rows.length - merge.row) }));

    const columnWidths = (worksheet.columns ?? []).map((column) => column.width);

    // Typed as always an array, but exceljs leaves it `null` at runtime for a worksheet that never had its view configured.
    const view = (worksheet.views ?? [])[0] as unknown as FrozenWorksheetView | undefined;
    const frozenRows = view?.state === 'frozen' ? (view.ySplit ?? 0) : 0;
    const frozenCols = view?.state === 'frozen' ? (view.xSplit ?? 0) : 0;

    return { name: worksheet.name, rows, merges, columnWidths, rowHeights, frozenRows, frozenCols };
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
      return {
        previewable: false,
        reason: `File is too large to preview (over ${MAX_READABLE_BYTES / (1024 * 1024)}MB)`,
      };
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
      throw new DomainError(
        'validation',
        `Content exceeds the ${MAX_READABLE_BYTES / (1024 * 1024)}MB write limit`,
      );
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
