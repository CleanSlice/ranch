export type AgentLogLevel = 'error' | 'warn';

export interface IAgentLogLine {
  // 'HH:MM:SS.mmm' in the viewer's local time; null for undated lines.
  time: string | null;
  text: string;
  level: AgentLogLevel | null;
}

export interface IAgentLogGroup {
  key: string;
  // Day separator label ('Jul 27, 2026'); null → render no separator.
  day: string | null;
  lines: IAgentLogLine[];
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

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Splits the raw pod-log response into per-day groups with per-line local
 * time and a detected level. Grouping is by the VIEWER's local calendar day —
 * consistent with the local HH:MM:SS column derived from the same Date.
 * Lines without the K8s timestamp prefix (backend `[...]` markers, or an api
 * that predates `timestamps: true`) join the current group undated — a fully
 * undated response renders exactly like the old plain view.
 */
export function parseAgentLogs(raw: string): IAgentLogGroup[] {
  if (!raw.trim()) return [];

  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const groups: IAgentLogGroup[] = [];
  let current: IAgentLogGroup | null = null;

  for (let line of lines) {
    if (line.endsWith('\r')) line = line.slice(0, -1);

    let time: string | null = null;
    let text = line;
    let dayKey: string | null = null;
    let dayLabel: string | null = null;

    const m = line.match(TS_LINE_RE);
    const rawTs = m?.[1];
    const rawText = m?.[2];
    if (rawTs !== undefined && rawText !== undefined) {
      const d = parseLogTimestamp(rawTs);
      if (d) {
        text = rawText.replace(RUNTIME_TIME_PREFIX_RE, '');
        time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
        dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        dayLabel = d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
    }

    if (dayKey ? current?.key !== dayKey : !current) {
      current = { key: dayKey ?? 'undated', day: dayLabel, lines: [] };
      groups.push(current);
    }
    current!.lines.push({ time, text, level: detectLogLevel(text) });
  }

  return groups;
}
