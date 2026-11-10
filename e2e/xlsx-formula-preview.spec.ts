import { test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, launchApp, seedWorkspaceRegistry, type AppSession } from './fixtures/app.js';

const WORKBOOK_NAME = 'calculator_catalog.xlsx';

/**
 * A miniature of the reported workbook: every formula cell is written without
 * a cached `<v>` (the shape openpyxl leaves behind, verified against the real
 * file), so the whole grid depends on the main process's fallback resolver.
 *
 * It reproduces both root causes the real file hit:
 *  - `F11`/`F12` nest an uncached dependency inside a function call
 *    (`ROUND(D11*INDEX(...)/5,0)*5`), which re-enters the formula parser
 *    mid-parse;
 *  - `D5`/`E5` use `SUMIFS`, which the underlying parser ships as an
 *    unimplemented stub, and which aggregates over the cells above — so a
 *    single unresolved dependency cascades through the whole sheet.
 *
 * The accented sheet name is deliberate: the real file's is `Catálogo`.
 */
async function writeFixtureWorkbook(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  const config = workbook.addWorksheet('Config');
  config.getCell('A10').value = 'DESS';
  config.getCell('F10').value = 300;
  config.getCell('A11').value = 'DESP';
  config.getCell('F11').value = 200;

  const catalog = workbook.addWorksheet('Catálogo');
  catalog.getCell('A11').value = 'BASE';
  catalog.getCell('D11').value = 18;
  catalog.getCell('E11').value = 'DESS';
  catalog.getCell('A12').value = 'LOGO';
  catalog.getCell('D12').value = 6;
  catalog.getCell('E12').value = 'DESP';
  for (const row of [11, 12]) {
    catalog.getCell(`F${row}`).value = {
      formula: `ROUND(D${row}*INDEX('Config'!$F$10:$F$11,MATCH($E${row},'Config'!$A$10:$A$11,0))/5,0)*5`,
    } as ExcelJS.CellFormulaValue;
  }

  const associations: [string, string, string, number][] = [
    ['IDV', 'BASE', 'não', 18],
    ['IDV', 'LOGO', 'sim', 6],
  ];
  associations.forEach(([product, deliverable, addon, hours], i) => {
    const row = 23 + i;
    catalog.getCell(`A${row}`).value = product;
    catalog.getCell(`B${row}`).value = deliverable;
    catalog.getCell(`C${row}`).value = addon;
    catalog.getCell(`D${row}`).value = hours;
    catalog.getCell(`E${row}`).value = {
      formula: `INDEX($F$11:$F$12,MATCH($B${row},$A$11:$A$12,0))`,
    } as ExcelJS.CellFormulaValue;
  });

  catalog.getCell('A5').value = 'IDV';
  catalog.getCell('D5').value = {
    formula: 'SUMIFS($D$23:$D$24,$A$23:$A$24,$A5,$C$23:$C$24,"não")',
  } as ExcelJS.CellFormulaValue;
  catalog.getCell('E5').value = {
    formula: 'SUMIFS($E$23:$E$24,$A$23:$A$24,$A5,$C$23:$C$24,"não")',
  } as ExcelJS.CellFormulaValue;

  mkdirSync(dirname(path), { recursive: true });
  await workbook.xlsx.writeFile(path);
}

let session: AppSession;

test.beforeAll(async () => {
  // The workspace is opened at launch through the registry: the file tree only exists inside a workspace
  // (Início shows the workspaces list instead).
  session = await launchApp({
    seed: async (home) => {
      const projectRoot = join(home, 'studio');
      await writeFixtureWorkbook(join(projectRoot, WORKBOOK_NAME));
      seedWorkspaceRegistry(home, [{ id: 'studio', name: 'Studio', rootPath: projectRoot }], 'studio');
    },
  });
});

test.afterAll(async () => {
  await session?.close();
});

test('previews every uncached formula as its computed value, never as formula text', async () => {
  await session.page.waitForSelector('[data-testid="folder-tree"]', { timeout: 15_000 });
  await session.page.getByText(WORKBOOK_NAME, { exact: true }).first().click();
  await session.page.waitForSelector('[data-testid="spreadsheet-preview"]', { timeout: 20_000 });

  await session.page.getByRole('tab', { name: 'Catálogo' }).click();
  const grid = session.page.locator('[data-testid="spreadsheet-preview"]');

  // F11 = ROUND(18*300/5,0)*5 = 5400, reached through a nested parse.
  await expect(grid).toContainText('5400');
  // F12 = ROUND(6*200/5,0)*5 = 1200.
  await expect(grid).toContainText('1200');
  // E5 = SUMIFS over the "não" rows only = F11 = 5400, and D5 = 18 hours.
  await expect(grid).toContainText('18');

  // An unresolved cell renders its own formula text in the body, so a bare
  // function call appearing in the grid is the exact regression signature.
  await expect(grid).not.toContainText('SUMIFS(');
  await expect(grid).not.toContainText('INDEX(');
  await expect(grid).not.toContainText('ROUND(');
});
