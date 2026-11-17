import { formatDate } from '#common/utils/format';
import {
  detectLogLevel,
  parseLogLine,
  splitLogLines,
  type AgentLogLevel,
} from './logLines';

/**
 * Reading a line and judging its level live in `logLines.ts`, which the api
 * carries byte for byte (CLEAN-233). The collapsed Logs bar takes its counts
 * from the server now, and a bar that counted warnings by one rule over a
 * panel that painted them by another would be worse than no count at all.
 *
 * Not re-exported from here: Nuxt auto-imports both files, and a re-export
 * makes every `detectLogLevel` ambiguous ("Duplicated imports" at prepare).
 * Import the level and its type from `#agent/utils/logLines`.
 */

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
  const lines = splitLogLines(raw);

  const groups: IAgentLogGroup[] = [];
  let current: IAgentLogGroup | null = null;

  // Index loop on purpose: `for…of` plus the non-null assertion below trips a
  // Bun 1.3 JIT crash under `bun test`.
  for (let i = 0; i < lines.length; i += 1) {
    const { at, text } = parseLogLine(lines[i] as string);

    const time = at
      ? `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${String(at.getMilliseconds()).padStart(3, '0')}`
      : null;
    const dayKey = at
      ? `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`
      : null;
    const dayLabel = at ? formatDate(at) : null;

    if (dayKey ? current?.key !== dayKey : !current) {
      current = { key: dayKey ?? 'undated', day: dayLabel, lines: [] };
      groups.push(current);
    }
    current!.lines.push({ time, text, level: detectLogLevel(text) });
  }

  return groups;
}

/**
 * The api answers `[container <reason>]` instead of the cryptic K8s 400 when
 * the pod exists but its container has not booted yet. Returns the reason as
 * a sentence, so the caller can show a spinner rather than that literal.
 *
 * Pure and shared because the collapsed bar and the expanded panel both read
 * it — off the whole response in the panel's case, off the one line the
 * summary carries in the bar's.
 */
export function containerWaitingLabelOf(raw: string): string | null {
  const r = raw.trim().match(/^\[container ([a-z0-9_]+)\]$/i)?.[1];
  if (!r) return null;
  // Camel-case the K8s reason for display: containercreating →
  // Container creating (k8s sends it CamelCase; backend lowercases it).
  if (r === 'containercreating') return 'Container creating';
  if (r === 'podinitializing') return 'Pod initializing';
  return r.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The other whole-response markers (the `[container …]` one has its own
 * spinner branch). Never mixed with real log lines, so a caller checks this
 * before rendering groups and a marker never leaks in as an undated line.
 */
export function logStatusLabelOf(raw: string): string | null {
  const t = raw.trim();
  const noPod = t.match(/^\[no pod yet for (\w+) agent\]$/);
  if (noPod) return `No pod yet — agent is ${noPod[1]}.`;
  const failed = t.match(/^\[log fetch failed: ([\s\S]+)\]$/);
  if (failed) return `Log fetch failed: ${failed[1]}`;
  return null;
}

/** What the collapsed Logs bar shows (specs/017): the newest line and how
 *  much sits behind it. `alerts` = lines with a detected warn/error level. */
export interface ILogSummary {
  latest: IAgentLogLine | null;
  total: number;
  alerts: number;
}

// Index loops on purpose: `for…of` plus non-null assertions over these arrays
// trips a Bun 1.3 JIT crash in `bun test` (see memory).
export function summarizeAgentLogs(groups: IAgentLogGroup[]): ILogSummary {
  let latest: IAgentLogLine | null = null;
  let total = 0;
  let alerts = 0;
  for (let g = 0; g < groups.length; g += 1) {
    const lines = groups[g]!.lines;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      total += 1;
      if (line.level) alerts += 1;
      latest = line;
    }
  }
  return { latest, total, alerts };
}
