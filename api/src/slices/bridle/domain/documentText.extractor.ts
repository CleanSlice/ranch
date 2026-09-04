import { Workbook, type CellValue } from 'exceljs';
import { extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';

export { isExtractableDocument } from './attachment.constants';

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]);

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Extract readable text from a document. Returns null when the type is not
 * extractable, the file is broken, or it simply holds no text (a scanned
 * PDF) — the caller falls back to the named-reference notice, so a bad file
 * degrades to the old behavior instead of failing the message.
 */
export async function extractDocumentText(
  mimeType: string,
  body: Buffer,
): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') return await extractPdf(body);
    if (mimeType === DOCX_MIME_TYPE) return await extractDocx(body);
    if (SPREADSHEET_MIME_TYPES.has(mimeType)) {
      return await extractSpreadsheet(body);
    }
    return null;
  } catch {
    return null;
  }
}

async function extractPdf(body: Buffer): Promise<string | null> {
  const parser = new PDFParse({ data: body });
  try {
    const result = await parser.getText();
    const text = result.text?.trim();
    return text?.length ? text : null;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(body: Buffer): Promise<string | null> {
  const result = await extractRawText({ buffer: body });
  const text = result.value?.trim();
  return text?.length ? text : null;
}

/**
 * Sheets rendered as CSV under a `== Sheet: name ==` header each — the shape
 * the model already handles well for .csv attachments. Formulas contribute
 * their cached result, not the formula text.
 */
async function extractSpreadsheet(body: Buffer): Promise<string | null> {
  const workbook = new Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);

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
    if (rows.length) {
      sections.push(`== Sheet: ${sheet.name} ==\n${rows.join('\n')}`);
    }
  });

  return sections.length ? sections.join('\n\n') : null;
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    if ('richText' in value) {
      return value.richText.map((r) => r.text).join('');
    }
    if ('result' in value) return cellText(value.result as CellValue);
    if ('text' in value) return String(value.text);
    if ('error' in value) return String(value.error);
    return '';
  }
  return String(value);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
