/**
 * Whether an index failure is worth retrying without a person.
 *
 * LightRAG reports a document as failed for two very different reasons. One is
 * the document: no text layer, unsupported type, nothing to index. The other
 * is the world around it: Bedrock answering 503 for a quarter of an hour, a
 * pod being replaced mid-batch, a connection reset. LightRAG's own retry runs
 * for seconds, so the second kind ends up recorded exactly like the first, and
 * on 2026-09-17 nine perfectly good documents sat red overnight because of it.
 *
 * The distinction is made on the message, which is all either side leaves
 * behind. Unknown messages are permanent on purpose: a wrong "permanent" costs
 * a person one look, a wrong "transient" hides a broken file behind "Retrying"
 * for over an hour. Grow the list from a log line, not from a guess.
 */
export type IndexFailureKindTypes = 'transient' | 'permanent';

/**
 * Automatic retries after the first failure. Together with the pauses below
 * they span 80 minutes, which comfortably outlasts the 10-15 minute Bedrock
 * waves seen on dev; after that the row reads `failed` for good.
 */
export const MAX_INDEX_RETRIES = 3;

const RETRY_DELAYS_MS: readonly number[] = [5, 15, 60].map(
  (minutes) => minutes * 60_000,
);

const TRANSIENT_MARKERS: readonly RegExp[] = [
  // LightRAG wraps the exhausted tenacity retry as
  // `RetryError[<Future ... raised BedrockConnectionError>]`.
  /RetryError/i,
  /BedrockConnectionError/i,
  /ServiceUnavailable/i,
  /Bedrock is unable to process/i,
  /ThrottlingException/i,
  /Too many requests/i,
  /rate limit/i,
  /timed? ?out/i,
  /connection error/i,
  /ECONNRESET|ECONNREFUSED|EAI_AGAIN/,
  /fetch failed/i,
  // LightragClientError renders an HTTP failure as `LightRAG <path> failed:
  // <status> <body>`; a gateway or unavailable status is LightRAG being
  // restarted or overloaded, not the document.
  /LightRAG \S+ failed: 50[234]\b/,
  // LightRAG holds the document as failed but left no reason on it. It
  // accepted the document; one bounded round of reprocessing is the right
  // first move.
  /LightRAG failed to process it/,
  // A refused re-upload naming a failed original, in either of LightRAG's two
  // wordings ("Original doc_id: X, Status: failed", "Document storage already
  // contains 'name' (Status: failed)"). Reprocessing that original is exactly
  // the cure, so the refusal is a symptom of a transient failure, not a new
  // permanent one.
  /Status:\s*failed/i,
];

export function classifyIndexFailure(
  message: string | null,
): IndexFailureKindTypes {
  if (message === null) return 'permanent';
  return TRANSIENT_MARKERS.some((marker) => marker.test(message))
    ? 'transient'
    : 'permanent';
}

/**
 * How long to wait before retry number `attempt` (1-based: the pause after the
 * first failure is `retryDelayMs(1)`), or null once the retries are spent.
 */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) return null;
  if (attempt > MAX_INDEX_RETRIES) return null;
  return RETRY_DELAYS_MS[attempt - 1];
}

/**
 * When a failure recorded now may be retried, or null when it may not: the
 * message is permanent, or `attempts` (this failure included) has used up the
 * retries.
 */
export function nextRetryAt(
  message: string | null,
  attempts: number,
  now: Date,
): Date | null {
  if (classifyIndexFailure(message) === 'permanent') return null;
  const delay = retryDelayMs(attempts);
  return delay === null ? null : new Date(now.getTime() + delay);
}
