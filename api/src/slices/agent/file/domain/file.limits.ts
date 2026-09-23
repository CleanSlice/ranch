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
export const IMPORT_MAX_FILE_BYTES = envNumber('IMPORT_MAX_FILE_BYTES', 25 * MB);
/** Import archive: all entries, uncompressed (zip-bomb guard). */
export const IMPORT_MAX_UNCOMPRESSED_BYTES = envNumber(
  'IMPORT_MAX_UNCOMPRESSED_BYTES',
  500 * MB,
);
/** Import plan: entries listed inline; the rest is a count. */
export const IMPORT_PLAN_LIST_ROWS = envNumber('IMPORT_PLAN_LIST_ROWS', 500);
/** Staged archives older than this are swept, minutes. */
export const IMPORT_STAGE_TTL_MIN = envNumber('IMPORT_STAGE_TTL_MIN', 60);

/** Above this proposed size no diff is computed at all. */
export const DIFF_COMPARE_MAX_BYTES = envNumber('DIFF_COMPARE_MAX_BYTES', 1 * MB);
/** Inline card diff: changed lines. */
export const DIFF_INLINE_MAX_LINES = envNumber('DIFF_INLINE_MAX_LINES', 200);
/** Inline card diff: proposed content size. */
export const DIFF_INLINE_MAX_BYTES = envNumber('DIFF_INLINE_MAX_BYTES', 100 * KB);
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
  diffCompareMaxBytes: number;
  diffInlineMaxLines: number;
  diffInlineMaxBytes: number;
  proposalListRows: number;
  textExtensions: string[];
}

export function fileLimits(textExtensions: readonly string[]): IFileLimits {
  return {
    maxEditBytes: MAX_EDIT_BYTES,
    maxViewBytes: MAX_VIEW_BYTES,
    rangeBytes: RANGE_BYTES,
    maxRangeBytes: MAX_RANGE_BYTES,
    openLinkTtlSec: OPEN_LINK_TTL_SEC,
    importMaxArchiveBytes: IMPORT_MAX_ARCHIVE_BYTES,
    importMaxEntries: IMPORT_MAX_ENTRIES,
    importMaxFileBytes: IMPORT_MAX_FILE_BYTES,
    importPlanListRows: IMPORT_PLAN_LIST_ROWS,
    diffCompareMaxBytes: DIFF_COMPARE_MAX_BYTES,
    diffInlineMaxLines: DIFF_INLINE_MAX_LINES,
    diffInlineMaxBytes: DIFF_INLINE_MAX_BYTES,
    proposalListRows: PROPOSAL_LIST_ROWS,
    textExtensions: [...textExtensions],
  };
}
