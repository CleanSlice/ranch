/**
 * Fitting a knowledge lookup into the agent's window (CLEAN-184).
 *
 * The runtime cuts every tool result at 16 000 characters, and an MCP result
 * reaches it as one string, so a cut lands in the middle of the JSON. The
 * budget therefore has to be met here, on the producing side, and the
 * numbers below are what the measurements on the reference base gave
 * (specs/023-knowledge-context-retrieval/research.md, F2, F13, D6, D14).
 */

import type { IChatSourceInput } from '#/chat/domain/chatSource.types';

/**
 * 16 000 (runtime cap) minus the JSON escaping the text picks up once it
 * sits inside the `content` array and the tool-result envelope (up to ~15 %
 * on prose) minus the envelope itself. Leaves ~1 800 characters of headroom.
 */
export const TOOL_RESULT_BUDGET_CHARS = 12_000;

/** A base asked alongside many others still gets a readable share. */
export const MIN_BUDGET_PER_BASE = 2_000;

/**
 * Chunks on the reference base run ~4 600 characters. The best match
 * travels whole (it most often holds the answer, and tables are long); a
 * typical chunk fits under this cap.
 */
export const FIRST_PASSAGE_MAX_CHARS = 5_000;

/**
 * Every further passage is a contiguous excerpt around the query terms, so
 * four to six passages fit the budget instead of two whole chunks.
 */
export const PASSAGE_MAX_CHARS = 2_000;

/** Graph facts are secondary to passages; eight short ones is plenty. */
export const MAX_FACTS = 8;
export const MAX_FACT_CHARS = 200;

/** One passage as the agent sees it. */
export interface IContextPassageOut {
  /** The Source row's name, or the reported file path when unresolved. */
  source: string;
  source_id: string | null;
  text: string;
  /** Present when the text is an excerpt or was cut to fit. */
  cut?: true;
}

/** One base's block in the tool result; several bases → `{ results: [...] }`. */
export interface IContextBlock {
  knowledge_id: string;
  knowledge_name: string | null;
  complete: boolean;
  reason?: 'no_relevant_content';
  passages: IContextPassageOut[];
  facts?: string[];
  truncated: boolean;
  omitted_passages?: number;
  sources: IChatSourceInput[];
}

export interface IFitOutcome {
  block: IContextBlock;
  kept: number;
  omitted: number;
  cut: number;
}

export interface IExcerpt {
  text: string;
  cut: boolean;
}

/**
 * Words that say nothing about which part of a chunk answers the question.
 * Short list on purpose: a term that slips through costs one wasted hit,
 * a term wrongly dropped costs the window.
 */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'what',
  'which',
  'that',
  'this',
  'are',
  'does',
  'come',
  'comes',
  'have',
  'has',
  'from',
  'into',
  'your',
  'you',
  'how',
  'much',
  'many',
  'about',
  'any',
  'all',
  'can',
  'its',
  'was',
  'were',
  'will',
  'not',
  'but',
  'per',
  'out',
  'get',
  'who',
  'when',
  'where',
  'why',
  'levels',
  'level',
]);

/** The query's content words: three or more characters, lower-cased, unique. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

/** How far a window edge may move to land on a line boundary. */
const SNAP_CHARS = 160;
const beforeMark = (n: number): string => `…[+${n} chars before]\n`;
const afterMark = (n: number): string => `\n…[+${n} chars after]`;

/**
 * A contiguous excerpt of at most `maxChars`, placed where the most query
 * terms occur, snapped to line boundaries so a table row is not split; the
 * head of the text when nothing matches. Both cut sides are marked with the
 * number of characters left out. The kept characters are never changed.
 */
export function excerptAround(
  text: string,
  terms: string[],
  maxChars: number,
): IExcerpt {
  if (text.length <= maxChars) return { text, cut: false };

  const lower = text.toLowerCase();
  const hits: number[] = [];
  for (const term of terms) {
    let at = lower.indexOf(term);
    while (at >= 0) {
      hits.push(at);
      at = lower.indexOf(term, at + term.length);
    }
  }
  hits.sort((a, b) => a - b);

  let start = 0;
  if (hits.length > 0) {
    let bestCount = -1;
    for (const hit of hits) {
      // Open the window a little before the hit so the hit is in view, not
      // on the edge.
      const candidate = Math.max(
        0,
        Math.min(hit - Math.floor(maxChars / 4), text.length - maxChars),
      );
      const end = candidate + maxChars;
      const count = hits.filter((h) => h >= candidate && h < end).length;
      if (count > bestCount) {
        bestCount = count;
        start = candidate;
      }
    }
  }

  if (start > 0) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    if (start - lineStart <= SNAP_CHARS) start = lineStart;
  }
  let end = Math.min(text.length, start + maxChars);
  if (end < text.length) {
    const lineEnd = text.lastIndexOf('\n', end);
    if (lineEnd > start && end - lineEnd <= SNAP_CHARS) end = lineEnd;
  }

  const body = text.slice(start, end);
  const before = start > 0 ? beforeMark(start) : '';
  const after = end < text.length ? afterMark(text.length - end) : '';
  return { text: before + body + after, cut: true };
}

