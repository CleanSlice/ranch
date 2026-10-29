/**
 * Whole-workspace import (CLEAN-112): an archive is staged once, planned
 * against the current S3 state, and applied only after the operator saw the
 * plan. See specs/017-advanced-file-management/data-model.md §4–§6.
 */

export type ImportMode = 'merge' | 'replace';

export type ImportAction = 'add' | 'change' | 'unchanged' | 'remove' | 'skip';

export type ImportSource = 'upload' | 'attachment' | 'url';

/** One file entry of a validated archive, bytes already in memory. */
export interface IArchiveEntry {
  /** Workspace-relative path (wrapper folder already stripped). */
  path: string;
  size: number;
  /** Hex MD5 of `bytes` — compared to the S3 ETag when planning. */
  md5: string;
  bytes: Buffer;
}

export interface IImportPlanEntry {
  path: string;
  action: ImportAction;
  size: number;
  reason?: string;
}

export interface IImportCounts {
  add: number;
  change: number;
  unchanged: number;
  remove: number;
  skip: number;
}

export interface IImportPlan {
  importId: string;
  mode: ImportMode;
  includeSessions: boolean;
  /** Top-level folder removed from every entry, if the archive had one. */
  wrapperStripped: string | null;
  counts: IImportCounts;
  /** Bytes of the entries that will be written (add + change). */
  totalBytes: number;
  /** Capped at IMPORT_PLAN_LIST_ROWS; `more` counts the rest. */
  entries: IImportPlanEntry[];
  more: number;
  warnings: string[];
}

export interface IImportResult {
  importId: string;
  mode: ImportMode;
  written: number;
  removed: number;
  skipped: number;
  failed: { path: string; reason: string }[];
  /** The agent is running, so the files apply on its next restart. */
  restartRequired: boolean;
}

/**
 * `archive`: a zip the operator or the agent handed over (CLEAN-112).
 * `files`: plain files the API packed itself (CLEAN-192) — loaded without
 * wrapper stripping, applied in merge mode only, guarded by `expected`.
 */
export type ImportStageKind = 'archive' | 'files';

/** S3 metadata on a staged archive (`imports/<agentId>/<importId>.zip`). */
export interface IImportStageMeta {
  agentId: string;
  source: ImportSource;
  size: number;
  entries: number;
  createdAt: Date;
  /** Absent on stages written before CLEAN-192 → `archive`. */
  kind?: ImportStageKind;
  /**
   * `files` only: path → ETag the plan was built against (`null` = did not
   * exist). Stored in a sidecar object next to the zip; `apply` refuses a
   * row whose ETag moved ("changed since previewed").
   */
  expected?: Record<string, string | null>;
}

// ── Selected files (CLEAN-192) ────────────────────────────────────

export type ResolveMatch = 'unique' | 'none' | 'ambiguous';

/** One dropped file name matched against the workspace. */
export interface IResolveRow {
  name: string;
  match: ResolveMatch;
  /** `unique`: the matched path; `none`: `<targetFolder>/<name>`; `ambiguous`: null. */
  path: string | null;
  /** `ambiguous` only: the matching paths, sorted. */
  candidates: string[];
  /** `unique` only: size of the matched file. */
  size: number | null;
}

/** The chosen destination for one dropped file. */
export interface IImportTarget {
  name: string;
  path: string;
}
