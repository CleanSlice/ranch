import { readFileSync } from 'fs';
import { join } from 'path';
import { Workbook } from 'exceljs';
// jszip exports the constructor as module.exports (no default marker), so the
// CJS-interop require form is the one that works under jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import JSZip = require('jszip');
import {
  extractDocumentText,
  isExtractableDocument,
} from './documentText.extractor';
import {
  EXPECTED,
  buildLongSheet,
  buildSupplierInvoice,
} from './__fixtures__/buildReferenceWorkbooks';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function buildXlsx(): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Totals');
  sheet.addRow(['crop', 'tons', 'note']);
  sheet.addRow(['alfalfa', 120, 'first, cut']);
  sheet.addRow(['oats', 88, '']);
  const second = workbook.addWorksheet('Empty');
  void second;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * The serializer CLEAN-63 shipped (`== Sheet: name ==` + CSV rows, every
 * cell of a merged range repeated) — kept here only as the baseline the
 * size assertion measures against.
 */
async function legacyCsvDump(body: Buffer): Promise<string> {
  const workbook = new Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  const csvEscape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const cellText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (value instanceof Date) return value.toISOString();
      if ('richText' in v)
        return (v.richText as Array<{ text: string }>).map((r) => r.text).join('');
      if ('result' in v) return cellText(v.result);
      if ('text' in v) return String(v.text);
      if ('error' in v) return String(v.error);
      return '';
    }
    return String(value);
  };
  const sections: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(csvEscape(cellText(cell.value)));
      });
      rows.push(values.join(','));
    });
    if (rows.length) sections.push(`== Sheet: ${sheet.name} ==\n${rows.join('\n')}`);
  });
  return sections.join('\n\n');
}

/** Same skeleton as buildDocx, with one table instead of a paragraph. */
async function buildDocxWithTable(rows: string[][]): Promise<Buffer> {
  const cells = (r: string[]) =>
    r.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('');
  const table = `<w:tbl>${rows.map((r) => `<w:tr>${cells(r)}</w:tr>`).join('')}</w:tbl>`;
  return buildDocxBody(table);
}

