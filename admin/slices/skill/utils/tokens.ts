/**
 * The editor's live "≈ N tokens" (CLEAN-205): the same ceil(chars / 4) the
 * API writes on save (`api/src/slices/skill/domain/tokens.ts`), copied here
 * because the two projects share no package. Both test files use the same
 * three fixtures so the counter and the stored estimate cannot disagree.
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(body: string): number {
  if (!body) return 0;
  return Math.ceil(body.length / CHARS_PER_TOKEN);
}

/** Lines in the editor: an empty body is 0, a trailing newline adds none. */
export function countLines(body: string): number {
  if (!body) return 0;
  const lines = body.split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}
