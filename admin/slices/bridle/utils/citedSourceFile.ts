/**
 * The pure half of opening a cited knowledge source (CLEAN-138): the error
 * the API answers with, its one-line wording, and how the browser should
 * treat the bytes. No I/O here so `bun test` can load it; the HTTP calls are
 * in `citedSource.ts`.
 */

/** Error codes the API answers with; anything else is `UNKNOWN`. */
export const CitedSourceErrorCodes = {
  /** 403 — the knowledge base does not let readers open documents. Admin is exempt. */
  ReaderAccessClosed: 'READER_ACCESS_CLOSED',
  /** 410 — the document left the knowledge base after the answer was given. */
  SourceGone: 'SOURCE_GONE',
  /** 404 — no such message, source number or agent. */
  NotFound: 'NOT_FOUND',
  /** The request never reached the server. */
  Offline: 'OFFLINE',
  Unknown: 'UNKNOWN',
} as const
export type CitedSourceErrorCodes = (typeof CitedSourceErrorCodes)[keyof typeof CitedSourceErrorCodes]

export class CitedSourceError extends Error {
  constructor(
    readonly code: CitedSourceErrorCodes,
    readonly status: number | null,
  ) {
    super(`cited source request failed: ${code}`)
    this.name = 'CitedSourceError'
  }
}

/** One plain line for the person, per failure. The server's own text is never shown. */
export function describeCitedSourceError(err: unknown): string {
  const code = err instanceof CitedSourceError ? err.code : CitedSourceErrorCodes.Unknown
  switch (code) {
    case CitedSourceErrorCodes.ReaderAccessClosed:
      return 'this knowledge base does not allow opening documents'
    case CitedSourceErrorCodes.SourceGone:
      return 'this document is no longer in the knowledge base'
    case CitedSourceErrorCodes.NotFound:
      return 'the source was not found'
    case CitedSourceErrorCodes.Offline:
      return 'the server could not be reached'
    default:
      return 'the server rejected the request'
  }
}

/**
 * The filename a `Content-Disposition` header carries, RFC 5987 form first
 * (`filename*=UTF-8''...`), then the quoted or bare `filename=`. Null when
 * the header names none.
 */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*(?:[\w-]+)?'[\w-]*'([^;]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim()) || null
    } catch {
      // Malformed percent-encoding: fall through to the plain form.
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header)
  const name = plain?.[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain?.[2]
  const trimmed = name?.trim()
  return trimmed ? trimmed : null
}

/** PDFs, images and text open in a tab; everything else is saved. */
export function isInlineViewable(mimeType: string | null | undefined): boolean {
  const type = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!type) return false
  return type === 'application/pdf' || type.startsWith('image/') || type.startsWith('text/')
}

/**
 * A blob navigated to in a new tab is decoded by the charset in its type.
 * The one the response carried does not always survive the trip into the
 * Blob, and a Cyrillic text shown as Latin-1 is unreadable — every text the
 * API serves is UTF-8, so the type says so before the tab opens.
 * TWIN: app/slices/bridle/stores/bridle.ts withTextCharset.
 */
export function withTextCharset(blob: Blob): Blob {
  if (!/^text\//i.test(blob.type) || /charset=/i.test(blob.type)) return blob
  return new Blob([blob], { type: `${blob.type.split(';')[0]};charset=utf-8` })
}