/** The head of the text up to `maxChars`, marked when something was cut. */
function headExcerpt(text: string, maxChars: number): IExcerpt {
  if (text.length <= maxChars) return { text, cut: false };
  return {
    text: text.slice(0, maxChars) + afterMark(text.length - maxChars),
    cut: true,
  };
}

const sizeOf = (value: unknown): number => JSON.stringify(value).length;

/**
 * Fits one base's block into `budgetChars` of serialized JSON (the string
 * the runtime measures). Passages are deduplicated by full text first; the
 * best match travels whole up to FIRST_PASSAGE_MAX_CHARS, every further one
 * as an excerpt around the query terms; they are added in the order received
 * until the next would not fit, and the rest are counted, not silently
 * dropped. Facts come only when every passage fit — "yield to passages when
 * the budget is tight" — and only while they fit themselves.
 */
export function fitContextToBudget(
  block: IContextBlock,
  query: string,
  budgetChars: number,
): IFitOutcome {
  const terms = queryTerms(query);

  const seen = new Set<string>();
  const unique = block.passages.filter((p) =>
    seen.has(p.text) ? false : (seen.add(p.text), true),
  );

  // `sources` mirror the passages the agent actually receives (CLEAN-138:
  // what the answer drew on, one entry per Source row), so they are derived
  // from the kept passages and measured with them.
  const sourcesOf = (passages: IContextPassageOut[]): IChatSourceInput[] => {
    const out: IChatSourceInput[] = [];
    const seen = new Set<string>();
    for (const p of passages) {
      if (p.source_id === null || seen.has(p.source_id)) continue;
      seen.add(p.source_id);
      out.push({
        kind: 'knowledge',
        id: p.source_id,
        name: p.source,
        knowledgeId: block.knowledge_id,
        knowledgeName: block.knowledge_name,
      });
    }
    return out;
  };

  const frame: IContextBlock = { ...block, passages: [], truncated: false };
  delete frame.facts;
  delete frame.omitted_passages;
  // Measured as the final block will be written, with room reserved for the
  // keys that are only known at the end (`truncated`, `omitted_passages`).
  const sizeWith = (passages: IContextPassageOut[], facts?: string[]): number =>
    sizeOf({
      ...frame,
      passages,
      sources: sourcesOf(passages),
      ...(facts && facts.length > 0 ? { facts } : {}),
      truncated: true,
      omitted_passages: unique.length,
    });

  const kept: IContextPassageOut[] = [];
  let cut = 0;
  for (let i = 0; i < unique.length; i++) {
    const p = unique[i];
    const excerpt =
      i === 0
        ? headExcerpt(p.text, FIRST_PASSAGE_MAX_CHARS)
        : excerptAround(p.text, terms, PASSAGE_MAX_CHARS);
    const candidate: IContextPassageOut = {
      source: p.source,
      source_id: p.source_id,
      text: excerpt.text,
      ...(excerpt.cut ? { cut: true as const } : {}),
    };
    if (sizeWith([...kept, candidate]) <= budgetChars) {
      kept.push(candidate);
      if (excerpt.cut) cut += 1;
      continue;
    }
    if (kept.length === 0) {
      // Even the best match does not fit: cut it to what is left rather than
      // answer with nothing. Measured on the serialized form, so JSON
      // escaping is accounted for.
      const fitted = cutToRoom(p, candidate, (c) => sizeWith([c]), budgetChars);
      if (fitted) {
        kept.push(fitted);
        cut += 1;
      }
    }
    break;
  }
  const omitted = unique.length - kept.length;

  const facts: string[] = [];
  if (omitted === 0) {
    for (const fact of block.facts ?? []) {
      if (sizeWith(kept, [...facts, fact]) > budgetChars) break;
      facts.push(fact);
    }
  }

  const out: IContextBlock = {
    ...frame,
    passages: kept,
    ...(facts.length > 0 ? { facts } : {}),
    truncated: omitted > 0 || cut > 0,
    ...(omitted > 0 ? { omitted_passages: omitted } : {}),
    sources: sourcesOf(kept),
  };
  return { block: out, kept: kept.length, omitted, cut };
}

function cutToRoom(
  original: IContextPassageOut,
  candidate: IContextPassageOut,
  measure: (c: IContextPassageOut) => number,
  budgetChars: number,
): IContextPassageOut | null {
  const empty = { ...candidate, text: '' };
  let room =
    budgetChars - measure(empty) - afterMark(original.text.length).length;
  while (room > 0) {
    const text = original.text.slice(0, room);
    const attempt: IContextPassageOut = {
      ...candidate,
      text: text + afterMark(original.text.length - text.length),
      cut: true,
    };
    const over = measure(attempt) - budgetChars;
    if (over <= 0) return attempt;
    room -= over + 1;
  }
  return null;
}
