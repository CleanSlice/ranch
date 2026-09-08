/**
 * Reference workbooks for the attachment extraction and query tests.
 *
 * Generated with exceljs rather than committed as binaries so no customer
 * file ever lands in the repo and every shape the extractor must handle is
 * spelled out here: merged headers spanning dozens of columns, blank
 * separator rows, formula total rows, a hidden sheet, dates, percentages
 * and an error cell.
 *
 * Run directly to write the files and print the expected answers:
 *   bun run ts-node src/slices/bridle/domain/__fixtures__/buildReferenceWorkbooks.ts ./tmp
 */
import { Workbook } from 'exceljs';

/** Sheet 1 rows: [name, qty, price]; F = qty * price. */
const SHEET1_ITEMS: Array<[string, number, number]> = [
  ['Троянда Red Naomi', 120, 45.5],
  ['Троянда Avalanche', 80, 52],
];

/** Sheet 2 rows: [name, qty, price]; F = qty * price. Max is 1476. */
const SHEET2_ITEMS: Array<[string, number, number]> = [
  ['Гербера мікс', 30, 18.2],
  ['Хризантема біла', 41, 36],
  ['Евкаліпт', 25, 24.6],
];

const VAT_RATE = 0.2;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const sheet1ItemSum = round2(
  SHEET1_ITEMS.reduce((acc, [, q, p]) => acc + q * p, 0),
);
// The fixture's "Сума без ПДВ" is a hand-entered total (as in real exports
// where the subtotal covers lines not shown) so the grand total matches the
// figures from the reported conversation.
const SHEET1_SUBTOTAL = 162_231.5;
const SHEET1_VAT = round2(SHEET1_SUBTOTAL * VAT_RATE);
const SHEET1_TOTAL = round2(SHEET1_SUBTOTAL + SHEET1_VAT);

const sheet2Sums = SHEET2_ITEMS.map(([, q, p]) => round2(q * p));
const sheet2Max = Math.max(...sheet2Sums);
const sheet2MaxRow = 5 + sheet2Sums.indexOf(sheet2Max);

/** Known answers the specs assert against. */
export const EXPECTED = {
  sheetCount: 3,
  sheetNames: ['Накл. на склад(1)', 'Накл. на склад(2)', 'Розрахунки'],
  hiddenSheet: 'Розрахунки',
  sheet1: {
    mergedRegions: 2,
    headerRow: 4,
    itemRows: [5, 6],
    emptyRows: [7, 8, 9],
    totalRows: [10, 11, 12],
    itemSum: sheet1ItemSum, // SUM(F5:F6)
    subtotal: SHEET1_SUBTOTAL, // F10 (entered)
    vat: SHEET1_VAT, // F11 = F10*20%
    grandTotal: SHEET1_TOTAL, // F12 = F10+F11
    supplier: 'ТОВ "Асканія-Флора"',
    supplierSpan: 'A1:AN1',
    dateCell: 'H4',
    dateText: '2026-08-28',
    percentCell: 'H5',
    percentText: '20%',
    errorCell: 'H6',
    errorText: '#REF!',
    floatCell: 'H13',
    floatText: '0.3',
  },
  sheet2: {
    mergedRegions: 1,
    max: sheet2Max, // 1476
    maxAddress: `F${sheet2MaxRow}`,
    sums: sheet2Sums,
    sum: round2(sheet2Sums.reduce((a, b) => a + b, 0)),
  },
  sheet3: {
    rows: 120,
  },
} as const;

