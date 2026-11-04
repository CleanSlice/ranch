/**
 * Every size, count and lifetime the file slice enforces, in one place
 * (CLEAN-112, FR-030). Nothing else in the slice, the consoles or the tools
 * carries a literal cap: the API is the authority and echoes the effective
 * values through `GET /agents/:id/files/limits`.
 *
 * Each value can be overridden with `RANCH_FILES_<NAME>` (bytes / count /
 * seconds / minutes as documented per entry). Parsed once at module load.
 */

const KB = 1024;
const MB = 1024 * KB;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[`RANCH_FILES_${name}`];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Largest text file the editor (console or tool) may load fully and save. */
export const MAX_EDIT_BYTES = envNumber('MAX_EDIT_BYTES', 1 * MB);
/** Largest text file the viewer will stream at all; above it: download / open full only. */
export const MAX_VIEW_BYTES = envNumber('MAX_VIEW_BYTES', 25 * MB);
/** Default slice size for range reads. */
export const RANGE_BYTES = envNumber('RANGE_BYTES', 256 * KB);
/** Hard cap per range request. */
export const MAX_RANGE_BYTES = envNumber('MAX_RANGE_BYTES', 512 * KB);
/** Lifetime of an "open full" link, seconds. */
export const OPEN_LINK_TTL_SEC = envNumber('OPEN_LINK_TTL_SEC', 15 * 60);

/** Import archive: compressed size. */
export const IMPORT_MAX_ARCHIVE_BYTES = envNumber(
  'IMPORT_MAX_ARCHIVE_BYTES',
  100 * MB,
);
/** Import archive: entry count. */
export const IMPORT_MAX_ENTRIES = envNumber('IMPORT_MAX_ENTRIES', 2000);
/** Import archive: one entry, uncompressed. */
export const IMPORT_MAX_FILE_BYTES = envNumber(
  'IMPORT_MAX_FILE_BYTES',
  25 * MB,
);
/** Import archive: all entries, uncompressed (zip-bomb guard). */
export const IMPORT_MAX_UNCOMPRESSED_BYTES = envNumber(
  'IMPORT_MAX_UNCOMPRESSED_BYTES',
  500 * MB,
);
/** Import plan: entries listed inline; the rest is a count. */
export const IMPORT_PLAN_LIST_ROWS = envNumber('IMPORT_PLAN_LIST_ROWS', 500);
/**
 * Selected-files import (CLEAN-192): plain files per import. Twenty keeps
 * the target table on one screen; anything larger belongs in an archive.
 */
export const IMPORT_MAX_FILES = envNumber('IMPORT_MAX_FILES', 20);
/** Staged archives older than this are swept, minutes. */
export const IMPORT_STAGE_TTL_MIN = envNumber('IMPORT_STAGE_TTL_MIN', 60);

/** Above this proposed size no diff is computed at all. */
export const DIFF_COMPARE_MAX_BYTES = envNumber(
  'DIFF_COMPARE_MAX_BYTES',
  1 * MB,
);
/** Inline card diff: changed lines. */
export const DIFF_INLINE_MAX_LINES = envNumber('DIFF_INLINE_MAX_LINES', 200);
/** Inline card diff: proposed content size. */
export const DIFF_INLINE_MAX_BYTES = envNumber(
  'DIFF_INLINE_MAX_BYTES',
  100 * KB,
);
/** File rows a set (import) card lists inline. */
export const PROPOSAL_LIST_ROWS = envNumber('PROPOSAL_LIST_ROWS', 50);

/** The shape `GET /agents/:id/files/limits` returns (see FileLimitsDto). */
export interface IFileLimits {
  maxEditBytes: number;
  maxViewBytes: number;
  rangeBytes: number;
  maxRangeBytes: number;
  openLinkTtlSec: number;
  importMaxArchiveBytes: number;
  importMaxEntries: number;
  importMaxFileBytes: number;
  importPlanListRows: number;
  importMaxFiles: number;
  diffCompareMaxBytes: number;
  diffInlineMaxLines: number;
  diffInlineMaxBytes: number;
  proposalListRows: number;
  textExtensions: string[];
  /** Character limits of the curated root files for this agent (CLEAN-208): `{ 'SOUL.md': 32000, … }`. */
  curated: Record<string, number>;
}