/** Minimal but valid docx: zip with content types, rels, and one paragraph. */
async function buildDocx(text: string): Promise<Buffer> {
  return buildDocxBody(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`);
}

async function buildDocxBody(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('isExtractableDocument', () => {
  it('covers pdf, docx and both xlsx flavours; not legacy office', () => {
    expect(isExtractableDocument('application/pdf')).toBe(true);
    expect(isExtractableDocument(DOCX_MIME)).toBe(true);
    expect(isExtractableDocument(XLSX_MIME)).toBe(true);
    expect(isExtractableDocument(XLSM_MIME)).toBe(true);
    expect(isExtractableDocument('application/msword')).toBe(false);
    expect(isExtractableDocument('application/vnd.ms-excel')).toBe(false);
    expect(isExtractableDocument('image/png')).toBe(false);
  });
});

describe('extractDocumentText', () => {
  it('renders spreadsheet sheets as coordinate-addressed rows', async () => {
    const body = await buildXlsx();
    const text = (await extractDocumentText(XLSX_MIME, body)) ?? '';

    expect(text.split('\n')[0]).toBe(
      'Workbook: 2 sheets — 1 "Totals" (visible, 3 rows × 3 cols used, 0 merged); 2 "Empty" (visible, 0 rows × 0 cols used, 0 merged)',
    );
    expect(text).toContain(
      '== Sheet 1: Totals == visible · 3 rows × 3 cols used · rows 1–3 included · 0 rows omitted',
    );
    expect(text).toContain('R1: A=crop | B=tons | C=note');
    expect(text).toContain('R2: A=alfalfa | B=120 | C=first, cut');
    expect(text).toContain('R3: A=oats | B=88');
    // A sheet with no rows keeps its header so the model knows it exists.
    expect(text).toContain('== Sheet 2: Empty == visible · 0 rows × 0 cols used · no data rows');
  });

  describe('reference supplier invoice', () => {
    let text: string;
    beforeAll(async () => {
      text = (await extractDocumentText(XLSX_MIME, await buildSupplierInvoice())) ?? '';
    });

    it('lists every sheet up front, hidden ones included', () => {
      const first = text.split('\n')[0];
      expect(first).toMatch(/^Workbook: 3 sheets — 1 "Накл\. на склад\(1\)" \(visible/);
      expect(first).toContain(`3 "${EXPECTED.hiddenSheet}" (hidden, ${EXPECTED.sheet3.rows} rows`);
    });

    it('emits a merged value once, at its master, with its span', () => {
      expect(text).toContain(`R1: A1[${EXPECTED.sheet1.supplierSpan}]=${EXPECTED.sheet1.supplier}`);
      // Two merged regions carry the supplier name (sheet 1 A1:AN1, sheet 2
      // A1:L1) — so exactly two occurrences, never forty per row.
      const occurrences = text.split(EXPECTED.sheet1.supplier).length - 1;
      expect(occurrences).toBe(2);
    });

    it('marks blank runs and formula cells', () => {
      expect(text).toContain('(rows 7–9 empty)');
      expect(text).toContain(`R12: B=ВСЬОГО ДО СПЛАТИ | F=[=]${EXPECTED.sheet1.grandTotal}`);
      expect(text).toContain(`R10: B=Сума без ПДВ | F=${EXPECTED.sheet1.subtotal}`);
    });

    it('renders dates, percentages and errors readably', () => {
      expect(text).toContain(`H=${EXPECTED.sheet1.dateText}`);
      expect(text).toContain(`H=${EXPECTED.sheet1.percentText}`);
      expect(text).toContain(`H=${EXPECTED.sheet1.errorText}`);
      expect(text).toContain(`R13: H=${EXPECTED.sheet1.floatText}`);
    });

    it('keeps a hidden sheet to its header line with a hint', () => {
      const hidden = text
        .split('\n')
        .filter((l) => l.startsWith(`== Sheet 3: ${EXPECTED.hiddenSheet} ==`));
      expect(hidden).toHaveLength(1);
      expect(hidden[0]).toContain('hidden');
      expect(hidden[0]).toContain('pass include_hidden to query_attachment');
      expect(text).not.toContain('key-2');
    });

    it('accounts included and omitted rows on every visible sheet', () => {
      const headers = text.split('\n').filter((l) => l.startsWith('== Sheet'));
      expect(headers).toHaveLength(3);
      expect(headers[0]).toMatch(/rows 1–13 included · 0 rows omitted$/);
      expect(headers[1]).toMatch(/rows 1–7 included · 0 rows omitted$/);
    });
  });

  it('is at least 70% smaller than the legacy CSV dump for the reference invoice', async () => {
    const body = await buildSupplierInvoice();
    const legacy = await legacyCsvDump(body);
    const current = (await extractDocumentText(XLSX_MIME, body)) ?? '';

    expect(legacy.length).toBeGreaterThan(0);
    expect(current.length).toBeLessThan(legacy.length * 0.3);
  });

  it('caps rows per sheet and reports the omission', async () => {
    const text =
      (await extractDocumentText(XLSX_MIME, await buildLongSheet(300), {
        previewRowsPerSheet: 50,
      })) ?? '';

    expect(text).toContain('rows 1–50 included · 251 rows omitted');
    expect(text).toContain('R50: A=49 | B=row 49');
    expect(text).not.toContain('R51:');
  });

  it('cuts at a row boundary when the character budget runs out', async () => {
    const budget = 900;
    const text =
      (await extractDocumentText(XLSX_MIME, await buildLongSheet(300), {
        budgetChars: budget,
      })) ?? '';
    const lines = text.split('\n');

    expect(text.length).toBeLessThanOrEqual(budget);
    const header = lines.find((l) => l.startsWith('== Sheet 1: Long =='));
    expect(header).toMatch(/rows 1–(\d+) included · (\d+) rows omitted$/);
    const [, included, omitted] = /rows 1–(\d+) included · (\d+) rows omitted$/.exec(header ?? '') ?? [];
    expect(Number(included) + Number(omitted)).toBe(301);
    // Every body line is a whole row or a gap marker — nothing sliced mid-row.
    for (const l of lines.slice(lines.indexOf(header ?? '') + 1)) {
      expect(l).toMatch(/^(R\d+: .+|\(rows \d+–\d+ empty\))$/);
    }
    expect(lines[lines.length - 1]).toMatch(/^R\d+: A=\d+ \| B=row \d+$/);
  });

  it('keeps table rows together when extracting a docx', async () => {
    const body = await buildDocxWithTable([
      ['Товар', 'Сума'],
      ['Троянда', '5460'],
    ]);
    const text = (await extractDocumentText(DOCX_MIME, body)) ?? '';

    expect(text).toContain('Товар | Сума');
    expect(text).toContain('Троянда | 5460');
  });

  it('treats an xlsm the same as an xlsx', async () => {
    const body = await buildXlsx();
    const text = await extractDocumentText(XLSM_MIME, body);
    expect(text).toContain('alfalfa');
  });

  it('extracts paragraph text from a docx', async () => {
    const body = await buildDocx('Hello from the ranch docx');
    const text = await extractDocumentText(DOCX_MIME, body);
    expect(text).toContain('Hello from the ranch docx');
  });

  it('extracts the text layer of a pdf', async () => {
    const body = readFileSync(join(__dirname, '__fixtures__', 'sample.pdf'));
    const text = await extractDocumentText('application/pdf', body);
    expect(text).toContain('Ranch PDF fixture');
    expect(text).toContain('alfalfa 120');
  });

  it('returns null for broken bytes instead of throwing', async () => {
    const garbage = Buffer.from('definitely not a zip or a pdf');
    expect(await extractDocumentText(XLSX_MIME, garbage)).toBeNull();
    expect(await extractDocumentText(DOCX_MIME, garbage)).toBeNull();
    expect(await extractDocumentText('application/pdf', garbage)).toBeNull();
  });

  it('returns null for non-extractable types', async () => {
    expect(
      await extractDocumentText('application/msword', Buffer.from('x')),
    ).toBeNull();
  });
});
