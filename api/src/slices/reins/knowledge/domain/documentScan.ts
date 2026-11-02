import { nameTokens } from './knowledgeContext';

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
