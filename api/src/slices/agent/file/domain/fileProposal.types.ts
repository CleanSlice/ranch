import type { IImportPlan, IImportResult, ImportMode } from './import.types';

/**
 * A file change an agent proposed through a confirm-gated tool (CLEAN-112).
 * See data-model.md §7 for the state machine. Rows are read by the transcript
 * endpoint (cards on reload), the proposal controller (Apply/Skip from the
 * console) and the file tools (confirm with the id).
 */

export type ProposalKind = 'single' | 'set';
export type ProposalOp = 'write' | 'create' | 'import';
export type ProposalStatus =
  | 'pending'
  | 'applied'
  | 'skipped'
  | 'stale'
  | 'refused';
export type ProposalVia = 'card' | 'tool' | 'editor';
export type DiffStatus = 'ok' | 'too_large' | 'binary' | 'none';

/** The `summary` column of a set proposal: what the card lists. */
export interface IProposalSetSummary {
  counts: IImportPlan['counts'];
  rows: IImportPlan['entries'];
  more: number;
  mode: ImportMode;
  includeSessions: boolean;
  wrapperStripped: string | null;
  warnings: string[];
}

export interface IFileChangeProposal {
  id: string;
  agentId: string;
  chatAgentId: string;
  channel: string;
  clientId: string | null;
  turnId: string | null;
  kind: ProposalKind;
  op: ProposalOp;
  path: string | null;
  baseEtag: string | null;
  contentKey: string | null;
  importId: string | null;
  mode: ImportMode | null;
  includeSessions: boolean;
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
  actedAt: Date | null;
  result: IImportResult | { etag: string } | null;
  reason: string | null;
  createdAt: Date;
}

export type ICreateProposal = Omit<
  IFileChangeProposal,
  'id' | 'status' | 'actedBy' | 'actedVia' | 'actedAt' | 'result' | 'reason' | 'createdAt'
> & {
  /** Minted by the service so the S3 content key can carry it before the row exists. */
  id?: string;
};

export interface ITransitionPatch {
  actedBy?: string | null;
  actedVia?: ProposalVia | null;
  actedAt?: Date;
  result?: IImportResult | { etag: string } | null;
  reason?: string | null;
}

export abstract class IFileProposalRepository {
  abstract create(input: ICreateProposal): Promise<IFileChangeProposal>;
  abstract findById(id: string): Promise<IFileChangeProposal | null>;
  /**
   * Proposals raised in one chat. `since`/`until` bound `createdAt`;
   * `includePending` adds every pending row of the chat regardless of the
   * window, so an unanswered card is never lost to paging.
   */
  abstract listForChat(
    chatAgentId: string,
    channel: string,
    opts: { since?: Date; until?: Date; includePending?: boolean },
  ): Promise<IFileChangeProposal[]>;
  /**
   * Conditional state change: succeeds only when the row is still `from`.
   * Returns the row after the attempt and whether this call won it.
   */
  abstract transition(
    id: string,
    from: ProposalStatus,
    to: ProposalStatus,
    patch: ITransitionPatch,
  ): Promise<{ won: boolean; row: IFileChangeProposal | null }>;
  /** Every other pending single proposal on the same target path → stale. */
  abstract markSiblingsStale(
    agentId: string,
    path: string,
    exceptId: string,
  ): Promise<IFileChangeProposal[]>;
}
