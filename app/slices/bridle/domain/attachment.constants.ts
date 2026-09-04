/**
 * Client-side mirror of the API's attachment limits
 * (`api/src/slices/bridle/domain/attachment.constants.ts`).
 *
 * These exist so a file can be rejected the instant it is picked, before its
 * bytes travel anywhere. The server enforces the same rules and is the only
 * thing that actually governs — if the two ever disagree, the server wins and
 * this file is the one that is wrong.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
] as const;

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
 * Mirror of the API's extractable-document list: binary types whose text the
 * server inlines into the message. Legacy .doc/.xls and PowerPoint stay
 * unreadable references.
 */
export const EXTRACTABLE_DOCUMENT_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
];

/** `accept` attribute for the file picker. Extensions are included because
 *  some platforms report an empty `type` for .md and .csv. */
export const FILE_PICKER_ACCEPT = [
  ...ALLOWED_MIME_TYPES,
  '.md',
  '.markdown',
  '.csv',
  '.txt',
  '.json',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.ppt',
  '.pptx',
].join(',');

/** Same extension fallback the server uses when `file.type` is blank. */
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

/**
 * The agent reads images, text, and server-extracted documents; anything else
 * reaches it as a name and a link. Kind alone is not enough since extractable
 * documents keep the `binary` wire kind. Takes the kind as a plain string to
 * stay import-cycle-free with bridle.types.
 */
export function isReadableByAgent(kind: string, mimeType?: string): boolean {
  if (kind !== 'binary') return true;
  return !!mimeType && EXTRACTABLE_DOCUMENT_MIME_TYPES.includes(mimeType);
}

/** Human-readable byte size for chips and error copy. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Resolve a file's MIME type, falling back to its extension when blank. */
export function resolveMimeType(file: File): string {
  const reported = (file.type || '').trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.includes(reported)) return reported;

  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  return MIME_BY_EXTENSION[ext] ?? reported;
}
