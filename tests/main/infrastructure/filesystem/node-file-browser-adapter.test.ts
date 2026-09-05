import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';

async function writeWorkbook(
  path: string,
  build: (workbook: ExcelJS.Workbook) => void,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  await workbook.xlsx.writeFile(path);
}

/**
 * exceljs always writes its own comments part at the flat `xl/commentsN.xml`
 * path it also expects on read. Some other generators (e.g. openpyxl) place
 * it at a nested path like `xl/comments/commentN.xml` instead — valid per
 * the OOXML relationship model, but it crashes exceljs's reconciliation
 * (see node-file-browser-adapter.ts's `stripCommentRelationships`). Move the
 * comments part exceljs just wrote to that nested shape to reproduce it.
 */
async function relocateCommentsToNestedPath(path: string): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const commentsEntry = Object.keys(zip.files).find((name) => /^xl\/comments\d+\.xml$/.test(name));
  if (!commentsEntry) throw new Error('expected workbook to contain a comments part');
  const commentsXml = await zip.file(commentsEntry)?.async('string');
  if (!commentsXml) throw new Error('could not read comments part');
  const nestedName = commentsEntry.replace('xl/comments', 'xl/comments/comment');
  zip.file(nestedName, commentsXml);
  zip.remove(commentsEntry);

  const relsEntry = Object.keys(zip.files).find((name) =>
    /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name),
  );
  if (!relsEntry) throw new Error('expected a worksheet rels part referencing the comments');
  const relsXml = await zip.file(relsEntry)?.async('string');
  if (!relsXml) throw new Error('could not read worksheet rels part');
  zip.file(relsEntry, relsXml.replace(`/${commentsEntry}`, `/${nestedName}`));

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(path, buffer);
}

/**
 * Blanks out a specific cell's cached `<v>` in the raw worksheet XML —
 * reproducing what a formula-writing-only generator (openpyxl and similar)
 * leaves behind: `<f>` present, `<v>` empty, exactly the shape that made
 * `calculator_catalog.xlsx`'s C34 render blank (see the design spec).
 */
