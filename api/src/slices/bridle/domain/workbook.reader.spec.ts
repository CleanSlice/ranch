import {
  EXPECTED,
  buildLongSheet,
  buildSupplierInvoice,
  buildWideSparse,
} from './__fixtures__/buildReferenceWorkbooks';
import {
  WorkbookReadError,
  columnLetter,
  columnNumber,
  describeWorkbook,
  guessHeader,
  loadWorkbook,
  parseA1Range,
  readSheet,
  trimFloat,
} from './workbook.reader';

describe('workbook.reader — describe', () => {
  it('lists every sheet in order with state, used size and merged count', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());
    const { sheets } = describeWorkbook(wb);

    expect(sheets.map((s) => s.name)).toEqual([...EXPECTED.sheetNames]);
    expect(sheets.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(sheets[0].state).toBe('visible');
    expect(sheets[2].state).toBe('hidden');
    expect(sheets[0].mergedRegions).toBe(EXPECTED.sheet1.mergedRegions);
    expect(sheets[1].mergedRegions).toBe(EXPECTED.sheet2.mergedRegions);
    expect(sheets[2].usedRows).toBe(EXPECTED.sheet3.rows);
    expect(sheets[0].usedCols).toBeGreaterThanOrEqual(8);
  });
});

describe('workbook.reader — readSheet', () => {
  it('emits a merged region once, at its master cell, with its span', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());
    const section = readSheet(wb, 1);

    const row1 = section.rows.find((r) => r.row === 1);
    expect(row1?.cells).toHaveLength(1);
    expect(row1?.cells[0]).toMatchObject({
      address: 'A1',
      span: EXPECTED.sheet1.supplierSpan,
      value: EXPECTED.sheet1.supplier,
      computed: false,
    });
    const supplierCells = section.rows
      .flatMap((r) => r.cells)
      .filter((c) => c.value === EXPECTED.sheet1.supplier);
    expect(supplierCells).toHaveLength(1);
  });

  it('flags formula cells as computed and carries their cached value', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());
    const section = readSheet(wb, 1);
    const f12 = section.rows
      .flatMap((r) => r.cells)
      .find((c) => c.address === 'F12');

    expect(f12).toMatchObject({
      computed: true,
      value: EXPECTED.sheet1.grandTotal,
      display: String(EXPECTED.sheet1.grandTotal),
    });
    const f10 = section.rows.flatMap((r) => r.cells).find((c) => c.address === 'F10');
    expect(f10?.computed).toBe(false);
  });

  it('does not emit empty rows but keeps the row numbers of the others', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());
    const section = readSheet(wb, 1);
    const numbers = section.rows.map((r) => r.row);

    for (const r of EXPECTED.sheet1.emptyRows) expect(numbers).not.toContain(r);
    expect(numbers).toEqual(expect.arrayContaining([1, 2, 4, 5, 6, 10, 11, 12]));
    expect(section.includedRows?.[0]).toBe(1);
  });

  it('renders dates, percentages, errors and floats unambiguously', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());
    const cells = readSheet(wb, 1).rows.flatMap((r) => r.cells);
    const by = (a: string) => cells.find((c) => c.address === a);

    expect(by(EXPECTED.sheet1.dateCell)?.display).toBe(EXPECTED.sheet1.dateText);
    expect(by(EXPECTED.sheet1.percentCell)?.display).toBe(EXPECTED.sheet1.percentText);
    expect(by(EXPECTED.sheet1.errorCell)).toMatchObject({
      display: EXPECTED.sheet1.errorText,
      error: EXPECTED.sheet1.errorText,
    });
    expect(by(EXPECTED.sheet1.floatCell)?.display).toBe(EXPECTED.sheet1.floatText);
  });

  it('yields only populated cells on a wide sparse sheet', async () => {
    const wb = await loadWorkbook(await buildWideSparse());
    const section = readSheet(wb, 'Wide');

    expect(section.rows).toHaveLength(5);
    for (const r of section.rows) {
      expect(r.cells.map((c) => c.address)).toEqual([`A${r.row}`, `AZ${r.row}`, `CV${r.row}`]);
    }
  });

  it('refuses a hidden sheet unless includeHidden is set', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());

    expect(() => readSheet(wb, EXPECTED.hiddenSheet)).toThrow(WorkbookReadError);
    expect(() => readSheet(wb, EXPECTED.hiddenSheet)).toThrow(/hidden/);
    const section = readSheet(wb, EXPECTED.hiddenSheet, { includeHidden: true });
    expect(section.rows).toHaveLength(EXPECTED.sheet3.rows);
  });

  it('resolves a sheet by name case-insensitively and reports unknown ones', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());

    expect(readSheet(wb, 'накл. на склад(2)').info.index).toBe(2);
    expect(() => readSheet(wb, 'Итого')).toThrow(
      /Sheet "Итого" not found; available: 1 "Накл. на склад\(1\)", 2 "Накл. на склад\(2\)", 3 "Розрахунки" \(hidden\)/,
    );
    expect(() => readSheet(wb, 9)).toThrow(WorkbookReadError);
  });

  it('honours a range and clips it to the used area with a warning', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());
    const section = readSheet(wb, 1, { range: 'B4:F999' });

    expect(section.rows.map((r) => r.row)).toEqual([4, 5, 6, 10, 11, 12]);
    expect(section.rows[0].cells.map((c) => c.address)).toEqual(['B4', 'C4', 'D4', 'F4']);
    expect(section.warnings[0]).toMatch(/clipped/);
  });

  it('caps emitted rows and counts the rest as omitted', async () => {
    const wb = await loadWorkbook(await buildLongSheet(300));
    const section = readSheet(wb, 1, { maxRows: 50 });

    expect(section.rows).toHaveLength(50);
    expect(section.includedRows).toEqual([1, 50]);
    expect(section.omittedRows).toBe(251);
    expect(section.truncated).toBe(true);
  });

  it('rejects a range over the cell cap and a malformed range', async () => {
    const wb = await loadWorkbook(await buildLongSheet(300));

    expect(() => readSheet(wb, 1, { range: 'A1:B301', maxCells: 100 })).toThrow(
      /Range covers 602 cells; narrow it below 100/,
    );
    expect(() => readSheet(wb, 1, { range: 'nope' })).toThrow(/A1 notation/);
  });

  it('accepts a column span and a single cell as ranges', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());

    const col = readSheet(wb, 2, { range: 'F:F' });
    expect(col.rows.map((r) => r.row)).toEqual([4, 5, 6, 7]);
    const one = readSheet(wb, 2, { range: EXPECTED.sheet2.maxAddress });
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0].cells[0].value).toBe(EXPECTED.sheet2.max);
  });
});

describe('workbook.reader — helpers', () => {
  it('guesses the header row as the first row with two text cells', async () => {
    const wb = await loadWorkbook(await buildSupplierInvoice());
    const guess = guessHeader(readSheet(wb, 1).rows);

    expect(guess).toEqual({
      row: EXPECTED.sheet1.headerRow,
      cells: { B: 'Товар', C: 'Кількість', D: 'Ціна', F: 'Сума' },
    });
  });

  it('converts column letters both ways', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(40)).toBe('AN');
    expect(columnNumber('AN')).toBe(40);
    expect(columnNumber('cv')).toBe(100);
  });

  it('parses A1 ranges in any corner order', () => {
    expect(parseA1Range('F12:B4')).toEqual({ top: 4, left: 2, bottom: 12, right: 6 });
    expect(parseA1Range('F:F', 20)).toEqual({ top: 1, left: 6, bottom: 20, right: 6 });
  });

  it('trims floating point noise', () => {
    expect(trimFloat(0.1 + 0.2)).toBe(0.3);
    expect(trimFloat(194677.8)).toBe(194677.8);
    expect(trimFloat(1476)).toBe(1476);
  });
});
