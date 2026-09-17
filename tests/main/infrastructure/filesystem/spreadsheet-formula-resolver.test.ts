import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { createFormulaResolver } from '../../../../src/main/infrastructure/filesystem/spreadsheet-formula-resolver.js';

function workbookWith(build: (workbook: ExcelJS.Workbook) => void): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return workbook;
}

/** Sets a formula cell with no cached `<v>` — the exact shape a script-generated (e.g. openpyxl) workbook leaves behind. */
function uncachedFormula(sheet: ExcelJS.Worksheet, ref: string, formula: string): void {
  sheet.getCell(ref).value = { formula } as ExcelJS.CellFormulaValue;
}

describe('createFormulaResolver', () => {
  it('trusts a referenced cell that already has its own cached result, instead of recomputing it', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 2;
      // Deliberately stale/wrong cache (a real A1*100 would be 200) — proves the resolver trusts it as-is rather than recomputing.
      sheet.getCell('A2').value = { formula: 'A1*100', result: 999 } as ExcelJS.CellFormulaValue;
      uncachedFormula(sheet, 'A3', 'A2+1');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 3, 1)).toEqual({ resolved: true, value: 1000 });
  });

  it('recursively resolves a chain of uncached formula cells', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 2;
      uncachedFormula(sheet, 'A2', 'A1+1');
      uncachedFormula(sheet, 'A3', 'A2+1');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 3, 1)).toEqual({ resolved: true, value: 4 });
  });

  it('resolves a named range spanning a single column', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('B1').value = 10;
      sheet.getCell('B2').value = 20;
      sheet.getCell('B3').value = 30;
      wb.definedNames.add('Sheet1!$B$1:$B$3', 'my_range');
      uncachedFormula(sheet, 'C1', 'SUM(my_range)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 60 });
  });

  it('resolves a cross-sheet cell reference', () => {
    const workbook = workbookWith((wb) => {
      const other = wb.addWorksheet('Other');
      other.getCell('A1').value = 42;
      const sheet = wb.addWorksheet('Sheet1');
      uncachedFormula(sheet, 'A1', 'Other!A1+1');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 1)).toEqual({ resolved: true, value: 43 });
  });

  it('resolves INDEX/MATCH against a named range on a different sheet, matching the originally-reported bug’s exact formula shape', () => {
    const workbook = workbookWith((wb) => {
      const catalog = wb.addWorksheet('Catalogo');
      catalog.getCell('A1').value = 'c01';
      catalog.getCell('A2').value = 'c02';
      catalog.getCell('A3').value = 'c03';
      catalog.getCell('B1').value = 5;
      catalog.getCell('B2').value = 8;
      catalog.getCell('B3').value = 13;
      wb.definedNames.add('Catalogo!$A$1:$A$3', 'entregavel_codigo');
      wb.definedNames.add('Catalogo!$B$1:$B$3', 'entregavel_horas');

      const calc = wb.addWorksheet('Calculadora');
      calc.getCell('B34').value = 'c02';
      uncachedFormula(calc, 'C34', 'INDEX(entregavel_horas,MATCH(B34,entregavel_codigo,0))');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Calculadora', 34, 3)).toEqual({ resolved: true, value: 8 });
  });

  it('resolves MATCH not-found as the genuine #N/A result, not an unresolved cell', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'x';
      sheet.getCell('A2').value = 'y';
      uncachedFormula(sheet, 'B1', 'MATCH("z",A1:A2,0)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 2)).toEqual({ resolved: true, value: '#N/A' });
  });

  it('detects a circular reference and resolves it as unresolved instead of hanging', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      uncachedFormula(sheet, 'A1', 'A2');
      uncachedFormula(sheet, 'A2', 'A1');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 1)).toEqual({ resolved: false });
  });

  it('resolves an unsupported function as unresolved', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      uncachedFormula(sheet, 'A1', 'NOTAREALFUNCTION(1)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 1)).toEqual({ resolved: false });
  });

  it('passes a genuine Excel-semantic error result through as a valid value', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 1;
      sheet.getCell('A2').value = 0;
      uncachedFormula(sheet, 'A3', 'A1/A2');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 3, 1)).toEqual({ resolved: true, value: '#DIV/0!' });
  });

  it('resolves as unresolved when a dependency is itself unresolved, instead of a partial/garbage value', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      uncachedFormula(sheet, 'A1', 'NOTAREALFUNCTION(1)');
      uncachedFormula(sheet, 'A2', 'A1+1');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 2, 1)).toEqual({ resolved: false });
  });

  it('resolves as unresolved when a name is not defined in the workbook', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      uncachedFormula(sheet, 'A1', 'SUM(does_not_exist)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 1)).toEqual({ resolved: false });
  });

  it('resolves as unresolved when a formula operand is a date, rather than silently computing a wrong number', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = new Date('2026-01-15T00:00:00.000Z');
      uncachedFormula(sheet, 'A2', 'A1+1');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 2, 1)).toEqual({ resolved: false });
  });

  it('resolves a named range pointing at a single cell', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('B3').value = 7;
      wb.definedNames.add('Sheet1!$B$3', 'single_cell_name');
      uncachedFormula(sheet, 'C1', 'single_cell_name+1');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 8 });
  });

  it('preserves the source sheet when INDEX indexes a single-cell named range on another sheet', () => {
    const workbook = workbookWith((wb) => {
      const catalog = wb.addWorksheet('Catalogo');
      catalog.getCell('B3').value = 99;
      wb.definedNames.add('Catalogo!$B$3', 'single_cell_name');
      const calc = wb.addWorksheet('Calculadora');
      calc.getCell('A1').value = 99; // same coordinates as B3, different sheet — would silently match if the sheet is dropped
      uncachedFormula(calc, 'C1', 'INDEX(single_cell_name,1,1)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Calculadora', 1, 3)).toEqual({ resolved: true, value: 99 });
  });

  it('resolves INDEX applied to an array constant', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      uncachedFormula(sheet, 'A1', 'INDEX({1,2;3,4},2,1)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 1)).toEqual({ resolved: true, value: 3 });
  });

  it('resolves INDEX with rowNum:0 as the whole column', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 1;
      sheet.getCell('B1').value = 10;
      sheet.getCell('A2').value = 2;
      sheet.getCell('B2').value = 20;
      sheet.getCell('A3').value = 3;
      sheet.getCell('B3').value = 30;
      uncachedFormula(sheet, 'C1', 'SUM(INDEX(A1:B3,0,2))');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 60 });
  });

  it('resolves INDEX with colNum:0 as the whole row', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 1;
      sheet.getCell('B1').value = 10;
      sheet.getCell('A2').value = 2;
      sheet.getCell('B2').value = 20;
      uncachedFormula(sheet, 'C1', 'SUM(INDEX(A1:B2,2,0))');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 22 });
  });

  it('resolves an explicit area_num beyond the single supported area as the genuine #REF! result (multi-area/union references are out of scope)', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 1;
      uncachedFormula(sheet, 'B1', 'INDEX(A1:A1,1,1,2)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 2)).toEqual({ resolved: true, value: '#REF!' });
  });

  it('resolves MATCH with a wildcard lookup value at match_type 0', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'apple';
      sheet.getCell('A2').value = 'banana';
      uncachedFormula(sheet, 'B1', 'MATCH("ban*",A1:A2,0)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 2)).toEqual({ resolved: true, value: 2 });
  });

  it('resolves MATCH with an ascending approximate match (match_type 1)', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 10;
      sheet.getCell('A2').value = 20;
      sheet.getCell('A3').value = 30;
      uncachedFormula(sheet, 'B1', 'MATCH(25,A1:A3,1)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 2)).toEqual({ resolved: true, value: 2 });
  });

  it('resolves MATCH with a descending approximate match (match_type -1)', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 30;
      sheet.getCell('A2').value = 20;
      sheet.getCell('A3').value = 10;
      // Smallest value >= 25 in a descending array: 30 at position 1 (20 and 10 are both < 25).
      uncachedFormula(sheet, 'B1', 'MATCH(25,A1:A3,-1)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 2)).toEqual({ resolved: true, value: 1 });
  });

  it('memoizes a cell resolved once, reusing it across multiple dependents without recomputing', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 10;
      uncachedFormula(sheet, 'A2', 'A1*2'); // shared dependency, resolved once
      uncachedFormula(sheet, 'B1', 'A2+1');
      uncachedFormula(sheet, 'B2', 'A2+2');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 2)).toEqual({ resolved: true, value: 21 });
    expect(resolver.resolve('Sheet1', 2, 2)).toEqual({ resolved: true, value: 22 });
  });
  // The resolver recurses *from inside* an in-progress `parse` (an `onCell`
  // callback resolving an uncached dependency), so a single shared parser
  // instance is re-entered mid-parse. chevrotain keeps mutable per-parse state
  // (token index, lookahead cache), and the outer parse then reads a lookahead
  // slot the nested parse invalidated. A bare `A2+1` survives it; anything that
  // returns to a function-call/binary-op chain afterwards does not — which is
  // why the reported workbook rendered some rows and not others.
  it('resolves an uncached dependency referenced from inside a function call, without corrupting the outer parse', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 10;
      uncachedFormula(sheet, 'A2', 'A1*3');
      uncachedFormula(sheet, 'A3', 'ROUND(A2/5,0)*5');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 3, 1)).toEqual({ resolved: true, value: 30 });
  });

  it('resolves two sibling uncached dependencies at the same nesting depth within one formula', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 4;
      uncachedFormula(sheet, 'B1', 'A1*2');
      uncachedFormula(sheet, 'B2', 'A1*3');
      uncachedFormula(sheet, 'C1', 'ROUND(B1/2,0)+ROUND(B2/3,0)');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 8 });
  });

  it('resolves a dependency chain three levels deep from inside nested function calls', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 100;
      uncachedFormula(sheet, 'A2', 'ROUND(A1/3,0)');
      uncachedFormula(sheet, 'A3', 'ROUND(A2/2,0)*2');
      uncachedFormula(sheet, 'A4', 'ROUND(A3/4,0)*4');
    });
    const resolver = createFormulaResolver(workbook);
    // A2 = 33, A3 = round(33/2)*2 = 34, A4 = round(34/4)*4 = 36
    expect(resolver.resolve('Sheet1', 4, 1)).toEqual({ resolved: true, value: 36 });
  });

  // `SUMIFS` is another empty stub in fast-formula-parser (`formulas/functions/math.js`'s
  // `SUMIFS: () => {}`), which its dispatcher turns into `#NAME?` — same gap as `MATCH`.
  it('resolves SUMIFS across two criteria ranges', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      const rows: [string, string, number][] = [
        ['IDV', 'não', 18],
        ['IDV', 'sim', 6],
        ['PAGE', 'não', 3],
        ['IDV', 'não', 2],
      ];
      rows.forEach(([sku, addon, hours], i) => {
        sheet.getCell(`A${i + 1}`).value = sku;
        sheet.getCell(`B${i + 1}`).value = addon;
        sheet.getCell(`C${i + 1}`).value = hours;
      });
      uncachedFormula(sheet, 'E1', 'SUMIFS($C$1:$C$4,$A$1:$A$4,"IDV",$B$1:$B$4,"não")');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 5)).toEqual({ resolved: true, value: 20 });
  });

  it('resolves SUMIFS with a comparison criteria', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      [5, 15, 25].forEach((n, i) => {
        sheet.getCell(`A${i + 1}`).value = n;
        sheet.getCell(`B${i + 1}`).value = n * 2;
      });
      uncachedFormula(sheet, 'C1', 'SUMIFS($B$1:$B$3,$A$1:$A$3,">10")');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 80 });
  });

  it('resolves SUMIFS with a wildcard criteria', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      ['alpha', 'beta', 'alpine'].forEach((s, i) => {
        sheet.getCell(`A${i + 1}`).value = s;
        sheet.getCell(`B${i + 1}`).value = (i + 1) * 10;
      });
      uncachedFormula(sheet, 'C1', 'SUMIFS($B$1:$B$3,$A$1:$A$3,"al*")');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 40 });
  });

  it('matches SUMIFS text criteria case-insensitively, as Excel does', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'Não';
      sheet.getCell('B1').value = 7;
      uncachedFormula(sheet, 'C1', 'SUMIFS($B$1:$B$1,$A$1:$A$1,"não")');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 7 });
  });

  it('resolves SUMIFS with no matching row as 0, not as an unresolved cell', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'IDV';
      sheet.getCell('B1').value = 9;
      uncachedFormula(sheet, 'C1', 'SUMIFS($B$1:$B$1,$A$1:$A$1,"NOPE")');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 0 });
  });

  it('skips a non-numeric cell in the SUMIFS sum range instead of failing the whole sum', () => {
    const workbook = workbookWith((wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'x';
      sheet.getCell('A2').value = 'x';
      sheet.getCell('B1').value = 'n/a';
      sheet.getCell('B2').value = 5;
      uncachedFormula(sheet, 'C1', 'SUMIFS($B$1:$B$2,$A$1:$A$2,"x")');
    });
    const resolver = createFormulaResolver(workbook);
    expect(resolver.resolve('Sheet1', 1, 3)).toEqual({ resolved: true, value: 5 });
  });
});
