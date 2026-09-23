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

/** S3 metadata on a staged archive (`imports/<agentId>/<importId>.zip`). */
export interface IImportStageMeta {
  agentId: string;
  source: ImportSource;
  size: number;
  entries: number;
  createdAt: Date;
}
