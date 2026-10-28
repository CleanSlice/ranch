// CLEAN-184: a lookup result must fit the agent's window whole. The runtime
// cuts a tool result at 16 000 characters as one string, so the producing
// side keeps every result under 12 000 — by whole best match, marked
// excerpts for the rest, and an honest count of what was left out.

import {
  excerptAround,
  fitContextToBudget,
  FIRST_PASSAGE_MAX_CHARS,
  IContextBlock,
  PASSAGE_MAX_CHARS,
  TOOL_RESULT_BUDGET_CHARS,
} from './knowledgeContext';

const QUERY =
  'For the Mazda3 hatchback what trim levels come with adaptive headlights?';

/**
 * A chunk the size the reference base produces (~4 600 chars), with one
 * line that answers the question buried in the middle.
 */
function chunk(n: number, chars = 4_600): string {
  const filler = `Line of the ${n}th document, saying nothing about lighting but padding the page.\n`;
  const half = Math.floor(chars / 2);
  const head = filler.repeat(Math.ceil(half / filler.length)).slice(0, half);
  const answer = `Headlights - adaptive Front-Lighting System (AFS) | 2.5 S Premium: Std | Turbo Premium Plus: Std (doc ${n})\n`;
  const rest = chars - head.length - answer.length;
  const tail = filler.repeat(Math.ceil(rest / filler.length)).slice(0, rest);
  return head + answer + tail;
}

function block(texts: string[], facts: string[] = []): IContextBlock {
  return {
    knowledge_id: 'k1',
    knowledge_name: 'Mazda',
    complete: true,
    passages: texts.map((text, i) => ({
      source: `doc-${i + 1}.pdf`,
      source_id: `source-${i + 1}`,
      text,
    })),
    ...(facts.length ? { facts } : {}),
    truncated: false,
    sources: [],
  };
}

const size = (value: unknown): number => JSON.stringify(value).length;
const BEFORE = /^…\[\+\d+ chars before\]\n/;
const AFTER = /\n…\[\+\d+ chars after\]$/;
const bodyOf = (text: string): string =>
  text.replace(BEFORE, '').replace(AFTER, '');

describe('excerptAround', () => {
  test('returns a short text whole, unmarked', () => {
    expect(excerptAround('short text', ['text'], 100)).toEqual({
      text: 'short text',
      cut: false,
    });
  });

  test('picks the window with the most query-term hits and marks both cut sides', () => {
    const text = chunk(1);
    const out = excerptAround(
      text,
      ['adaptive', 'headlights', 'trim', 'hatchback'],
      PASSAGE_MAX_CHARS,
    );

    expect(out.cut).toBe(true);
    expect(out.text).toContain('adaptive Front-Lighting System (AFS)');
    expect(out.text).toMatch(BEFORE);
    expect(out.text).toMatch(AFTER);
    // The excerpt itself never exceeds the cap and is a contiguous slice of
    // the original: nothing paraphrased, nothing reordered.
    const body = bodyOf(out.text);
    expect(body.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS);
    expect(text).toContain(body);
  });

  test('falls back to the head of the text when no term matches', () => {
    const text = chunk(2);
    const out = excerptAround(text, ['zebra', 'quantum'], PASSAGE_MAX_CHARS);

    expect(out.cut).toBe(true);
    expect(out.text.startsWith(text.slice(0, 50))).toBe(true);
    expect(out.text).toMatch(AFTER);
    expect(out.text).not.toContain('chars before');
  });

  test('snaps the window to line boundaries so a table row is never split mid-line', () => {
    const text = chunk(3);
    const out = excerptAround(text, ['adaptive'], PASSAGE_MAX_CHARS);
    const body = bodyOf(out.text);
    const start = text.indexOf(body);

    expect(start).toBeGreaterThan(0);
    expect(text[start - 1]).toBe('\n');
    expect(
      body
        .split('\n')
        .some((line) => line.includes('(AFS) | 2.5 S Premium: Std')),
    ).toBe(true);
  });
});

