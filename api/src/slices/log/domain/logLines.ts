/**
 * How one pod-log line is read: its timestamp, its displayable text and the
 * level the text betrays. CLEAN-233.
 *
 * This file is COPIED, byte for byte, into the admin console at
 * `admin/slices/agent/agent/utils/logLines.ts` — `scripts/log-lines-twin.test.ts`
 * fails the build if the two drift. The console renders the expanded log panel
 * from the raw text and the api counts the same lines for the collapsed bar's
 * summary; the two must agree on what counts as a warning, or the bar would
 * say "3 alerts" over a panel showing four. They cannot import from each other
 * (separate builds), which is the same bind `sentry.rules.ts` is in, so it is
 * solved the same way.
 *
 * Keep it free of imports and of every global but `Date`, so the copies stay
 * interchangeable.
 */

export type AgentLogLevel = 'error' | 'warn';

/** One line, split into what the time column shows and what the body shows. */
export interface ILogLineParts {
  /** The K8s timestamp, or null when the line carries none (markers, older api). */
  at: Date | null;
  /** The body, with the K8s timestamp and the runtime's own time prefix gone. */
  text: string;
}

// K8s `timestamps: true` prefix: RFC3339Nano — Go strips trailing fractional
// zeros, so the fraction is 0–9 digits or absent entirely; kubelet emits `Z`
// but offset zones are tolerated. Exactly one space separates ts from text.
const TS_LINE_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})) (.*)$/;

// Level detection is heuristic — the runtime prints plain text with no
// structured level markers. Two tiers per level, error checked before warn:
// 1) A bare UPPERCASE token anywhere: uppercase ERROR/WARN in a log line is
//    almost always a level marker, essentially never prose. \b guards
//    against STDERR / ERRORS / ERROR_CODE / WARNINGS.
// 2) Any case, but only in level-marker syntax — line start, [bracketed],
//    (parenthesized), "quoted", after the runtime's `·` tag separator
//    (`17:51:38.100 · err  boom`), or a level=/level: key. Deliberately does
//    NOT match lowercase mid-sentence prose ("retrying after error in x").
const ERROR_UPPER_RE = /\b(?:ERROR|ERR|FATAL)\b/;
const WARN_UPPER_RE = /\b(?:WARN|WARNING)\b/;
const ERROR_TOKEN_RE =
  /(?:^|[[("']|·\s*|\blevel[=:]\s*"?)\s*(?:error|err|fatal)(?=[\s:\])"',]|$)/i;
const WARN_TOKEN_RE =
  /(?:^|[[("']|·\s*|\blevel[=:]\s*"?)\s*warn(?:ing)?(?=[\s:\])"',]|$)/i;

// The runtime's pretty format opens every line with an explicit level glyph
// (logger.ts GLYPH map: `·` debug/info, `✓` ok, `⚠` warn, `✗` error). When
// present it is AUTHORITATIVE — a ⚠ warn line whose body happens to contain
// `"error":"Not Found"` (a quoted JSON payload) must not be escalated to
// error by the substring heuristics above. Optional ANSI wrappers tolerated
// for FORCE_COLOR runs.
// The optional leading `HH:MM:SS.mmm` covers undated lines where the runtime's
// own time prefix wasn't stripped (no K8s timestamp on the line).
const GLYPH_LEVEL_RE =
  // eslint-disable-next-line no-control-regex
  /^\s*(?:\d{2}:\d{2}:\d{2}\.\d{3}\s+)?(?:\x1b\[[0-9;]*m)?([·✓⚠✗])(?:\x1b\[[0-9;]*m)?\s/u;

// The runtime prefixes its own `HH:MM:SS.mmm ` to every line. When the K8s
// timestamp already gives us the time column, that prefix is pure duplication
// — strip it (the column carries milliseconds, so no precision is lost).
const RUNTIME_TIME_PREFIX_RE = /^\d{2}:\d{2}:\d{2}\.\d{3}\s+/;

export function detectLogLevel(text: string): AgentLogLevel | null {
  const glyph = text.match(GLYPH_LEVEL_RE)?.[1];
  if (glyph === '✗') return 'error';
  if (glyph === '⚠') return 'warn';
  if (glyph === '·' || glyph === '✓') return null;
  if (ERROR_UPPER_RE.test(text) || ERROR_TOKEN_RE.test(text)) return 'error';
  if (WARN_UPPER_RE.test(text) || WARN_TOKEN_RE.test(text)) return 'warn';
  return null;
}

// JS Date only understands millisecond fractions (Safari rejects longer),
// so trim nanos before parsing.
function parseLogTimestamp(ts: string): Date | null {
  const d = new Date(ts.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The raw response into its lines. An empty or blank response has none, and
 * the trailing newline every log ends with is not a line of its own.
 */
export function splitLogLines(raw: string): string[] {
  if (!raw.trim()) return [];
  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * One line's timestamp and body. A line whose timestamp does not parse keeps
 * its whole text — including the prefix — rather than losing the start of the
 * message to a regex that only half-matched.
 */
export function parseLogLine(line: string): ILogLineParts {
  const m = line.match(TS_LINE_RE);
  const rawTs = m?.[1];
  const rawText = m?.[2];
  if (rawTs === undefined || rawText === undefined)
    return { at: null, text: line };
  const at = parseLogTimestamp(rawTs);
  if (!at) return { at: null, text: line };
  return { at, text: rawText.replace(RUNTIME_TIME_PREFIX_RE, '') };
}

/** What the collapsed Logs bar shows: the newest line and how much sits
 *  behind it. `alerts` = lines whose level is warn or error. */
export interface ILogTextSummary {
  /** The newest line, raw and unparsed, for the reader to render as it likes. */
  latest: string | null;
  total: number;
  alerts: number;
}

/**
 * Counts over the window that was read — not over the pod's whole history,
 * which nobody has. A smaller `tail` therefore gives smaller numbers, which is
 * as true of this as it was of counting the same lines in the browser.
 */
export function summarizeLogText(raw: string): ILogTextSummary {
  const lines = splitLogLines(raw);
  let alerts = 0;
  // for-of, not an index loop with an assertion: the two projects disagree
  // about whether lines[i] can be undefined (admin runs with
  // noUncheckedIndexedAccess, the api does not), and the assertion one of
  // them needs the other lints away — which would break the twin.
  for (const line of lines) {
    if (detectLogLevel(parseLogLine(line).text)) alerts += 1;
  }
  // .at() is `string | undefined` under either setting, so no cast either.
  return { latest: lines.at(-1) ?? null, total: lines.length, alerts };
}
