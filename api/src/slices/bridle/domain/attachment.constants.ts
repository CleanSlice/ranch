/**
 * Limits for chat attachments.
 *
 * The server is the authority. `app/slices/bridle/domain/attachment.constants.ts`
 * mirrors these values so the UI can reject a file before its bytes ever leave
 * the browser — that copy is a convenience, never the control. Anything that
 * actually governs is enforced here.
 */

/** Largest single file we accept. Also fed to multer's `limits.fileSize`. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Largest combined attachment payload on one message. */
export const MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Attachments per message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * How much of a text-like attachment (txt/md/csv/json, PDF text layer, Word
 * document) is inlined into the message the agent reads. Comfortably covers
 * ordinary documents while staying well inside a single model turn; past it
 * the content is truncated and a visible notice takes the place of what was
 * cut. Spreadsheets do NOT use this cap — see the two constants below.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 100_000;

/**
 * Character budget for the spreadsheet block inlined into the message. The
 * block is a *preview* (workbook summary + first rows of every sheet): with
 * `query_attachment` available the model reads exact numbers from the stored
 * file, so the inline text only has to orient it. Applied to the
 * de-duplicated representation and cut only at row boundaries; every sheet
 * header reports how many rows were omitted.
 */
export const SPREADSHEET_INLINE_BUDGET_CHARS = 40_000;

/**
 * Non-empty rows per sheet included in the inline preview. Keeps a 5 000-row
 * export from spending the whole budget on sheet 1 and leaving sheet 2 with
 * nothing but a header. The rest is reachable through `query_attachment`.
 */
export const SPREADSHEET_PREVIEW_ROWS_PER_SHEET = 200;

/**
 * Cells one `query_attachment` call may touch. A 10 MB workbook can hold
 * millions of cells; the cap keeps a single tool call bounded and pushes the
 * model to narrow its range instead of reading everything.
 */
export const MAX_QUERY_CELLS = 50_000;

/** MIME types that render as a thumbnail and reach the model as image content. */
export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

/**
 * MIME types whose contents we decode and inline. The agent runtime drops
 * `file` parts before calling the model, so inlining is the only reason an
 * attached document is usable at all — see the plan's D4.
 */
export const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
] as const;

/** Accepted but not readable by the agent: delivered as a named reference.
 *  Office formats are zip/OLE containers — extracting their text is a
 *  separate feature; until then they travel like PDFs, name and bytes only. */
export const BINARY_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export const ALLOWED_MIME_TYPES: readonly string[] = [
  ...IMAGE_MIME_TYPES,
  ...TEXT_MIME_TYPES,
  ...BINARY_MIME_TYPES,
];

/**
 * Binary MIME types whose text the API extracts server-side and inlines into
 * the message (documentText.extractor). Everything binary that is NOT here —
 * legacy .doc/.xls, PowerPoint — stays a named reference the agent can't read.
 */
export const EXTRACTABLE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
] as const;

export function isExtractableDocument(mimeType: string): boolean {
  return (EXTRACTABLE_DOCUMENT_MIME_TYPES as readonly string[]).includes(
    mimeType,
  );
}

/**
 * Extension per accepted MIME type. The stored object's extension is derived
 * from the *resolved* type, never from the uploaded filename — a hostile name
 * must not be able to reach an S3 key.
 */
export const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel.sheet.macroEnabled.12': '.xlsm',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    '.pptx',
};

/** Fallback when a file arrives with no usable MIME type but a known extension. */
export const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