describe('fitContextToBudget', () => {
  test('twelve reference-size chunks: the best match whole, at least four passages, under budget', () => {
    const texts = Array.from({ length: 12 }, (_, i) => chunk(i + 1));
    const {
      block: out,
      kept,
      omitted,
      cut,
    } = fitContextToBudget(block(texts), QUERY, TOOL_RESULT_BUDGET_CHARS);

    expect(size(out)).toBeLessThanOrEqual(TOOL_RESULT_BUDGET_CHARS);
    expect(out.passages[0].text).toBe(texts[0]);
    expect(out.passages[0].cut).toBeUndefined();
    expect(kept).toBeGreaterThanOrEqual(4);
    expect(out.passages.slice(1).every((p) => p.cut === true)).toBe(true);
    expect(out.passages.slice(1).every((p) => p.text.includes('(AFS)'))).toBe(
      true,
    );
    expect(omitted).toBe(12 - kept);
    expect(out.omitted_passages).toBe(omitted);
    expect(out.truncated).toBe(true);
    expect(cut).toBe(kept - 1);
  });

  test('keeps passages in the order received and drops the tail, never the head', () => {
    const texts = Array.from(
      { length: 30 },
      (_, i) => `passage ${i + 1} ` + 'x'.repeat(1_000),
    );
    const { block: out, kept } = fitContextToBudget(
      block(texts),
      QUERY,
      TOOL_RESULT_BUDGET_CHARS,
    );

    expect(kept).toBeGreaterThanOrEqual(4);
    expect(out.passages.map((p) => bodyOf(p.text).slice(0, 10))).toEqual(
      texts.slice(0, kept).map((t) => t.slice(0, 10)),
    );
    expect(out.truncated).toBe(true);
    expect(out.omitted_passages).toBe(30 - kept);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  test('a single passage longer than the whole budget is cut to fit, with the mark, never dropped', () => {
    const texts = ['y'.repeat(14_000)];
    const {
      block: out,
      kept,
      omitted,
    } = fitContextToBudget(block(texts), QUERY, TOOL_RESULT_BUDGET_CHARS);

    expect(kept).toBe(1);
    expect(omitted).toBe(0);
    expect(size(out)).toBeLessThanOrEqual(TOOL_RESULT_BUDGET_CHARS);
    expect(out.passages[0].text.length).toBeLessThanOrEqual(
      FIRST_PASSAGE_MAX_CHARS + 40,
    );
    expect(out.passages[0].text).toMatch(AFTER);
    expect(out.passages[0].cut).toBe(true);
    expect(out.truncated).toBe(true);
  });

  test('nothing to cut: a small result passes through unchanged and untruncated', () => {
    const input = block(
      ['one short passage', 'another'],
      ['AFS — 2.5 S Premium: standard'],
    );
    const {
      block: out,
      kept,
      omitted,
      cut,
    } = fitContextToBudget(input, QUERY, TOOL_RESULT_BUDGET_CHARS);

    // `sources` are derived from the kept passages, one per Source row.
    expect(out).toEqual({
      ...input,
      truncated: false,
      sources: [1, 2].map((n) => ({
        kind: 'knowledge',
        id: `source-${n}`,
        name: `doc-${n}.pdf`,
        knowledgeId: 'k1',
        knowledgeName: 'Mazda',
      })),
    });
    expect(out.omitted_passages).toBeUndefined();
    expect([kept, omitted, cut]).toEqual([2, 0, 0]);
  });

  test('facts come after every kept passage and are the first thing dropped', () => {
    const texts = Array.from({ length: 12 }, (_, i) => chunk(i + 1));
    const facts = Array.from(
      { length: 8 },
      (_, i) => `fact ${i + 1}: ` + 'f'.repeat(180),
    );
    const tight = fitContextToBudget(
      block(texts, facts),
      QUERY,
      TOOL_RESULT_BUDGET_CHARS,
    );
    const roomy = fitContextToBudget(
      block(texts.slice(0, 1), facts),
      QUERY,
      TOOL_RESULT_BUDGET_CHARS,
    );

    expect(tight.kept).toBeGreaterThanOrEqual(4);
    expect(tight.block.facts ?? []).toHaveLength(0);
    expect(roomy.block.facts).toEqual(facts);
    expect(size(tight.block)).toBeLessThanOrEqual(TOOL_RESULT_BUDGET_CHARS);
  });

  test('duplicate passages (same chunk through two search modes) appear once, before any cutting', () => {
    const texts = [chunk(1), chunk(1), chunk(2)];
    const {
      block: out,
      kept,
      omitted,
    } = fitContextToBudget(block(texts), QUERY, TOOL_RESULT_BUDGET_CHARS);

    expect(kept).toBe(2);
    expect(omitted).toBe(0);
    expect(out.passages.map((p) => p.source)).toEqual([
      'doc-1.pdf',
      'doc-3.pdf',
    ]);
  });

  test('a smaller per-base budget (fan-out) is respected to the character', () => {
    const texts = Array.from({ length: 6 }, (_, i) => chunk(i + 1));
    const { block: out } = fitContextToBudget(block(texts), QUERY, 2_000);

    expect(size(out)).toBeLessThanOrEqual(2_000);
    expect(out.passages.length).toBeGreaterThanOrEqual(1);
  });
});
