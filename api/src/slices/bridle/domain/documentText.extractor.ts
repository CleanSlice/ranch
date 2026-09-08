import { convertToHtml, extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { Workbook } from 'exceljs';
import {
  columnOf,
  describeWorkbook,
  loadWorkbook,
  readSheet,
  type CellRow,
  type SheetInfo,
} from './workbook.reader';

export { isExtractableDocument } from './attachment.constants';

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]);

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function isSpreadsheetMimeType(mimeType: string): boolean {
  return SPREADSHEET_MIME_TYPES.has(mimeType);
}

/** How much of a workbook the inline preview may carry. */
export interface ISpreadsheetPreviewOptions {
  /** Non-empty rows per sheet. Default: unlimited. */
  previewRowsPerSheet?: number;
  /** Characters for the whole body, cut at row boundaries. Default: unlimited. */
  budgetChars?: number;
}

/**
 * Extract readable text from a document. Returns null when the type is not
 * extractable, the file is broken, or it simply holds no text (a scanned
 * PDF) — the caller falls back to the named-reference notice, so a bad file
 * degrades to the old behavior instead of failing the message.
 */
export async function extractDocumentText(
  mimeType: string,
  body: Buffer,
  opts: ISpreadsheetPreviewOptions = {},
): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') return await extractPdf(body);
    if (mimeType === DOCX_MIME_TYPE) return await extractDocx(body);
    if (SPREADSHEET_MIME_TYPES.has(mimeType)) {
      return formatWorkbookPreview(await loadWorkbook(body), opts);
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

/**
 * Word documents go through HTML so tables survive as rows: a flattened
 * paragraph dump loses which number belongs to which label. The raw-text
 * path stays as the fallback for anything the HTML converter chokes on.
 */
async function extractDocx(body: Buffer): Promise<string | null> {
  let text: string | undefined;
  try {
    const result = await convertToHtml({ buffer: body });
    text = htmlToText(result.value ?? '').trim();
  } catch {
    text = undefined;
  }
  if (!text?.length) {
    const result = await extractRawText({ buffer: body });
    text = result.value?.trim();
  }
  return text?.length ? text : null;
}

/** Private marker between table cells until the line is assembled. */
const CELL_SEP = '';

/** Minimal HTML → text: block elements to lines, table cells to ` | `. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/\r/g, '')
    // A cell's inner paragraphs collapse to one line so the row stays a row.
    .replace(
      /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi,
      (_m, inner: string) =>
        inner
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() + CELL_SEP,
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(table|ul|ol)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(p|h[1-6]|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  const lines = s.split('\n').map((line) => {
    if (!line.includes(CELL_SEP)) return line.trimEnd();
    const cells = line.split(CELL_SEP);
    if (cells[cells.length - 1].trim() === '') cells.pop();
    return cells.map((c) => c.trim()).join(' | ');
  });
  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1].toLowerCase() === 'x'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

// ─── spreadsheets ───────────────────────────────────────────────────────

/** Room kept back per sheet for its header line, so the cut never eats one. */
const HEADER_RESERVE_CHARS = 160;

/**
 * The workbook as the model reads it — the format in
 * specs/009-attachment-parse-quality/contracts/agent-facing-document.md §3.
 *
 * Why this shape and not CSV: exports from accounting systems merge a title
 * across forty columns, separate blocks with blank rows and put formula
 * totals inside the data. A CSV dump repeats the merged title forty times,
 * hides the blank rows and makes the total look like one more line item;
 * the model then sums it all and gets a confident wrong number. Here every
 * value appears once with its coordinates, gaps stay visible, computed
 * cells are marked, and every sheet says what was left out.
 */
export function formatWorkbookPreview(
  workbook: Workbook,
  opts: ISpreadsheetPreviewOptions = {},
): string | null {
  const { sheets } = describeWorkbook(workbook);
  if (!sheets.length || sheets.every((s) => s.usedRows === 0)) return null;

  const workbookLine =
    `Workbook: ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} — ` +
    sheets
      .map(
        (s) =>
          `${s.index} "${s.name}" (${s.state}, ${s.usedRows} rows × ${s.usedCols} cols used, ${s.mergedRegions} merged)`,
      )
      .join('; ');

  const budget = opts.budgetChars ?? Number.POSITIVE_INFINITY;
  let remaining =
    budget - workbookLine.length - sheets.length * HEADER_RESERVE_CHARS;
  const sections: string[] = [];

  for (const info of sheets) {
    if (info.state !== 'visible') {
      sections.push(
        `${sheetHeader(info)} · rows omitted (hidden sheet; pass include_hidden to query_attachment to read it)`,
      );
      continue;
    }

    const section = readSheet(workbook, info.index, {
      includeHidden: true,
      maxRows: opts.previewRowsPerSheet,
    });
    const lines: string[] = [];
    let omitted = section.omittedRows;
    let prev: number | null = null;
    let first: number | null = null;
    let last: number | null = null;

    for (let i = 0; i < section.rows.length; i++) {
      const row = section.rows[i];
      const extra: string[] = [];
      if (prev !== null && row.row - prev >= 3) {
        extra.push(`(rows ${prev + 1}–${row.row - 1} empty)`);
      }
      const line = renderRow(row);
      const cost =
        extra.reduce((n, e) => n + e.length + 1, 0) + line.length + 1;
      if (cost > remaining) {
        omitted += section.rows.length - i;
        break;
      }
      remaining -= cost;
      lines.push(...extra, line);
      prev = row.row;
      first ??= row.row;
      last = row.row;
    }

    let status: string;
    if (first !== null && last !== null) {
      status = `rows ${first}–${last} included · ${omitted} rows omitted`;
    } else if (omitted > 0) {
      status = 'rows omitted (preview budget exhausted; use query_attachment)';
    } else {
      status = 'no data rows';
    }
    sections.push([`${sheetHeader(info)} · ${status}`, ...lines].join('\n'));
  }

  return [workbookLine, ...sections].join('\n\n');
}

function sheetHeader(info: SheetInfo): string {
  return `== Sheet ${info.index}: ${info.name} == ${info.state} · ${info.usedRows} rows × ${info.usedCols} cols used`;
}

/** `R5: B=Троянда | C=120 | F=[=]5460` — see the contract for the rules. */
export function renderRow(row: CellRow): string {
  const cells = row.cells.map((c) => {
    const key = c.span ? `${c.address}[${c.span}]` : columnOf(c.address);
    const marker = c.computed ? '[=]' : '';
    return `${key}=${marker}${escapeCell(c.display)}`;
  });
  return `R${row.row}: ${cells.join(' | ')}`;
}

function escapeCell(s: string): string {
  return s.replace(/\r/g, '').replace(/\|/g, '\\|').replace(/\n/g, '⏎');
}
