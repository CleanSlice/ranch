// Domain types for an agent's file store (S3-backed workspace).

export type FileKind = 'text' | 'binary';

export interface IFileNode {
  path: string;
  size: number;
  updatedAt: string;
  /** Decided by the API (CLEAN-112): known extension or a sniff of the bytes. */
  kind: FileKind;
  /** Text and within `IFileLimits.maxEditBytes`. */
  editable: boolean;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
  kind: FileKind;
  editable: boolean;
}

export interface IFileChunk {
  path: string;
  content: string;
  size: number;
  totalSize: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
  updatedAt: string;
  kind: FileKind;
  editable: boolean;
}

/** Effective server limits — never hardcoded on the client (CLEAN-112). */
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

export interface ISaveOptions {
  /** 409 when the file exists (New file). */
  createOnly?: boolean;
  /** 412 when the stored file changed after this instant. */
  ifUnmodifiedSince?: string;
}

/** Why a save was refused, so the UI can offer the right recovery. */
export type SaveRefusal = 'conflict' | 'exists' | 'invalid';

export class SaveRefusedError extends Error {
  constructor(
    public readonly reason: SaveRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'SaveRefusedError';
  }
}

/** Short-lived address of the raw stored file (Open full). */
export interface IOpenLink {
  url: string;
  expiresAt: string;
}

/** A bulk delete refused because it would empty the workspace. */
export interface IDeleteConflict {
  wouldRemove: number;
  total: number;
}

export type IDeleteOutcome =
  | { status: 'done'; deleted: number }
  | { status: 'conflict'; conflict: IDeleteConflict };

export interface ISyncResult {
  agentOnline: boolean;
  pushed: number;
}

// S3 file modified after the pod's last pull/push — a sync MAY overwrite or
// delete it if the pod also changed it locally.
export interface IAtRiskFile {
  path: string;
  updatedAt: string;
}

export interface ISyncConflict {
  atRisk: IAtRiskFile[];
  baseline: string;
}

// Sync either ran ('done') or was refused with the at-risk list ('conflict');
// a conflict is resolved by calling sync again with confirm=true.
export type ISyncOutcome =
  | { status: 'done'; result: ISyncResult }
  | { status: 'conflict'; conflict: ISyncConflict };

// ── Import (CLEAN-112) ──────────────────────────────────────────

export type ImportMode = 'merge' | 'replace';
export type ImportAction = 'add' | 'change' | 'unchanged' | 'remove' | 'skip';

export interface IImportPlanEntry {
  path: string;
  action: ImportAction;
  size: number;
  reason?: string;
}

export interface IImportPlan {
  importId: string;
  mode: ImportMode;
  includeSessions: boolean;
  wrapperStripped: string | null;
  counts: Record<ImportAction, number>;
  totalBytes: number;
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
  restartRequired: boolean;
}

export interface IImportApplyOptions {
  mode: ImportMode;
  includeSessions: boolean;
  confirmRemove?: boolean;
}

// ── Change proposals (CLEAN-112) ────────────────────────────────

export type ProposalStatus = 'pending' | 'applied' | 'skipped' | 'stale' | 'refused';
export type ProposalKind = 'single' | 'set';
export type ProposalOp = 'write' | 'create' | 'import';
export type DiffStatus = 'ok' | 'too_large' | 'binary' | 'none';
export type ProposalVia = 'card' | 'tool' | 'editor';

export interface IProposalSetSummary {
  counts: Record<ImportAction, number>;
  rows: IImportPlanEntry[];
  more: number;
  mode: ImportMode;
  includeSessions: boolean;
}

export interface IFileChangeProposal {
  id: string;
  agentId: string;
  agentName: string;
  chatAgentId: string;
  channel: string;
  kind: ProposalKind;
  op: ProposalOp;
  path: string | null;
  proposedBytes: number;
  diffStatus: DiffStatus;
  additions: number | null;
  deletions: number | null;
  changedLines: number | null;
  firstChangedLine: number | null;
  inlineDiff: string | null;
  summary: IProposalSetSummary | null;
  status: ProposalStatus;
  actedBy: string | null;
  actedVia: ProposalVia | null;
  actedAt: string | null;
  result: IImportResult | { etag: string } | null;
  restartRequired: boolean;
  createdAt: string;
  reason?: string | null;
}
