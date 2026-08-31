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
 * How much of a text-like attachment is inlined into the message the agent
 * reads. Comfortably covers ordinary documents and spreadsheets while staying
 * well inside a single model turn; past it the content is truncated and a
 * visible notice takes the place of what was cut.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 100_000;

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

/** Accepted but not readable by the agent: delivered as a named reference. */
export const BINARY_MIME_TYPES = ['application/pdf'] as const;

export const ALLOWED_MIME_TYPES: readonly string[] = [
  ...IMAGE_MIME_TYPES,
  ...TEXT_MIME_TYPES,
  ...BINARY_MIME_TYPES,
];

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
};
