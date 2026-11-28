// What is not counted in the blocks read from conversation summaries, as the
// line under "How conversations end" says it (CLEAN-270). Pure on purpose: no
// Vue, no Nuxt aliases, so `bun test` runs it.

/** One sentence of the line. `count` is null for the one that has none. */
export type CoverageNote =
  | { kind: 'waiting'; count: number }
  | { kind: 'too-short'; count: number }
  | { kind: 'all-counted'; count: null };

/**
 * The sentences of the coverage line, in the order they are read.
 *
 * A conversation without a summary is one of two different things (spec 038,
 * FR-011): waiting for one, which the batch will write, or too short to get
 * one as it stands, which is not a backlog. Each has its own sentence, and a
 * count of zero has none.
 *
 * "All counted" is said only when nothing is left out for either reason, and
 * only when something has a summary: over "no conversation of this period
 * has a summary yet" it would be a sentence about nothing, and the line is
 * then not drawn at all.
 *
 * The line stood under "Topics and questions" until topics were held back
 * for a vocabulary (the owner's decision of 2026-11-28): that block is not
 * on every page any more, and these are the conversations of the outcome
 * bar's "no summary" part, so the line is said there.
 */
export function coverageNotes(summaries: {
  summarised: number;
  waiting: number;
  tooShort: number;
}): CoverageNote[] {
  const notes: CoverageNote[] = [];
  if (summaries.waiting > 0) notes.push({ kind: 'waiting', count: summaries.waiting });
  if (summaries.tooShort > 0) notes.push({ kind: 'too-short', count: summaries.tooShort });
  if (notes.length === 0 && summaries.summarised > 0) {
    notes.push({ kind: 'all-counted', count: null });
  }
  return notes;
}
