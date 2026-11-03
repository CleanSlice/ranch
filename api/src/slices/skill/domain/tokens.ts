/**
 * How big a skill is, in tokens, approximately (CLEAN-205). There is no
 * tokenizer in the API and the brief allows the usual four-characters-a-token
 * rule; the console labels the number with "≈" for that reason. The admin
 * keeps a copy of this function for its live editor counter
 * (`admin/slices/skill/utils/tokens.ts`); both are pinned to the same
 * fixtures so they cannot drift.
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(body: string): number {
  if (!body) return 0;
  return Math.ceil(body.length / CHARS_PER_TOKEN);
}
