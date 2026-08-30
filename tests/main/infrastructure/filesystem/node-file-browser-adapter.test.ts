import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';

async function writeWorkbook(path: string, build: (workbook: ExcelJS.Workbook) => void): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  await workbook.xlsx.writeFile(path);
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
    expect(preview).toEqual({ previewable: true, kind: 'text', content: 'hello world', truncated: false });
  });

  it('throws not_found for a missing file', async () => {
    await expect(adapter.readFile(join(dir, 'nope.txt'))).rejects.toMatchObject({ kind: 'not_found' });
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
          rows: [['Name', 'Price'], ['Widget', '9.99']],
          merges: [],
          columnWidths: [undefined, undefined],
          frozenRows: 0,
          frozenCols: 0,
        },
      ],
    });
  });

  it('shows the cached result of a formula cell, not the formula itself', async () => {
    const path = join(dir, 'formula.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 2;
      sheet.getCell('A2').value = 3;
      sheet.getCell('A3').value = { formula: 'A1+A2', result: 5 };
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['2'], ['3'], ['5']]);
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.rows).toEqual([['2026-01-15']]);
  });

  it('includes every sheet, in workbook order', async () => {
    const path = join(dir, 'multi.xlsx');
    await writeWorkbook(path, (workbook) => {
      workbook.addWorksheet('First').addRow(['a']);
      workbook.addWorksheet('Second').addRow(['b']);
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
    expect(preview.sheets.map((s) => s.name)).toEqual(['First', 'Second']);
  });

  it('caps a sheet at 2000 rows and marks the preview truncated', async () => {
    const path = join(dir, 'big.xlsx');
    await writeWorkbook(path, (workbook) => {
      const sheet = workbook.addWorksheet('Sheet1');
      for (let i = 0; i < 2005; i += 1) sheet.addRow([String(i)]);
    });

    const preview = await adapter.readFile(path);
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
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
    if (!preview.previewable || preview.kind !== 'spreadsheet') throw new Error('expected spreadsheet preview');
    expect(preview.sheets[0]?.frozenRows).toBe(1);
    expect(preview.sheets[0]?.frozenCols).toBe(1);
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
    expect(preview).toEqual({ previewable: true, kind: 'text', content: 'goodbye', truncated: false });
  });

  it('accepts writing an empty string', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    await adapter.writeFile(join(dir, 'a.txt'), '');
    const preview = await adapter.readFile(join(dir, 'a.txt'));
    expect(preview).toEqual({ previewable: true, kind: 'text', content: '', truncated: false });
  });

  it('throws not_found for a file that does not exist yet (never creates a new file)', async () => {
    await expect(adapter.writeFile(join(dir, 'nope.txt'), 'x')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws validation when the target is a directory', async () => {
    await mkdir(join(dir, 'sub'));
    await expect(adapter.writeFile(join(dir, 'sub'), 'x')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('throws validation when content exceeds the 5MB write cap', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    const big = 'x'.repeat(6 * 1024 * 1024);
    await expect(adapter.writeFile(join(dir, 'a.txt'), big)).rejects.toMatchObject({ kind: 'validation' });
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
