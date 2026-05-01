import { QueryModeTypes } from '../../knowledge/domain/reins.types';

export interface IIngestTextInput {
  workspace: string;
  text: string;
  fileSource?: string;
}

export interface IIngestUrlInput {
  workspace: string;
  url: string;
}

export interface IIngestFileInput {
  workspace: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface IIngestResult {
  docId: string;
}

export interface IQueryInput {
  workspace: string;
  query: string;
  mode?: QueryModeTypes;
  topK?: number;
}

export interface IQueryReference {
  referenceId: string;
  filePath: string;
}

export interface IQueryResult {
  answer: string;
  references: IQueryReference[];
}

export interface ILightragHealth {
  ok: boolean;
}

export interface IGetGraphInput {
  label: string;
  maxDepth?: number;
  maxNodes?: number;
}

export interface ILightragGraphNode {
  id: string;
  label: string;
  entityType: string;
  description: string;
}

export interface ILightragGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  keywords: string;
  description: string;
}

export interface ILightragGraph {
  nodes: ILightragGraphNode[];
  edges: ILightragGraphEdge[];
  isTruncated: boolean;
}

export class LightragClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'LightragClientError';
  }
}