async function blankCachedValue(path: string, cellRef: string): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const sheetEntry = Object.keys(zip.files).find((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );
  if (!sheetEntry) throw new Error('expected a worksheet part');
  const xml = await zip.file(sheetEntry)?.async('string');
  if (!xml) throw new Error('could not read worksheet part');
  const cellPattern = new RegExp(`(<c r="${cellRef}"[^>]*><f>[^<]*</f>)<v>[^<]*</v>`);
  if (!cellPattern.test(xml)) throw new Error(`expected cell ${cellRef} to have a cached <v>`);
  zip.file(sheetEntry, xml.replace(cellPattern, '$1<v />'));
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

let dir: string;
const adapter = new NodeFileBrowserAdapter();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'file-browser-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('NodeFileBrowserAdapter.listDir', () => {
  it('lists directories before files, both alphabetically, skipping dotfiles', async () => {
    await mkdir(join(dir, 'zeta'));
    await mkdir(join(dir, 'alpha'));
    await writeFile(join(dir, 'b.txt'), 'b');
    await writeFile(join(dir, 'a.txt'), 'a');
    await writeFile(join(dir, '.hidden'), 'x');
    const entries = await adapter.listDir(dir);
    expect(entries.map((e) => e.name)).toEqual(['alpha', 'zeta', 'a.txt', 'b.txt']);
    expect(entries.find((e) => e.name === 'a.txt')?.kind).toBe('file');
    expect(entries.find((e) => e.name === 'alpha')?.kind).toBe('dir');
  });

  it('includes size for files', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const entries = await adapter.listDir(dir);
    expect(entries[0]).toMatchObject({ name: 'a.txt', kind: 'file', size: 5 });
  });

  it('throws not_found for a missing directory', async () => {
    await expect(adapter.listDir(join(dir, 'nope'))).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('NodeFileBrowserAdapter.readFile', () => {
  it('returns previewable content for a small text file', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello world');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({
      previewable: true,
      kind: 'text',
      content: 'hello world',
      truncated: false,
    });
  });

  it('throws not_found for a missing file', async () => {
    await expect(adapter.readFile(join(dir, 'nope.txt'))).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('treats a file containing a NUL byte as not previewable', async () => {
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    const preview = await adapter.readFile(join(dir, 'bin.dat'));
    expect(preview.previewable).toBe(false);
  });

  it('treats a file over 5MB as not previewable without reading its content', async () => {
    await writeFile(join(dir, 'big.txt'), Buffer.alloc(6 * 1024 * 1024, 'a'));
    const preview = await adapter.readFile(join(dir, 'big.txt'));
    expect(preview).toEqual({ previewable: false, reason: expect.stringContaining('large') });
  });

  it('truncates a previewable file larger than 256KB, marking truncated:true', async () => {
    const content = 'x'.repeat(300 * 1024);
    await writeFile(join(dir, 'medium.txt'), content);
    const preview = await adapter.readFile(join(dir, 'medium.txt'));
    if (!preview.previewable || preview.kind !== 'text') throw new Error('expected a text preview');
    expect(preview.truncated).toBe(true);
    expect(preview.content.length).toBe(256 * 1024);
  });
});

describe('NodeFileBrowserAdapter.readFile — spreadsheet (.xlsx)', () => {
  it('parses a single-sheet workbook into a grid of stringified cell values', async () => {
    const path = join(dir, 'catalog.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Catalog');
      sheet.addRow(['Name', 'Price']);
      sheet.addRow(['Widget', 9.99]);
    });

    const preview = await adapter.readFile(path);
    expect(preview).toEqual({
      previewable: true,
      kind: 'spreadsheet',
      truncated: false,
      sheets: [
        {
          name: 'Catalog',
          rows: [
            ['Name', 'Price'],
            ['Widget', '9.99'],
          ],
          merges: [],
          columnWidths: [undefined, undefined],
          rowHeights: [undefined, undefined],
          frozenRows: 0,
          frozenCols: 0,
        },
      ],
    });
  });

  it('captures the formula text alongside the cached result, instead of discarding it', async () => {
    const path = join(dir, 'formula.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 2;
      sheet.getCell('A2').value = 3;
      sheet.getCell('A3').value = { formula: 'A1+A2', result: 5 };
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['2'], ['3'], [{ value: '5', formula: 'A1+A2' }]]);
  });

  it('keeps a fully empty row in place instead of skipping it, so row numbers stay accurate', async () => {
    const path = join(dir, 'gap-row.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'top';
      // row 2 intentionally left completely empty
      sheet.getCell('A3').value = 'bottom';
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['top'], [''], ['bottom']]);
  });

  it("pads every row to the sheet's widest row, so column headers line up with every row", async () => {
    const path = join(dir, 'ragged.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'short';
      sheet.getCell('A2').value = 'a';
      sheet.getCell('B2').value = 'b';
      sheet.getCell('C2').value = 'c';
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([
      ['short', '', ''],
      ['a', 'b', 'c'],
    ]);
  });

  it('reads explicit row heights, leaving auto-height rows undefined', async () => {
    const path = join(dir, 'row-heights.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['a']);
      sheet.addRow(['b']);
      sheet.getRow(1).height = 30;
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rowHeights).toEqual([30, undefined]);
  });

  it('formats a date cell as an ISO date', async () => {
    const path = join(dir, 'dated.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      const cell = sheet.getCell('A1');
      cell.value = new Date('2026-01-15T00:00:00.000Z');
      cell.numFmt = 'yyyy-mm-dd';
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['2026-01-15']]);
  });

  it('includes every sheet, in workbook order', async () => {
    const path = join(dir, 'multi.xlsx');
    await writeWorkbook(path, (workbook) => {
      workbook.addWorksheet('First').addRow(['a']);
      workbook.addWorksheet('Second').addRow(['b']);
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets.map((s) => s.name)).toEqual(['First', 'Second']);
  });

  it('caps a sheet at 2000 rows and marks the preview truncated', async () => {
    const path = join(dir, 'big.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      for (let i = 0; i < 2005; i += 1) sheet.addRow([String(i)]);
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.truncated).toBe(true);
    expect(preview.sheets[0]?.rows).toHaveLength(2000);
    expect(preview.sheets[0]?.rows[0]).toEqual(['0']);
  });

  it('fills a skipped cell within a row as an empty string, not a gap', async () => {
    const path = join(dir, 'gapped.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'left';
      sheet.getCell('C1').value = 'right'; // B1 intentionally left unset
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['left', '', 'right']]);
  });

  it('reports a merged range as a 0-indexed span anchored at its top-left cell', async () => {
    const path = join(dir, 'merged.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['Title', '', '']);
      sheet.addRow(['a', 'b', 'c']);
      sheet.mergeCells('A1:C1');
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.merges).toEqual([{ row: 0, col: 0, rowSpan: 1, colSpan: 3 }]);
  });

  it('reads bold, font color, fill color and horizontal alignment into a cell style', async () => {
    const path = join(dir, 'styled.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      const cell = sheet.getCell('A1');
      cell.value = 'Total';
      cell.font = { bold: true, color: { argb: 'FF1D2B53' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE066' } };
      cell.alignment = { horizontal: 'right' };
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows[0]?.[0]).toEqual({
      value: 'Total',
      style: { bold: true, color: '#1D2B53', backgroundColor: '#FFE066', align: 'right' },
    });
  });

  it('leaves an unstyled cell as a plain string, not a style-carrying object', async () => {
    const path = join(dir, 'unstyled.xlsx');
    await writeWorkbook(path, (workbook) => {
      workbook.addWorksheet('Sheet1').addRow(['plain']);
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows[0]?.[0]).toBe('plain');
  });

  it('formats a currency-formatted number with its symbol and grouped decimals', async () => {
    const path = join(dir, 'currency.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      const cell = sheet.getCell('A1');
      cell.value = 1234.5;
      cell.numFmt = '"R$" #,##0.00';
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows[0]).toEqual(['R$ 1.234,50']);
  });

  it('formats a percentage-formatted number as a scaled value with a % suffix', async () => {
    const path = join(dir, 'percent.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      const cell = sheet.getCell('A1');
      cell.value = 0.5;
      cell.numFmt = '0%';
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows[0]).toEqual(['50%']);
  });

  it('reads explicit column widths, leaving auto-width columns undefined', async () => {
    const path = join(dir, 'widths.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['a', 'b']);
      sheet.getColumn(1).width = 24;
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.columnWidths).toEqual([24, undefined]);
  });

  it('reads a frozen-pane split into frozenRows/frozenCols', async () => {
    const path = join(dir, 'frozen.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['a', 'b']);
      sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.frozenRows).toBe(1);
    expect(preview.sheets[0]?.frozenCols).toBe(1);
  });

  it('previews a workbook whose comments part sits at a nested path (as openpyxl writes them), dropping the comment', async () => {
    const path = join(dir, 'openpyxl-comment.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'Widget';
      sheet.getCell('A1').note = 'internal note';
    });
    await relocateCommentsToNestedPath(path);

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['Widget']]);
  });

  it('computes a fallback value for a formula cell whose cached result was blanked out (e.g. by openpyxl)', async () => {
    const path = join(dir, 'blanked.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 2;
      sheet.getCell('A2').value = 3;
      sheet.getCell('A3').value = { formula: 'A1+A2', result: 5 };
    });
    await blankCachedValue(path, 'A3');

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['2'], ['3'], [{ value: '5', formula: 'A1+A2' }]]);
  });

  it('falls back to the formula text with formulaUnresolved:true when the value cannot be computed', async () => {
    const path = join(dir, 'unresolved.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = { formula: 'NOTAREALFUNCTION(1)', result: 5 };
    });
    await blankCachedValue(path, 'A1');

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet')
      throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([
      [{ value: 'NOTAREALFUNCTION(1)', formula: 'NOTAREALFUNCTION(1)', formulaUnresolved: true }],
    ]);
  });

  it('treats a file with an .xlsx extension that is not a real workbook as not previewable, without throwing', async () => {
    const path = join(dir, 'fake.xlsx');
    await writeFile(path, 'this is not a real xlsx file');
    const preview = await adapter.readFile(path);
    expect(preview.previewable).toBe(false);
  });
});

