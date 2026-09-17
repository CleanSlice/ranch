import {
  classifyIndexFailure,
  MAX_INDEX_RETRIES,
  nextRetryAt,
  retryDelayMs,
} from './indexFailure';

describe('classifyIndexFailure', () => {
  // Messages as they appeared in the dev logs and on source rows; the first is
  // the 2026-09-17 outage verbatim.
  const transient = [
    'RetryError[<Future at 0x7f3 state=finished raised BedrockConnectionError>]',
    'BedrockConnectionError: connection error',
    'ServiceUnavailableException: Bedrock is unable to process your request. Please try again later.',
    'ThrottlingException: Too many requests, please wait before trying again.',
    'Request timed out after 300s',
    'LightRAG /documents/upload failed: 502 Bad Gateway',
    'LightRAG /documents/text failed: 503',
    'fetch failed',
    'read ECONNRESET',
    'Identical content already exists under another filename. Original doc_id: doc-9f, Status: failed',
    "Document storage already contains 'manual.pdf' (Status: failed)",
    'LightRAG failed to process it',
  ];

  it.each(transient)('retries: %s', (message) => {
    expect(classifyIndexFailure(message)).toBe('transient');
  });

  const permanent = [
    'File content contains only whitespace characters',
    'Unsupported file type: .exe',
    'Source src-1 has no content',
    'text extraction failed: file could not be read as a PDF',
    'LightRAG reported no state for this document',
    'LightRAG /documents/upload failed: 400 Bad Request',
    // A refused re-upload whose original is fine is adopted, never retried;
    // if it reaches here something else is wrong and a person should look.
    'Identical content already exists under another filename. Original doc_id: doc-9f, Status: processed',
    'something nobody has seen before',
  ];

  it.each(permanent)('gives up on: %s', (message) => {
    expect(classifyIndexFailure(message)).toBe('permanent');
  });

  it('treats no message at all as permanent', () => {
    expect(classifyIndexFailure(null)).toBe('permanent');
  });
});

describe('retryDelayMs', () => {
  it('waits 5, 15 and 60 minutes before the three retries', () => {
    expect(retryDelayMs(1)).toBe(5 * 60_000);
    expect(retryDelayMs(2)).toBe(15 * 60_000);
    expect(retryDelayMs(3)).toBe(60 * 60_000);
  });

  it('has no fourth retry', () => {
    expect(MAX_INDEX_RETRIES).toBe(3);
    expect(retryDelayMs(4)).toBeNull();
  });

  it('rejects nonsense attempt numbers instead of indexing off the table', () => {
    expect(retryDelayMs(0)).toBeNull();
    expect(retryDelayMs(-1)).toBeNull();
    expect(retryDelayMs(1.5)).toBeNull();
  });
});

describe('nextRetryAt', () => {
  const now = new Date('2026-09-17T00:20:00Z');

  it('schedules a transient failure after the pause for that attempt', () => {
    expect(nextRetryAt('RetryError[...]', 1, now)).toEqual(
      new Date('2026-09-17T00:25:00Z'),
    );
    expect(nextRetryAt('RetryError[...]', 3, now)).toEqual(
      new Date('2026-09-17T01:20:00Z'),
    );
  });

  it('stops once the retries are spent', () => {
    expect(nextRetryAt('RetryError[...]', 4, now)).toBeNull();
  });

  it('never schedules a permanent failure', () => {
    expect(nextRetryAt('only whitespace', 1, now)).toBeNull();
  });
});