/**
 * The runtime bounds four curated root files to `memory.limits` in
 * agent.config.json — in characters, the way its memory slice counts them:
 * SOUL.md → soul, USER.md → user, MEMORY.md → memory, HEARTBEAT.md →
 * heartbeat. A longer file only gets cut to the limit in the agent's prompt,
 * so every write path refuses it here and names the limit (CLEAN-208). The
 * defaults mirror the runtime's DEFAULT_MEMORY_LIMITS.
 */
export const CURATED_FILE_LIMIT_KEYS: Readonly<Record<string, string>> = {
  'SOUL.md': 'soul',
  'USER.md': 'user',
  'MEMORY.md': 'memory',
  'HEARTBEAT.md': 'heartbeat',
};

export const DEFAULT_CURATED_LIMITS: Readonly<Record<string, number>> = {
  soul: 12000,
  user: 1375,
  memory: 2200,
  heartbeat: 1000,
};

/**
 * Per-file character limits read off a parsed agent.config.json; the
 * runtime's defaults fill whatever the config does not set. `null` (no config
 * yet) yields the defaults alone.
 */
export function curatedLimitsFrom(config: unknown): Record<string, number> {
  const limits =
    (config as { memory?: { limits?: Record<string, unknown> } } | null)?.memory
      ?.limits ?? {};
  const out: Record<string, number> = {};
  for (const [file, key] of Object.entries(CURATED_FILE_LIMIT_KEYS)) {
    const raw = limits[key];
    out[file] =
      typeof raw === 'number' && Number.isFinite(raw) && raw > 0
        ? Math.floor(raw)
        : DEFAULT_CURATED_LIMITS[key];
  }
  return out;
}

/**
 * The refusal for a curated root file over its limit; `null` when the path
 * is not a curated file or the content fits. The message names the limit and
 * where it lives, so a person at the console and an agent asked through chat
 * both know what to do.
 */
export function curatedOverLimit(
  path: string,
  chars: number,
  limits: Record<string, number>,
): string | null {
  const limit = limits[path];
  if (limit === undefined || chars <= limit) return null;
  const key = CURATED_FILE_LIMIT_KEYS[path];
  return (
    `${path} is ${chars} characters; this agent's limit is ${limit} ` +
    `(memory.limits.${key} in agent.config.json). Shorten the file or raise the limit, then save again.`
  );
}

export function fileLimits(
  textExtensions: readonly string[],
  curated: Record<string, number> = curatedLimitsFrom(null),
): IFileLimits {
  return {
    curated: { ...curated },
    maxEditBytes: MAX_EDIT_BYTES,
    maxViewBytes: MAX_VIEW_BYTES,
    rangeBytes: RANGE_BYTES,
    maxRangeBytes: MAX_RANGE_BYTES,
    openLinkTtlSec: OPEN_LINK_TTL_SEC,
    importMaxArchiveBytes: IMPORT_MAX_ARCHIVE_BYTES,
    importMaxEntries: IMPORT_MAX_ENTRIES,
    importMaxFileBytes: IMPORT_MAX_FILE_BYTES,
    importPlanListRows: IMPORT_PLAN_LIST_ROWS,
    importMaxFiles: IMPORT_MAX_FILES,
    diffCompareMaxBytes: DIFF_COMPARE_MAX_BYTES,
    diffInlineMaxLines: DIFF_INLINE_MAX_LINES,
    diffInlineMaxBytes: DIFF_INLINE_MAX_BYTES,
    proposalListRows: PROPOSAL_LIST_ROWS,
    textExtensions: [...textExtensions],
  };
}
