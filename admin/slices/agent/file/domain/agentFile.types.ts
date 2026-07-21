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
