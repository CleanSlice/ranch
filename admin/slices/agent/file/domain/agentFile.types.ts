// Domain types for an agent's file store (S3-backed workspace).

export interface IFileNode {
  path: string;
  size: number;
  updatedAt: string;
}

export interface IFileContent {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
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
}

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