describe('NodeFileBrowserAdapter.writeFile', () => {
  it('overwrites an existing file in place', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    await adapter.writeFile(join(dir, 'a.txt'), 'goodbye');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({
      previewable: true,
      kind: 'text',
      content: 'goodbye',
      truncated: false,
    });
  });

  it('accepts writing an empty string', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    await adapter.writeFile(join(dir, 'a.txt'), '');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({ previewable: true, kind: 'text', content: '', truncated: false });
  });

  it('throws not_found for a file that does not exist yet (never creates a new file)', async () => {
    await expect(adapter.writeFile(join(dir, 'nope.txt'), 'x')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('throws validation when the target is a directory', async () => {
    await mkdir(join(dir, 'sub'));
    await expect(adapter.writeFile(join(dir, 'sub'), 'x')).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  it('throws validation when content exceeds the 5MB write cap', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const big = 'x'.repeat(6 * 1024 * 1024);
    await expect(adapter.writeFile(join(dir, 'a.txt'), big)).rejects.toMatchObject({
      kind: 'validation',
    });
  });
});

describe('NodeFileBrowserAdapter.realpath', () => {
  it('resolves a symlink to its real target', async () => {
    await mkdir(join(dir, 'real'));
    await symlink(join(dir, 'real'), join(dir, 'link'));
    const resolved = await adapter.realpath(join(dir, 'link'));
    expect(resolved).toBe(await adapter.realpath(join(dir, 'real')));
  });

  it('throws not_found for a path that does not exist', async () => {
    await expect(adapter.realpath(join(dir, 'nope'))).rejects.toMatchObject({ kind: 'not_found' });
  });
});