/** Three-sheet supplier invoice: the shape from the reported conversation. */
export async function buildSupplierInvoice(): Promise<Buffer> {
  const wb = new Workbook();

  const s1 = wb.addWorksheet(EXPECTED.sheetNames[0]);
  s1.getCell('A1').value = EXPECTED.sheet1.supplier;
  s1.mergeCells('A1:AN1');
  s1.getCell('A2').value = 'Постачальник:';
  s1.mergeCells('A2:AN2');
  s1.getCell('B4').value = 'Товар';
  s1.getCell('C4').value = 'Кількість';
  s1.getCell('D4').value = 'Ціна';
  s1.getCell('F4').value = 'Сума';
  s1.getCell('H4').value = new Date(Date.UTC(2026, 7, 28));
  s1.getCell('H4').numFmt = 'dd.mm.yyyy';
  SHEET1_ITEMS.forEach(([name, qty, price], i) => {
    const r = 5 + i;
    s1.getCell(`B${r}`).value = name;
    s1.getCell(`C${r}`).value = qty;
    s1.getCell(`D${r}`).value = price;
    s1.getCell(`F${r}`).value = {
      formula: `C${r}*D${r}`,
      result: round2(qty * price),
    };
  });
  s1.getCell('H5').value = VAT_RATE;
  s1.getCell('H5').numFmt = '0%';
  s1.getCell('H6').value = { error: '#REF!' };
  // Rows 7–9 stay empty on purpose: the blank-run marker must fire.
  s1.getCell('B10').value = 'Сума без ПДВ';
  s1.getCell('F10').value = SHEET1_SUBTOTAL;
  s1.getCell('B11').value = 'ПДВ (20%)';
  s1.getCell('F11').value = { formula: 'F10*0.2', result: SHEET1_VAT };
  s1.getCell('B12').value = 'ВСЬОГО ДО СПЛАТИ';
  s1.getCell('F12').value = { formula: 'F10+F11', result: SHEET1_TOTAL };
  s1.getCell('H13').value = 0.1 + 0.2;

  const s2 = wb.addWorksheet(EXPECTED.sheetNames[1]);
  s2.getCell('A1').value = EXPECTED.sheet1.supplier;
  s2.mergeCells('A1:L1');
  s2.getCell('B4').value = 'Товар';
  s2.getCell('C4').value = 'Кількість';
  s2.getCell('D4').value = 'Ціна';
  s2.getCell('F4').value = 'Сума';
  SHEET2_ITEMS.forEach(([name, qty, price], i) => {
    const r = 5 + i;
    s2.getCell(`B${r}`).value = name;
    s2.getCell(`C${r}`).value = qty;
    s2.getCell(`D${r}`).value = price;
    s2.getCell(`F${r}`).value = {
      formula: `C${r}*D${r}`,
      result: round2(qty * price),
    };
  });

  const s3 = wb.addWorksheet(EXPECTED.sheetNames[2]);
  s3.state = 'hidden';
  s3.getCell('A1').value = 'k';
  s3.getCell('B1').value = 'v';
  for (let r = 2; r <= EXPECTED.sheet3.rows; r++) {
    s3.getCell(`A${r}`).value = `key-${r}`;
    s3.getCell(`B${r}`).value = r;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 100 columns declared, only A, AZ and CV populated on each of 5 rows. */
export async function buildWideSparse(): Promise<Buffer> {
  const wb = new Workbook();
  const s = wb.addWorksheet('Wide');
  for (let r = 1; r <= 5; r++) {
    s.getCell(`A${r}`).value = `a${r}`;
    s.getCell(`AZ${r}`).value = r * 10;
    s.getCell(`CV${r}`).value = `end${r}`;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One sheet with `rows` data rows under a header, values = row number. */
export async function buildLongSheet(rows = 300): Promise<Buffer> {
  const wb = new Workbook();
  const s = wb.addWorksheet('Long');
  s.getCell('A1').value = 'n';
  s.getCell('B1').value = 'label';
  for (let r = 2; r <= rows + 1; r++) {
    s.getCell(`A${r}`).value = r - 1;
    s.getCell(`B${r}`).value = `row ${r - 1}`;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main(): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('fs');
  const { join } = await import('path');
  const out = process.argv[2] ?? '.';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'supplier-invoice.xlsx'), await buildSupplierInvoice());
  writeFileSync(join(out, 'wide-sparse.xlsx'), await buildWideSparse());
  writeFileSync(join(out, 'long-sheet.xlsx'), await buildLongSheet());
  console.log(JSON.stringify(EXPECTED, null, 2));
}

if (require.main === module) {
  void main();
}
