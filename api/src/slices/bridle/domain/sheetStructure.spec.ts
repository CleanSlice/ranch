import { Workbook } from 'exceljs';
import {
  EXPECTED,
  buildSupplierInvoice,
} from './__fixtures__/buildReferenceWorkbooks';
import {
  DENSE_ROW_MIN_CELLS,
  HEADER_TEXT_RATIO,
  INDEX_ROW_MAX_VALUE,
  KV_TABLE_MIN_ROWS,
  TABLE_MIN_ROWS,
  detectSheetStructure,
  formatStructureLines,
} from './sheetStructure';
import { loadWorkbook, readSheet } from './workbook.reader';

async function structureOf(
  body: Buffer,
  sheet: string | number,
): Promise<ReturnType<typeof detectSheetStructure>> {
  const wb = await loadWorkbook(body);
  return detectSheetStructure(readSheet(wb, sheet).rows);
}

/** Small ad-hoc sheets for the layout edge cases. */
async function sheetWith(
  fill: (s: import('exceljs').Worksheet) => void,
): Promise<Buffer> {
  const wb = new Workbook();
  fill(wb.addWorksheet('S'));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('detectSheetStructure — reference invoice', () => {
  it('finds the table, its header and data span, and the title lines on sheet 1', async () => {
    const s = await structureOf(await buildSupplierInvoice(), 1);

    expect(s.tables).toHaveLength(1);
    expect(s.tables[0]).toMatchObject({
      range: 'B4:H6',
      headerRow: EXPECTED.sheet1.headerRow,
      headerCells: { B: 'Товар', C: 'Кількість', D: 'Ціна', F: 'Сума' },
      indexRow: null,
      dataRows: [5, 6],
      rowCount: 2,
    });
    expect(s.title.lines.map((l) => l.cell)).toEqual(['A1', 'A2', 'A3']);
    expect(s.title.lines[0].text).toBe(EXPECTED.sheet1.supplier);
    expect(s.title.pairs).toEqual([]);
  });

  it('lists the closing lines of sheet 1 as label → value pairs with cells', async () => {
    const s = await structureOf(await buildSupplierInvoice(), 1);
    const { pairs, lines } = s.tables[0].footer;

    expect(
      pairs.map((p) => [
        p.labelCell,
        p.label,
        p.valueCell,
        p.value,
        p.computed,
      ]),
    ).toEqual([
      ['B10', 'Сума без ПДВ', 'F10', EXPECTED.sheet1.subtotal, false],
      ['B11', 'ПДВ (20%)', 'F11', EXPECTED.sheet1.vat, true],
      ['B12', 'ВСЬОГО ДО СПЛАТИ', 'F12', EXPECTED.sheet1.grandTotal, true],
      [undefined, null, 'H13', 0.3, false],
    ]);
    expect(lines).toEqual([]);
  });

  it('lists every closing line of sheet 2, transport and payable included', async () => {
    const s = await structureOf(await buildSupplierInvoice(), 2);
    const f = EXPECTED.sheet2.footer;

    expect(s.tables).toHaveLength(1);
    expect(s.tables[0].range).toBe('B4:F7');
    expect(s.tables[0].dataRows).toEqual([5, 7]);
    expect(
      s.tables[0].footer.pairs.map((p) => [
        p.label,
        p.valueCell,
        p.value,
        p.computed,
      ]),
    ).toEqual([
      [f.subtotal.label, f.subtotal.cell, EXPECTED.sheet2.subtotal, true],
      [f.vat.label, f.vat.cell, EXPECTED.sheet2.vat, true],
      [f.withVat.label, f.withVat.cell, EXPECTED.sheet2.withVat, true],
      [f.transport.label, f.transport.cell, EXPECTED.sheet2.transport, false],
      [f.payable.label, f.payable.cell, EXPECTED.sheet2.payable, true],
    ]);
    expect(s.tables[0].footer.lines).toEqual([
      { row: f.words.row, cell: f.words.cell, text: f.words.text },
    ]);
  });

  it('reports title pairs on sheet 2', async () => {
    const s = await structureOf(await buildSupplierInvoice(), 2);
    const t = EXPECTED.sheet2.titlePair;

    expect(s.title.pairs).toEqual([
      expect.objectContaining({
        label: t.label,
        labelCell: t.labelCell,
        valueCell: t.valueCell,
        value: t.value,
        computed: false,
      }),
    ]);
    expect(s.title.lines.map((l) => l.cell)).toEqual(['A1', 'A2']);
    expect(s.title.lines[0].text).toBe(EXPECTED.sheet1.supplier);
  });
});

describe('detectSheetStructure — layouts', () => {
  it('treats a 1..n numbering row under the header as part of the header', async () => {
    const body = await sheetWith((s) => {
      s.addRow(['№', 'Назва', 'Кільк', 'Сума']);
      s.addRow([1, 2, 3, 4]);
      s.addRow([1, 'a', 2, 10]);
      s.addRow([2, 'b', 3, 15]);
    });
    const s = await structureOf(body, 1);

    expect(s.tables[0]).toMatchObject({
      headerRow: 1,
      indexRow: 2,
      dataRows: [3, 4],
      rowCount: 2,
    });
    expect(formatStructureLines(s)[0]).toContain('header R1+R2:');
  });

  it('gives each of two tables its own closing lines', async () => {
    const body = await sheetWith((s) => {
      s.addRow(['a', 'b', 'c']);
      s.addRow([1, 2, 3]);
      s.getCell('A4').value = 'Разом';
      s.getCell('C4').value = 6;
      s.addRow([]);
      s.getCell('A6').value = 'x';
      s.getCell('B6').value = 'y';
      s.getCell('C6').value = 'z';
      s.getCell('A7').value = 4;
      s.getCell('B7').value = 5;
      s.getCell('C7').value = 6;
      s.getCell('A9').value = 'Всього';
      s.getCell('C9').value = 15;
    });
    const s = await structureOf(body, 1);

    expect(s.tables.map((t) => t.range)).toEqual(['A1:C2', 'A6:C7']);
    expect(s.tables[0].footer.pairs).toEqual([
      expect.objectContaining({ label: 'Разом', valueCell: 'C4', value: 6 }),
    ]);
    expect(s.tables[1].footer.pairs).toEqual([
      expect.objectContaining({ label: 'Всього', valueCell: 'C9', value: 15 }),
    ]);
  });

  it('puts everything in the title when there are no dense rows', async () => {
    const body = await sheetWith((s) => {
      s.getCell('A1').value = 'Код';
      s.getCell('B1').value = 42;
      s.getCell('A2').value = 'Note only';
      s.getCell('A3').value = 'Сума';
      s.getCell('B3').value = { formula: 'B1*2', result: 84 };
    });
    const s = await structureOf(body, 1);

    expect(s.tables).toEqual([]);
    expect(s.title.pairs.map((p) => [p.label, p.value, p.computed])).toEqual([
      ['Код', 42, false],
      ['Сума', 84, true],
    ]);
    expect(s.title.lines).toEqual([{ row: 2, cell: 'A2', text: 'Note only' }]);
    expect(formatStructureLines(s)).toEqual([
      'title: A1 "Код" → B1=42 · A2 "Note only" · A3 "Сума" → B3=[=]84',
    ]);
  });

  it('uses a label to the right when there is none on the left', async () => {
    const body = await sheetWith((s) => {
      s.getCell('A1').value = 99;
      s.getCell('C1').value = 'штук';
    });
    const s = await structureOf(body, 1);
    expect(s.title.pairs[0]).toMatchObject({
      label: 'штук',
      labelCell: 'C1',
      valueCell: 'A1',
    });
  });

  it('shares one label between two numbers on the same row', async () => {
    const body = await sheetWith((s) => {
      s.getCell('A1').value = 'Всього';
      s.getCell('C1').value = 20;
      s.getCell('E1').value = 98.4;
    });
    const s = await structureOf(body, 1);
    expect(s.title.pairs.map((p) => [p.label, p.valueCell, p.value])).toEqual([
      ['Всього', 'C1', 20],
      ['Всього', 'E1', 98.4],
    ]);
  });

  it('keeps the span of a merged label', async () => {
    const body = await sheetWith((s) => {
      s.getCell('A1').value = 'Сума до сплати';
      s.mergeCells('A1:D1');
      s.getCell('F1').value = 2598.4;
    });
    const s = await structureOf(body, 1);
    expect(s.title.pairs[0]).toMatchObject({
      labelCell: 'A1',
      labelSpan: 'A1:D1',
      valueCell: 'F1',
    });
    expect(formatStructureLines(s)[0]).toBe(
      'title: A1[A1:D1] "Сума до сплати" → F1=2598.4',
    );
  });

  it('keeps a lone dense closing row with the pairs instead of making it a table', async () => {
    // The reported export closes with "Всього | 20 | Всього без ПДВ | 82" on
    // one row, then one label + one number per row.
    const body = await sheetWith((s) => {
      s.addRow(['№', 'Назва', 'Кільк', 'Сума']);
      s.addRow([1, 'Спрей', 20, 82]);
      s.getCell('B4').value = 'Всього';
      s.getCell('C4').value = 20;
      s.getCell('D4').value = 'Всього без ПДВ';
      s.getCell('E4').value = 82;
      s.getCell('D5').value = 'ПДВ';
      s.getCell('E5').value = 16.4;
      s.getCell('D6').value = 'Сума до сплати';
      s.getCell('E6').value = 2598.4;
    });
    const s = await structureOf(body, 1);

    expect(s.tables).toHaveLength(1);
    expect(s.tables[0].range).toBe('A1:D2');
    expect(
      s.tables[0].footer.pairs.map((p) => [p.label, p.valueCell, p.value]),
    ).toEqual([
      ['Всього', 'C4', 20],
      ['Всього без ПДВ', 'E4', 82],
      ['ПДВ', 'E5', 16.4],
      ['Сума до сплати', 'E6', 2598.4],
    ]);
  });

  it('ends the table at a closing row that sits right under the last item', async () => {
    // The reported export: header, index row, one item, then
    // "Всього | 20 | Всього без ПДВ | 82" on the very next row, then
    // label + number rows. Text in G and I — columns that held numbers —
    // is what separates the closing block from the items.
    const body = await sheetWith((s) => {
      s.addRow([
        '№',
        'Код',
        'Назва',
        'Знижка',
        'Од',
        'Кільк',
        'Ціна',
        'Ціна з ПДВ',
        'Сума',
        'Сума з ПДВ',
        'Пачок',
      ]);
      s.addRow([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      s.addRow([
        1,
        '539_30',
        'Спрей Принцеса',
        18,
        'шт',
        20,
        4.1,
        4.92,
        82,
        98.4,
        1,
      ]);
      s.getCell('G4').value = 'Всього';
      s.getCell('H4').value = 20;
      s.getCell('I4').value = 'Всього без ПДВ';
      s.getCell('J4').value = 82;
      s.getCell('I5').value = 'ПДВ';
      s.getCell('J5').value = 16.4;
      s.getCell('I6').value = 'Загальна сума з ПДВ';
      s.getCell('J6').value = 98.4;
      s.getCell('I7').value = 'Транспортні витрати';
      s.getCell('J7').value = 2500;
      s.getCell('I8').value = 'Сума до сплати';
      s.getCell('J8').value = 2598.4;
    });
    const s = await structureOf(body, 1);

    expect(s.tables).toHaveLength(1);
    expect(s.tables[0]).toMatchObject({
      range: 'A1:K3',
      headerRow: 1,
      indexRow: 2,
      dataRows: [3, 3],
    });
    expect(
      s.tables[0].footer.pairs.map((p) => [p.label, p.valueCell, p.value]),
    ).toEqual([
      ['Всього', 'H4', 20],
      ['Всього без ПДВ', 'J4', 82],
      ['ПДВ', 'J5', 16.4],
      ['Загальна сума з ПДВ', 'J6', 98.4],
      ['Транспортні витрати', 'J7', 2500],
      ['Сума до сплати', 'J8', 2598.4],
    ]);
  });

  it('treats a long two-column key | value list as a table, not as pairs', async () => {
    const body = await sheetWith((s) => {
      s.addRow(['key', 'value']);
      for (let i = 1; i <= 30; i++) s.addRow([`k${i}`, i]);
    });
    const s = await structureOf(body, 1);

    expect(s.tables).toHaveLength(1);
    expect(s.tables[0]).toMatchObject({
      range: 'A1:B31',
      headerRow: 1,
      dataRows: [2, 31],
      rowCount: 30,
    });
    expect(s.title.pairs).toEqual([]);
  });

  it('caps the items listed per segment in the preview', async () => {
    const body = await sheetWith((s) => {
      for (let i = 1; i <= 50; i++) {
        s.getCell(`A${i * 2}`).value = `label ${i}`;
        s.getCell(`B${i * 2}`).value = i;
      }
    });
    const s = await structureOf(body, 1);
    const [line] = formatStructureLines(s);

    expect(s.title.pairs).toHaveLength(50);
    expect(line).toContain('A80 "label 40" → B80=40 (+10 more)');
    expect(line).not.toContain('label 41');
  });

  it('exposes its thresholds as constants', () => {
    expect(DENSE_ROW_MIN_CELLS).toBe(3);
    expect(TABLE_MIN_ROWS).toBe(2);
    expect(KV_TABLE_MIN_ROWS).toBe(8);
    expect(HEADER_TEXT_RATIO).toBe(0.6);
    expect(INDEX_ROW_MAX_VALUE).toBe(200);
  });
});

describe('formatStructureLines — reference invoice sheet 2', () => {
  it('renders title, tables and after lines per the contract', async () => {
    const s = await structureOf(await buildSupplierInvoice(), 2);
    const lines = formatStructureLines(s);
    const f = EXPECTED.sheet2.footer;

    expect(lines[0]).toMatch(
      /^title: A1\[A1:L1\] "ТОВ \\"Асканія-Флора\\"" · A2 "Одержувач:" · A3 "ІД Код" → B3=3563416774$/,
    );
    expect(lines[1]).toBe(
      'tables: B4:F7 (header R4: B=Товар | C=Кількість | D=Ціна | F=Сума; data R5–R7)',
    );
    expect(lines[2]).toContain(
      `after B4:F7: B9 "${f.subtotal.label}" → F9=[=]${EXPECTED.sheet2.subtotal}`,
    );
    expect(lines[2]).toContain(
      `B12 "${f.transport.label}" → F12=${EXPECTED.sheet2.transport}`,
    );
    expect(lines[2]).toContain(
      `B13 "${f.payable.label}" → F13=[=]${EXPECTED.sheet2.payable}`,
    );
    expect(lines[2].endsWith(`· B14 "${f.words.text}"`)).toBe(true);
    expect(lines).toHaveLength(3);
  });
});
