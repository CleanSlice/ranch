/**
 * Client-side mirror of the API's attachment limits
 * (`api/src/slices/bridle/domain/attachment.constants.ts`), so a file can be
 * rejected the instant it is picked instead of after a round trip.
 *
 * The server enforces the same rules and is the only thing that actually
 * governs — if the two ever disagree, the server wins and this file is the one
 * that is wrong. Kept in step with `app/slices/bridle/domain/attachment.constants.ts`.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const

export const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
] as const

export const BINARY_MIME_TYPES = ['application/pdf'] as const

export const ALLOWED_MIME_TYPES: readonly string[] = [
  ...IMAGE_MIME_TYPES,
  ...TEXT_MIME_TYPES,
  ...BINARY_MIME_TYPES,
]

/**
 * `accept` for the file picker. Extensions are listed alongside the MIME types
 * because some platforms report an empty `type` for .md and .csv.
 */
export const FILE_PICKER_ACCEPT = [
  ...ALLOWED_MIME_TYPES,
  '.md',
  '.markdown',
  '.csv',
  '.txt',
  '.json',
].join(',')

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
}

export enum BridleAttachmentKinds {
  Image = 'image',
  Text = 'text',
  Binary = 'binary',
}

export enum BridleAttachmentStates {
  Uploading = 'uploading',
  Ready = 'ready',
  Failed = 'failed',
}

/** One picked file, from the moment it is chosen until the message is sent. */
export interface IStagedAttachment {
  localId: string
  file: File
  name: string
  size: number
  mimeType: string
  kind: BridleAttachmentKinds
  /** Object URL for the image thumbnail on the chip; null for other kinds. */
  previewUrl: string | null
  state: BridleAttachmentStates
  /** 0-100. A 10 MB upload with no progress reads as a hang. */
  progress: number
  /** Server id, present once the upload succeeds — this is what gets sent. */
  remoteId: string | null
  error: string | null
}

/** Metadata the upload endpoint returns. */
export interface IUploadedAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: BridleAttachmentKinds
}

/** Human-readable byte size for chips and error copy. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Resolve a file's MIME type, falling back to its extension when blank. */
export function resolveMimeType(file: File): string {
  const reported = (file.type || '').trim().toLowerCase()
  if (ALLOWED_MIME_TYPES.includes(reported)) return reported

  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  return MIME_BY_EXTENSION[ext] ?? reported
}

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType)
}

export function resolveKind(mimeType: string): BridleAttachmentKinds {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return BridleAttachmentKinds.Image
  }
  if ((TEXT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return BridleAttachmentKinds.Text
  }
  return BridleAttachmentKinds.Binary
}

/**
 * The agent reads images and text; a PDF reaches it as a name and a link.
 * Saying so on the chip before the message is sent is the difference between
 * a useful reply and one that talks around the file.
 */
export function isReadableByAgent(kind: BridleAttachmentKinds): boolean {
  return kind !== BridleAttachmentKinds.Binary
}

/**
 * Read an image blob as base64 (a picked File for the local echo, or a blob
 * fetched back through the guarded attachment route on transcript replay).
 *
 * The bubble is rendered from an `image` part, which carries base64 — the
 * same shape the runtime sends back.
 */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      // "data:image/png;base64,AAA…" → "AAA…"
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.readAsDataURL(file)
  })
}
