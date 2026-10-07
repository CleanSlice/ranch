import { authedFetch } from '#auth/utils/authedFetch'
import {
  CitedSourceError,
  CitedSourceErrorCodes,
  filenameFromDisposition,
  isInlineViewable,
} from './citedSourceFile'

/**
 * A cited knowledge source behind an answer (CLEAN-138): open its document,
 * rate it. One implementation of the HTTP calls for both places that show a
 * sources list — the live chat (bridle store) and the chat history (chat
 * detail Provider). The client addresses a source by `(messageId, n)` only.
 * The error type and its wording live in `citedSourceFile.ts` (no I/O there).
 *
 * Routes (api/src/slices/bridle/bridle.controller.ts):
 *   GET    /api/agent/:agentId/message/:messageId/source/:n/content?disposition=inline
 *   PUT    /api/agent/:agentId/message/:messageId/source/:n/rating   { rating: 1 | -1 }
 *   DELETE /api/agent/:agentId/message/:messageId/source/:n/rating
 */

function sourceUrl(apiUrl: string, agentId: string, messageId: string, n: number, tail: string): string {
  const base = apiUrl.replace(/\/$/, '')
  return `${base}/api/agent/${encodeURIComponent(agentId)}/message/${encodeURIComponent(messageId)}/source/${n}/${tail}`
}

async function errorOf(res: Response): Promise<CitedSourceError> {
  let code: string | undefined
  try {
    const body = (await res.clone().json()) as { code?: unknown; error?: { code?: unknown } } | null
    const raw = body?.code ?? body?.error?.code
    if (typeof raw === 'string') code = raw
  } catch {
    // Not JSON — the status alone decides.
  }
  if (code === CitedSourceErrorCodes.ReaderAccessClosed || res.status === 403) {
    return new CitedSourceError(CitedSourceErrorCodes.ReaderAccessClosed, res.status)
  }
  if (code === CitedSourceErrorCodes.SourceGone || res.status === 410) {
    return new CitedSourceError(CitedSourceErrorCodes.SourceGone, res.status)
  }
  if (res.status === 404) return new CitedSourceError(CitedSourceErrorCodes.NotFound, res.status)
  return new CitedSourceError(CitedSourceErrorCodes.Unknown, res.status)
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await authedFetch(url, init)
  } catch {
    throw new CitedSourceError(CitedSourceErrorCodes.Offline, null)
  }
  if (!res.ok) throw await errorOf(res)
  return res
}

// ── Open ─────────────────────────────────────────────────────

export interface ICitedSourceFile {
  blob: Blob
  filename: string
}

/** Fetch the document's bytes. Throws `CitedSourceError`. */
export async function fetchCitedSource(
  apiUrl: string,
  agentId: string,
  messageId: string,
  n: number,
): Promise<ICitedSourceFile> {
  const res = await request(sourceUrl(apiUrl, agentId, messageId, n, 'content?disposition=inline'))
  const blob = await res.blob()
  const filename = filenameFromDisposition(res.headers.get('content-disposition')) ?? `source-${n}`
  return { blob, filename }
}

/**
 * Show the document: a new tab when the browser can render it, a download
 * otherwise. The object URL is revoked once the browser has taken it — a tab
 * needs the blob for its first load, so it gets a minute; the anchor only
 * needs it for the click.
 */
export function showCitedSource(file: ICitedSourceFile): void {
  const url = URL.createObjectURL(file.blob)
  if (isInlineViewable(file.blob.type)) {
    const tab = window.open(url, '_blank')
    if (!tab) downloadFrom(url, file.filename)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  downloadFrom(url, file.filename)
  URL.revokeObjectURL(url)
}

function downloadFrom(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Fetch and show in one go. Throws `CitedSourceError`. */
export async function openCitedSource(
  apiUrl: string,
  agentId: string,
  messageId: string,
  n: number,
): Promise<void> {
  showCitedSource(await fetchCitedSource(apiUrl, agentId, messageId, n))
}

// ── Rate ─────────────────────────────────────────────────────

/**
 * Set or clear the reader's own rating of a knowledge source. `null` clears.
 * Resolves to the rating the server now holds. Throws `CitedSourceError`.
 */
export async function setCitedSourceRating(
  apiUrl: string,
  agentId: string,
  messageId: string,
  n: number,
  rating: 1 | -1 | null,
): Promise<1 | -1 | null> {
  const url = sourceUrl(apiUrl, agentId, messageId, n, 'rating')
  if (rating === null) {
    await request(url, { method: 'DELETE' })
    return null
  }
  await request(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating }),
  })
  return rating
}
