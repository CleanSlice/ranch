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

/** Minimal but valid docx: zip with content types, rels, and one paragraph. */
async function buildDocx(text: string): Promise<Buffer> {
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
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
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
  it('renders spreadsheet sheets as CSV with sheet headers', async () => {
    const body = await buildXlsx();
    const text = await extractDocumentText(XLSX_MIME, body);

    expect(text).toContain('== Sheet: Totals ==');
    expect(text).toContain('crop,tons,note');
    // A value containing a comma is quoted, CSV-style.
    expect(text).toContain('alfalfa,120,"first, cut"');
    expect(text).toContain('oats,88');
    // Sheets with no rows do not add empty sections.
    expect(text).not.toContain('Empty');
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
