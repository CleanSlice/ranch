/**
 * What a knowledge base holds, read off its document names (CLEAN-198).
 *
 * An agent asked "what documents / years / models do you have" had nothing
 * to answer from: `query_knowledge` searches contents, and the production
 * workaround — a skill calling the REST source list through the `http` tool
 * with `${RANCH_API_TOKEN}` placeholders the tool never expands — looped on
 * errors in front of the customer (2026-10-29). This module turns the names
 * into the two facts those questions need: which years the documents carry
 * and which product codes they are about.
 *
 * Everything here is derived from names alone, so it is only as good as the
 * naming. A name that spells no year is counted as undated rather than
 * guessed.
 */

export interface IDocumentInventory {
  /** Documents the summary was computed over. */
  documents: number;
  /** Documents per year named in the title, ascending by year. */
  years: Record<string, number>;
  /** Product codes found in the names, most frequent first. */
  subjects: IDocumentSubject[];
  /** Documents whose name spells no year. */
  undated: number;
}

export interface IDocumentSubject {
  /** The code as the names spell it most often ("CX-5", "Mazda3"). */
  subject: string;
  documents: number;
  /** Documents per year for this subject; undated ones under "undated". */
  years: Record<string, number>;
}

/**
 * Codes the summary lists at most. The Mazda base yields a dozen real model
 * lines and a tail of one-off tokens (a revision "v2", a cable "l10"); the
 * cap keeps the tail from burying the lines without naming any brand here.
 */
export const MAX_SUBJECTS = 40;

const FULL_YEAR = /^(19|20)\d{2}$/;
/** "26my", "2026my", "my26": the model-year code documents carry. */
const MY_CODE = /^(?:(?:19|20)?(\d{2})my|my(\d{2}))$/;
/** A year glued to letters: "2026cx" in "2026CX-5-2026_How to…". */
const LEADING_YEAR = /^((?:19|20)\d{2})[a-z]/;
/**
 * A product code: letters, then one to three digits, then at most two
 * letters ("cx5", "cx30", "mazda3", "mx5", "i6"). A part number such as
 * "pf22cj0p" fails on the trailing letters; "2wd" fails on the leading digit.
 */
const PRODUCT_CODE = /^[a-z]{1,8}\d{1,3}[a-z]{0,2}$/;

/**
 * The name split the way `nameTokens` splits it (CLEAN-194): a hyphen
 * between a letter and a digit is kept so "CX-5" stays one token, and
 * everything else that is not a letter or digit separates tokens. The
 * original spelling travels with each token for the summary to display.
 */
function tokens(name: string): Array<{ raw: string; key: string }> {
  const out: Array<{ raw: string; key: string }> = [];
  for (const raw of name.split(/[^\p{L}\p{N}-]+/u)) {
    for (const part of splitHyphens(raw)) {
      if (part) {
        out.push({ raw: part, key: part.toLowerCase().replace(/-/g, '') });
      }
    }
  }
  return out;
}

/** "CX-5" stays whole, "2020-09-16" and "Soft-Top" split. */
function splitHyphens(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '-') {
      current += ch;
      continue;
    }
    const prev = raw[i - 1] ?? '';
    const next = raw[i + 1] ?? '';
    if (/\p{L}/u.test(prev) && /\p{N}/u.test(next)) {
      current += ch;
    } else {
      parts.push(current);
      current = '';
    }
  }
  parts.push(current);
  return parts;
}

/**
 * The year a document name spells, or null. The first year-like token wins:
 * in this corpus the model year leads the name ("2021 CX-9 Order Guide
 * 2020-08-21") and effective dates trail it, so reading left to right picks
 * the model year over the revision date. An eight-digit date ("08252020") is
 * never a year.
 */
export function documentYear(name: string): string | null {
  for (const { key } of tokens(name)) {
    if (FULL_YEAR.test(key)) return key;
    const my = MY_CODE.exec(key);
    if (my) return `20${my[1] ?? my[2]}`;
    const leading = LEADING_YEAR.exec(key);
    if (leading) return leading[1];
  }
  return null;
}

/** The product codes a name carries: key without case or hyphens → spelling. */
export function documentSubjects(name: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const { raw, key } of tokens(name)) {
    if (!PRODUCT_CODE.test(key) || MY_CODE.test(key)) continue;
    if (!found.has(key)) found.set(key, raw);
  }
  return found;
}

interface ISubjectTally {
  documents: number;
  years: Map<string, number>;
  spellings: Map<string, number>;
}

export function summarizeDocumentNames(names: string[]): IDocumentInventory {
  const years = new Map<string, number>();
  let undated = 0;
  const subjects = new Map<string, ISubjectTally>();

  for (const name of names) {
    const year = documentYear(name);
    if (year) years.set(year, (years.get(year) ?? 0) + 1);
    else undated += 1;

    for (const [key, raw] of documentSubjects(name)) {
      const entry = subjects.get(key) ?? {
        documents: 0,
        years: new Map<string, number>(),
        spellings: new Map<string, number>(),
      };
      entry.documents += 1;
      const yearKey = year ?? 'undated';
      entry.years.set(yearKey, (entry.years.get(yearKey) ?? 0) + 1);
      entry.spellings.set(raw, (entry.spellings.get(raw) ?? 0) + 1);
      subjects.set(key, entry);
    }
  }

  return {
    documents: names.length,
    years: ascending(years),
    subjects: [...subjects.values()]
      .sort((a, b) => b.documents - a.documents)
      .slice(0, MAX_SUBJECTS)
      .map((entry) => ({
        subject: mostCommon(entry.spellings),
        documents: entry.documents,
        years: ascending(entry.years),
      })),
    undated,
  };
}

function ascending(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** The spelling seen most often; the earliest one on a tie. */
function mostCommon(spellings: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [spelling, count] of spellings) {
    if (count > bestCount) {
      best = spelling;
      bestCount = count;
    }
  }
  return best;
}
