import { nameTokens, STOPWORDS } from './knowledgeContext';

/**
 * The lines of a document that carry the words of a query (CLEAN-203).
 *
 * When the agent names the document that owns a fact and the retrieval
 * service still returns nothing — on the Mazda base a short query such as
 * "power liftgate" falls under LightRAG's similarity threshold against a
 * 16 KB equipment sheet, while the row is right there — similarity has
 * done all it can. What is left is the document's own text and a
 * substring match, which is what a person would do with the sheet open.
 *
 * Lines are ranked by how many distinct query words they carry and cut to
 * a budget. A CSV keeps its header line first, so a row's cells still have
 * their trim names.
 */

/** Characters of matched lines a scan returns at most: the tool's own budget. */
export const SCAN_BUDGET_CHARS = 12_000;
/** A line longer than this is a paragraph, not a row; it travels cut. */
export const SCAN_LINE_MAX_CHARS = 1_200;

export interface IScannedLine {
  text: string;
  /** 1-based line number in the document, for the caller's own ordering. */
  line: number;
  /** Distinct query words the line carries. */
  hits: number;
}

export function scanDocumentLines(
  text: string,
  query: string,
  budgetChars = SCAN_BUDGET_CHARS,
): IScannedLine[] {
  const words = [...nameTokens(query)];
  if (words.length === 0) return [];

  const lines = text.split(/\r?\n/);
  const matched: IScannedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    let hits = 0;
    for (const w of words) if (lower.includes(w)) hits += 1;
    if (hits === 0) continue;
    matched.push({ text: cut(line), line: i + 1, hits });
  }
  if (matched.length === 0) return [];

  // Most of the query's words first; the document's own order on a tie.
  matched.sort((a, b) => b.hits - a.hits || a.line - b.line);

  const out: IScannedLine[] = [];
  let used = 0;
  const header = csvHeader(lines);
  if (header) {
    out.push(header);
    used += header.text.length;
  }
  for (const m of matched) {
    if (header && m.line === header.line) continue;
    if (used + m.text.length > budgetChars) break;
    out.push(m);
    used += m.text.length;
  }
  return out;
}

/**
 * The first non-empty line of a CSV, when the text looks like one: a
 * comma-separated line with several cells that the matched rows refer to.
 */
function csvHeader(lines: string[]): IScannedLine | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',').length;
    return cells >= 3 ? { text: cut(line), line: i + 1, hits: 0 } : null;
  }
  return null;
}

function cut(line: string): string {
  return line.length > SCAN_LINE_MAX_CHARS
    ? `${line.slice(0, SCAN_LINE_MAX_CHARS - 1)}…`
    : line;
}

/**
 * The lines of a document that carry a phrase of the query verbatim
 * (CLEAN-211). Similarity ranks by the whole question: against the 2026
 * CX-70 PHEV owner's manual, "driver monitoring driver attention alert …
 * unresponsive driver" came back as Driver Attention Alert paragraphs and
 * never the "Unresponsive Driver Support" section the manual carries
 * sixteen times, and the agent told the person the term does not exist.
 * A phrase the named document carries word for word is what the person
 * meant; its lines lead the passages whatever similarity preferred.
 *
 * A phrase is two adjacent words of the question, stopwords and
 * one-letter tokens breaking the pair. Each phrase the document carries
 * contributes its first lines in turn, so one phrase cannot crowd out
 * another, within its own budget so the retrieval service's passages still
 * fit. A pair carried by a large share of the lines — "cx 70" in a CX-70
 * manual's page headers — is a name of the document, not a phrase of the
 * question, and is left out.
 */
/** Characters of phrase lines a filtered call carries at most, ahead of the retrieval service's passages. */
export const PHRASE_BUDGET_CHARS = 4_000;
/** Lines one phrase contributes at most. */
export const PHRASE_LINES_PER_PHRASE = 3;
/** A pair in more lines than this share of the document (and more than PHRASE_COMMON_MIN_LINES) is a name of the document, not a phrase of the question. */
export const PHRASE_COMMON_SHARE = 0.02;
export const PHRASE_COMMON_MIN_LINES = 40;

export interface IScannedPhraseLine extends IScannedLine {
  /** The phrase of the query this line carries. */
  phrase: string;
  /** 1-based number of the last line the text spans: the paragraph a heading carries. */
  end: number;
}

/** Lowercased words with letters and digits only; "CX-70" reads as "cx70", the way nameTokens reads it. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\p{L})-(\p{N})/gu, '$1$2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The adjacent word pairs of a query, in its order and without repeats: "unresponsive driver", "driver support". */
export function queryPhrases(query: string): string[] {
  const w = words(query);
  const out: string[] = [];
  for (let i = 0; i + 1 < w.length; i++) {
    const a = w[i];
    const b = w[i + 1];
    if (a.length < 2 || b.length < 2 || STOPWORDS.has(a) || STOPWORDS.has(b))
      continue;
    const phrase = `${a} ${b}`;
    if (!out.includes(phrase)) out.push(phrase);
  }
  return out;
}

export function scanDocumentPhrases(
  text: string,
  query: string,
  budgetChars = PHRASE_BUDGET_CHARS,
): IScannedPhraseLine[] {
  const phrases = queryPhrases(query);
  if (phrases.length === 0) return [];
  const lines = text.split(/\r?\n/);
  const byPhrase = new Map<string, IScannedPhraseLine[]>(
    phrases.map((p) => [p, []]),
  );
  let nonEmpty = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    nonEmpty += 1;
    const padded = ` ${words(line).join(' ')} `;
    for (const p of phrases) {
      if (!padded.includes(` ${p} `)) continue;
      const [text, end] = withParagraph(lines, i);
      byPhrase.get(p)!.push({
        text: cut(text),
        line: i + 1,
        end: end + 1,
        hits: 1,
        phrase: p,
      });
    }
  }
  const common = Math.max(
    PHRASE_COMMON_MIN_LINES,
    Math.ceil(nonEmpty * PHRASE_COMMON_SHARE),
  );
  const kept = phrases.filter((p) => {
    const n = byPhrase.get(p)!.length;
    return n > 0 && n <= common;
  });
  // Each phrase in turn, its lines in the document's order. A line already
  // carried under a heading is not returned again on its own.
  const out: IScannedPhraseLine[] = [];
  const taken = new Set<number>();
  let used = 0;
  for (let round = 0; round < PHRASE_LINES_PER_PHRASE; round++) {
    for (const p of kept) {
      const next = byPhrase.get(p)!.find((l) => !taken.has(l.line));
      if (!next) continue;
      if (used + next.text.length > budgetChars) return out;
      for (let n = next.line; n <= next.end; n++) taken.add(n);
      out.push(next);
      used += next.text.length;
    }
  }
  return out;
}

/**
 * A markdown heading alone says nothing; the paragraph under it is what the
 * heading names. Returns the text and the 0-based index of its last line.
 */
function withParagraph(lines: string[], i: number): [string, number] {
  const line = lines[i].trim();
  if (!/^#{1,6}\s/.test(line)) return [line, i];
  for (let j = i + 1; j < lines.length && j <= i + 5; j++) {
    const next = lines[j].trim();
    if (next) return [`${line}\n${next}`, j];
  }
  return [line, i];
}
